import { contentCounts } from '../../lib/content-counts.ts'
import 'server-only'
import { asUser } from '@cms/platform'
import { ORDINARY_PAGE_SQL, SITE_CONTENT_COUNTS_SQL } from '../../lib/site-summary.ts'
import {
  SiteFileBundle,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_FOOTER_CONFIG,
  normalizeFooterConfig,
  normalizeHeaderConfig,
  type FooterConfig,
  type HeaderConfig,
  type SlotDef,
} from '@cms/schema'

export type GlobalElementsPageChoice = {
  kind?: string
  id: string
  title: string
  path: string
  published: boolean
  versionId: string
  usesHeader?: boolean
  usesFooter?: boolean
}

export type GlobalElementHead<T> = {
  id: string
  revision: number
  draftVersionId: string
  publishedVersionId: string | null
  draft: T
  published: T
}

/** A header or footer definition this site may pin (ADR 0010). */
export type FrameComponentChoice = {
  slug?: string
  status: 'active' | 'hidden' | 'retired'
  id: string
  name: string
  placement: 'header' | 'footer'
  scope: 'global' | 'site'
  versions: { version: number; slots: SlotDef[] }[]
}

export type GlobalElementsWorkspace = {
  contentSummary?: string
  originalDesign?: boolean
  header: GlobalElementHead<HeaderConfig>
  footer: GlobalElementHead<FooterConfig>
  pages: GlobalElementsPageChoice[]
  previewPages: { title: string; versionId: string }[]
  components: FrameComponentChoice[]
}

/**
 * The two site-wide artifacts as one workspace. They are read together because
 * Save, Publish and Revert are one user intention: leaving the header on one
 * revision and the footer on another after a partial failure is not a state the
 * product offers.
 */
export function getGlobalElementsWorkspace(userId: string, siteId: string): Promise<GlobalElementsWorkspace | null> {
  return asUser({ userId }, async client => {
    const site = (
      await client.query<{ name: string; page_count: number; story_count: number }>(
        `SELECT s.name, ${SITE_CONTENT_COUNTS_SQL} FROM sites s WHERE s.id=$1`,
        [siteId],
      )
    ).rows[0]
    if (!site) return null
    const { rows } = await client.query<{
      id: string
      kind: 'header' | 'footer'
      revision: string
      draft_version_id: string
      published_version_id: string | null
      draft: unknown
      published: unknown
    }>(
      `SELECT g.id, g.kind, g.revision, g.draft_version_id, g.published_version_id,
              draft.content AS draft, live.content AS published
         FROM global_elements g
         JOIN global_element_versions draft ON draft.id = g.draft_version_id
         LEFT JOIN global_element_versions live ON live.id = g.published_version_id
        WHERE g.site_id = $1 AND g.kind IN ('header','footer')`,
      [siteId],
    )
    const header = rows.find(row => row.kind === 'header')
    const footer = rows.find(row => row.kind === 'footer')
    if (!header || !footer) return null
    const headerDraft = normalizeHeaderConfig(header.draft, site.name)
    const headerPublished = normalizeHeaderConfig(
      header.published ?? { ...DEFAULT_HEADER_CONFIG, enabled: false },
      site.name,
    )
    const footerDraft = normalizeFooterConfig(footer.draft, site.name)
    const footerPublished = normalizeFooterConfig(
      footer.published ?? { ...DEFAULT_FOOTER_CONFIG, enabled: false },
      site.name,
    )
    if (!headerDraft || !headerPublished || !footerDraft || !footerPublished) {
      throw new Error('Stored header or footer uses an unsupported configuration version.')
    }
    const pageRows = await client.query<{
      id: string
      title: string
      slug: string
      published: boolean
      version_id: string
      kind: string
    }>(
      `SELECT p.id, p.title, p.slug, CASE WHEN ${ORDINARY_PAGE_SQL} THEN 'page' ELSE 'story' END AS kind, p.published_version_id IS NOT NULL AS published,
              COALESCE(p.draft_version_id, p.published_version_id) AS version_id
         FROM pages p
        WHERE p.site_id = $1 AND p.archived_at IS NULL
          AND COALESCE(p.draft_version_id, p.published_version_id) IS NOT NULL
        ORDER BY p.sort_index, p.slug <> '', p.title`,
      [siteId],
    )
    const fileRow = (
      await client.query<{ bundle: unknown }>(
        'SELECT v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [siteId],
      )
    ).rows[0]
    const parsedFiles = SiteFileBundle.safeParse(fileRow?.bundle),
      original = parsedFiles.success ? parsedFiles.data.original : undefined
    const pages = pageRows.rows.map(page => ({
      id: page.id,
      kind: page.kind,
      title: page.title,
      path: page.slug ? `/${page.slug}` : '/',
      published: page.published,
      versionId: page.version_id,
      usesHeader:
        (original?.pages.find(profile => profile.pageId.toLowerCase() === page.id.toLowerCase()) ?? original?.newPages)
          ?.header ?? true,
      usesFooter:
        (original?.pages.find(profile => profile.pageId.toLowerCase() === page.id.toLowerCase()) ?? original?.newPages)
          ?.footer ?? true,
    }))
    const componentRows = await client.query<{
      id: string
      slug: string
      name: string
      placement: 'header' | 'footer'
      scope: 'global' | 'site'
      status: 'active' | 'hidden' | 'retired'
      versions: { version: number; slots: SlotDef[] }[]
    }>(
      `SELECT d.id, d.slug, d.name, d.placement, d.scope, d.status,
              jsonb_agg(jsonb_build_object('version', v.version, 'slots', v.slots) ORDER BY v.version) AS versions
         FROM section_defs d JOIN section_def_versions v ON v.section_def_id = d.id
        WHERE d.placement IN ('header','footer')
          AND (d.status = 'active' OR EXISTS (
            SELECT 1 FROM global_elements g JOIN global_element_versions gv
              ON gv.id IN (g.draft_version_id, g.published_version_id)
            WHERE g.site_id=$1 AND gv.content->'component'->>'section_def_id'=d.id::text))
          AND (d.scope = 'global' OR d.site_id = $1)
        GROUP BY d.id ORDER BY d.name`,
      [siteId],
    )
    return {
      contentSummary: contentCounts(site.page_count, site.story_count),
      originalDesign: Boolean(original),
      header: {
        id: header.id,
        revision: Number(header.revision),
        draftVersionId: header.draft_version_id,
        publishedVersionId: header.published_version_id,
        draft: headerDraft,
        published: headerPublished,
      },
      footer: {
        id: footer.id,
        revision: Number(footer.revision),
        draftVersionId: footer.draft_version_id,
        publishedVersionId: footer.published_version_id,
        draft: footerDraft,
        published: footerPublished,
      },
      pages,
      previewPages: pages.map(page => ({ title: page.title, versionId: page.versionId })),
      components: componentRows.rows,
    }
  })
}

/** The same Editor+ predicate the combined database commands enforce. */
export function canManageGlobalElements(userId: string, siteId: string): Promise<boolean> {
  return asUser(
    { userId },
    async client =>
      (await client.query<{ allowed: boolean }>('SELECT app.can_publish($1) AS allowed', [siteId])).rows[0]?.allowed ===
      true,
  )
}
