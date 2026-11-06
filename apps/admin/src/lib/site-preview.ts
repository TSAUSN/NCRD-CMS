import { NavTree, ThemeTokens, normalizeHeaderConfig, normalizeFooterConfig, SitePublicSettings } from '@cms/schema'
import type { RenderManifest, SectionDefView, SiteShell } from '@cms/renderer'
import type { Queryable } from '@cms/platform'
import type { SitePreviewContext } from './preview-context.ts'

// All saved heads are read in one statement under the caller's RLS identity.
export const SITE_DRAFT_PREVIEW_SQL = `
  SELECT s.id, s.name, s.slug, s.kind,
         tv.tokens AS theme, nv.tree AS navigation, sv.settings AS settings,
         hv.content AS header, fv.content AS footer,
         app.preview_global_component(s.id, 'header', hv.content) AS header_component,
         app.preview_global_component(s.id, 'footer', fv.content) AS footer_component
    FROM sites s
    LEFT JOIN site_settings sh ON sh.site_id=s.id
    LEFT JOIN site_setting_versions sv ON sv.id=sh.draft_version_id
    JOIN themes t ON t.site_id=s.id
    JOIN theme_versions tv ON tv.id=t.draft_version_id
    JOIN navigations n ON n.site_id=s.id
    JOIN navigation_versions nv ON nv.id=n.draft_version_id
    JOIN global_elements h ON h.site_id=s.id AND h.kind='header'
    JOIN global_element_versions hv ON hv.id=h.draft_version_id
    JOIN global_elements f ON f.site_id=s.id AND f.kind='footer'
    JOIN global_element_versions fv ON fv.id=f.draft_version_id
   WHERE s.id=$1`

export type SiteDraftPreviewRow = {
  id: string
  name: string
  slug: string
  kind: string
  theme: unknown
  navigation: unknown
  header: unknown
  footer: unknown
  settings?: unknown
  /** The pinned frame definitions (ADR 0010), null for presets or unready components. */
  header_component: SectionDefView | null
  footer_component: SectionDefView | null
}

export function withSiteDrafts(shell: SiteShell, row: SiteDraftPreviewRow): SiteShell {
  const settings = SitePublicSettings.safeParse(row.settings),
    name = settings.success ? settings.data.name : row.name
  const header = normalizeHeaderConfig(row.header, name)
  const footer = normalizeFooterConfig(row.footer, name)
  if (!header || !footer) throw new Error('Saved site draft uses an unsupported header or footer configuration.')
  return {
    ...shell,
    ...(settings.success ? { settings: settings.data } : {}),
    site: { id: row.id, name, slug: row.slug, kind: row.kind },
    theme: ThemeTokens.parse(row.theme),
    navigation: NavTree.parse(row.navigation),
    header,
    footer,
    header_component: row.header_component,
    footer_component: row.footer_component,
  }
}

export type SitePreview = { shell: SiteShell; navigationPaths: Record<string, string>; fonts?: RenderManifest['fonts'] }

/** One private composition path for canvas, library, creator and update review.
 * The caller supplies its RLS-scoped transaction. Never fall back to published
 * settings when saved drafts are requested but unavailable. */
export async function readSitePreview(
  client: Queryable,
  siteId: string,
  context?: SitePreviewContext,
): Promise<SitePreview | null> {
  const site = (
    await client.query<{
      payload: SiteShell | null
      initial_release_required: boolean
      staging_hostname: string | null
      whole_site_access?: boolean
    }>(
      `
    SELECT p.payload,s.initial_release_required,s.staging_hostname,app.has_site_access(s.id) AS whole_site_access FROM sites s LEFT JOIN published_site_shells p ON p.site_id=s.id
    WHERE s.id=$1`,
      [siteId],
    )
  ).rows[0]
  if (!site) return null
  let shell: SiteShell = site.payload ?? {
    site: { id: siteId, name: '', slug: '' },
    theme: {},
    navigation: [],
    canonical_host: null,
    staging_host: null,
  }
  // A private site's placeholder shell has no public host yet. Preserve its
  // RLS-scoped staging address for approved font-kit selection in previews.
  shell = { ...shell, staging_host: shell.staging_host ?? site.staging_hostname }
  const routes = (
    await client.query<{ page_id: string; path: string }>(
      'SELECT page_id,path FROM published_routes WHERE site_id=$1',
      [siteId],
    )
  ).rows
  const navigationPaths = Object.fromEntries(routes.map(route => [route.page_id, route.path]))
  if (
    site.whole_site_access !== false &&
    (context ?? (site.initial_release_required ? 'draft' : 'published')) === 'draft'
  ) {
    const draft = (await client.query<SiteDraftPreviewRow>(SITE_DRAFT_PREVIEW_SQL, [siteId])).rows[0]
    if (!draft) return null
    shell = withSiteDrafts(shell, draft)
    // Saved navigation may link to unpublished or renamed pages. Those private
    // paths never enter the published route table or public renderer.
    const drafts = (
      await client.query<{ page_id: string; path: string }>(
        `
      SELECT id AS page_id, CASE WHEN slug='' THEN '/' ELSE '/' || slug END AS path
      FROM pages WHERE site_id=$1 AND archived_at IS NULL`,
        [siteId],
      )
    ).rows
    Object.assign(navigationPaths, Object.fromEntries(drafts.map(route => [route.page_id, route.path])))
  }
  // A synthetic component preview has no page version from which to resolve
  shell = {
    ...shell,
    chapter_directory:
      (await client.query('SELECT app.preview_chapter_directory($1) AS entries', [siteId])).rows[0]?.entries ?? [],
  }
  // fonts. Its selected site's immutable registered files remain readable only
  // through this caller's RLS identity and the authenticated asset route. All
  // rows for a font key have the same code-registered bytes; choose one stable
  // asset per key so repeat imports cannot suppress the bounded declarations.
  const fonts = (
    await client.query<NonNullable<RenderManifest['fonts']>[number]>(
      `
    SELECT DISTINCT ON (font_key) id AS "assetId", font_key AS "fontKey"
    FROM site_assets WHERE site_id=$1 AND kind='font'
    ORDER BY font_key,id`,
      [siteId],
    )
  ).rows
  return { shell, navigationPaths, fonts }
}
