import { contentCounts } from './content-counts.ts'
import { roleDisplayName } from './role-display.ts'
import { echelonSiteMedia, echelonSectionStartingValues } from './echelon-media.ts'
import 'server-only'
import { supportsImageFocus } from './image-focus-support.ts'
import { asUser } from '@cms/platform'
import { withDraftListPreview } from './draft-list-preview.ts'
import { LINK_TARGETS_SQL } from './link-targets.ts'
import { PAGE_HISTORY_SQL, PAGE_HISTORY_VERSION_SQL } from './page-history.ts'
import { SITE_SUMMARY_SQL, SIDEBAR_SITE_SUMMARY_SQL, ORDINARY_PAGE_SQL } from './site-summary.ts'
import { REVIEWED_PAGE_CANVAS_SQL } from './reviewed-page-canvas.ts'
import { readSitePreview, type SitePreview } from './site-preview.ts'
import type { SitePreviewContext } from './preview-context.ts'
import { CURRENT_SECTION_USES_SQL, SECTION_USAGE_SQL, type SectionUsageRow } from './section-usage.ts'
import type { MediaAsset, MediaStatus } from './media-library.ts'
import type { RenderManifest, SiteShell } from '@cms/renderer'
import { sectionAppearanceSupport, type AppearanceSupport } from '@cms/renderer'
import { siteImagePreviews } from './site-image-previews.ts'
import {
  NavTree,
  ThemeTokens,
  SiteFileBundle,
  DEFAULT_THEME_TOKENS,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_FOOTER_CONFIG,
  normalizeFooterConfig,
  normalizeHeaderConfig,
  type FooterConfig,
  type HeaderConfig,
  type SlotDef,
  type NavTree as NavigationTree,
  type ThemeTokens as ThemeTokenValues,
} from '@cms/schema'

export function getSiteImagePreviews(
  userId: string,
  siteId: string,
  context: 'draft' | 'published' = 'draft',
): Promise<Record<string, string>> {
  return asUser({ userId }, async client => {
    const pointer = context === 'draft' ? 'draft_version_id' : 'published_version_id'
    const head = (
      await client.query<{ versionId: string; bundle: unknown }>(
        `SELECT v.id AS "versionId",v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.${pointer} WHERE h.site_id=$1`,
        [siteId],
      )
    ).rows[0]
    const parsed = SiteFileBundle.safeParse(head?.bundle)
    if (!head || !parsed.success) return {}
    const files = (
      await client.query(
        'SELECT id,kind,name,source,bytes::integer,sha256 FROM site_files WHERE site_id=$1 AND id=ANY($2::uuid[])',
        [siteId, parsed.data.files],
      )
    ).rows
    return siteImagePreviews({ ...head, files })
  })
}

export type SiteRow = {
  id: string
  slug: string
  name: string
  status: string
  staging_hostname: string | null
  primary_hostname?: string | null
  hosting_status?: string
  initial_release_required?: boolean
  has_published_pages?: boolean
  original_design?: boolean
  has_isolated_page_canvas?: boolean
  chapters_enabled?: boolean
  has_stories?: boolean
  has_content_lists?: boolean
  national_template?: boolean
}
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A site plus the two counts a dashboard card is worth showing.
 *
 * Counted rather than invented. Both come from the same `pages` rows the site
 * screen lists, under the same RLS, so a card saying "3 pages · 1 published"
 * and the list you reach by clicking it cannot disagree — and a site whose pages
 * this reader cannot see reads as zero rather than as a number they have no way
 * to check.
 */
export type SiteSummaryRow = SiteRow & {
  /** The starter the site began from: `resource`, `event` or `blank`. */
  kind?: string | null
  page_count: string
  story_count?: string
  preview_image?: string | null
  published_count: string
  draft_only_count: string
  changed_count: string
  has_stories?: boolean
}
export type PageRow = {
  id: string
  slug: string
  title: string
  status: string
  revision: string
  draft_version_id: string | null
  published_version_id: string | null
  live_path: string | null
  archived_at: Date | null
}
export type LinkTarget = { id: string; title: string; path: string; anchors?: { id: string; label: string }[] }
export type DraftRow = {
  version_id: string
  revision: string
  content: unknown
  meta: Record<string, string>
  page_title: string
  page_slug: string
  carries_trusted_code: boolean
  trusted_code_approved_by: string | null
}
export type PageHistoryRow = {
  id: string
  revision: string
  kind: string
  note: string
  created_at: Date
  authored_by_me: boolean
  is_current_draft: boolean
  is_live_now: boolean
  was_published: boolean
  was_restored: boolean
}

/** Every read runs as the user's own database role; RLS decides what comes back. */
export function listSites(userId: string): Promise<SiteSummaryRow[]> {
  return readSiteSummaries(userId, SITE_SUMMARY_SQL)
}

export function listSitesForSidebar(userId: string): Promise<SiteSummaryRow[]> {
  return readSiteSummaries(userId, SIDEBAR_SITE_SUMMARY_SQL)
}

function readSiteSummaries(userId: string, sql: string): Promise<SiteSummaryRow[]> {
  return asUser({ userId }, async client => (await client.query<SiteSummaryRow>(sql)).rows)
}

export function getSite(userId: string, siteId: string): Promise<SiteRow | null> {
  if (!UUID_SHAPE.test(siteId)) return Promise.resolve(null)
  return asUser(
    { userId },
    async client =>
      (
        await client.query<SiteRow>(
          `SELECT s.id, s.slug, s.name, s.status, s.staging_hostname, s.initial_release_required, s.chapters_enabled, (s.slug IN ('sawso','echelon-chapters') OR EXISTS(SELECT 1 FROM themes th JOIN theme_versions tv ON tv.id=th.draft_version_id WHERE th.site_id=s.id AND tv.tokens#>>'{presentation,template,id}'='national')) AS national_template, EXISTS(SELECT 1 FROM collections c WHERE c.site_id=s.id AND c.reader_key='stories') AS has_stories, EXISTS(SELECT 1 FROM collections c WHERE c.site_id=s.id AND c.reader_key IS DISTINCT FROM 'stories') AS has_content_lists, CASE WHEN app.has_site_access(s.id) THEN app.site_hosting_status(s.id) ELSE 'ready' END AS hosting_status,
        (SELECT d.hostname_normalized FROM domains d WHERE d.site_id=s.id AND d.kind='primary'
          AND d.status='live' AND d.removed_at IS NULL LIMIT 1) AS primary_hostname,
        EXISTS(SELECT 1 FROM pages p WHERE p.site_id=s.id AND p.published_version_id IS NOT NULL
          AND p.archived_at IS NULL) AS has_published_pages,
        EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id
          WHERE h.site_id=s.id AND v.bundle ? 'original') AS original_design,
        ${REVIEWED_PAGE_CANVAS_SQL} AS has_isolated_page_canvas
       FROM sites s WHERE s.id = $1`,
          [siteId],
        )
      ).rows[0] ?? null,
  )
}

export function listPages(userId: string, siteId: string): Promise<PageRow[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<PageRow>(
          `SELECT p.id, p.slug, p.title, p.status, p.revision,
              p.draft_version_id, p.published_version_id, p.archived_at,
              (SELECT route.path FROM published_routes route
                WHERE route.page_id = p.id ORDER BY route.updated_at DESC LIMIT 1) AS live_path
         FROM pages p WHERE p.site_id = $1 AND p.archived_at IS NULL
        -- A planned order wins; among pages without one the home page leads,
        -- as in V1's site workspace (reference 02).
        ORDER BY p.sort_index, p.slug <> '', p.title`,
          [siteId],
        )
      ).rows,
  )
}

export function listArchivedPages(userId: string, siteId: string): Promise<PageRow[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<PageRow>(
          `SELECT p.id, p.slug, p.title, p.status, p.revision,
              p.draft_version_id, p.published_version_id, p.archived_at,
              NULL::text AS live_path
         FROM pages p WHERE p.site_id = $1 AND p.archived_at IS NOT NULL
        ORDER BY p.archived_at DESC, p.title`,
          [siteId],
        )
      ).rows,
  )
}

export type NavigationPage = {
  id: string
  title: string
  path: string
  published: boolean
}

export type NavigationWorkspace = {
  id: string
  revision: number
  mode: 'auto' | 'manual'
  draftVersionId: string
  publishedVersionId: string | null
  draft: NavigationTree
  published: NavigationTree
  pages: NavigationPage[]
}

/**
 * One read model for the navigation screen: the editable draft, what visitors
 * currently get, and the pages a menu item may point at. Both trees are parsed
 * at the server boundary. A corrupt stored artifact therefore fails visibly
 * instead of becoming an empty menu that an author might accidentally publish.
 */
export function getNavigationWorkspace(userId: string, siteId: string): Promise<NavigationWorkspace | null> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{
      id: string
      revision: string
      mode: 'auto' | 'manual'
      draft_version_id: string
      published_version_id: string | null
      draft: unknown
      published: unknown
    }>(
      `SELECT n.id, n.revision, n.mode, n.draft_version_id, n.published_version_id,
              draft.tree AS draft, live.tree AS published
         FROM navigations n
         JOIN navigation_versions draft ON draft.id = n.draft_version_id
         LEFT JOIN navigation_versions live ON live.id = n.published_version_id
        WHERE n.site_id = $1`,
      [siteId],
    )
    const head = rows[0]
    if (!head) return null
    const pages = await client.query<{
      id: string
      title: string
      slug: string
      published: boolean
    }>(
      `SELECT id, title, slug, published_version_id IS NOT NULL AS published
         FROM pages WHERE site_id = $1 AND archived_at IS NULL
        ORDER BY sort_index, slug <> '', title`,
      [siteId],
    )
    return {
      id: head.id,
      revision: Number(head.revision),
      mode: head.mode,
      draftVersionId: head.draft_version_id,
      publishedVersionId: head.published_version_id,
      draft: NavTree.parse(head.draft),
      published: NavTree.parse(head.published ?? []),
      pages: pages.rows.map(page => ({
        id: page.id,
        title: page.title,
        path: page.slug ? `/${page.slug}` : '/',
        published: page.published,
      })),
    }
  })
}

/** The same capability predicate the navigation commands enforce. */
export function canManageNavigation(userId: string, siteId: string): Promise<boolean> {
  return asUser(
    { userId },
    async client =>
      (await client.query<{ allowed: boolean }>('SELECT app.can_publish($1) AS allowed', [siteId])).rows[0]?.allowed ===
      true,
  )
}

/** Header and Footer need the normalized draft, without page usage counts. */
export function getDraftTheme(userId: string, siteId: string): Promise<ThemeTokenValues | null> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{ draft: unknown }>(
      `SELECT draft.tokens AS draft
         FROM themes t
         JOIN theme_versions draft ON draft.id = t.draft_version_id
        WHERE t.site_id = $1`,
      [siteId],
    )
    return rows[0] ? ThemeTokens.parse(rows[0].draft) : null
  })
}

export type ThemeUsage = Record<string, number>
export type ThemeWorkspace = {
  id: string
  revision: number
  draftVersionId: string
  publishedVersionId: string | null
  draft: ThemeTokenValues
  published: ThemeTokenValues
  usage: ThemeUsage
  previewPages: { title: string; versionId: string }[]
}

/**
 * The theme's private draft and live version, normalised at the server boundary.
 * Defaults upgrade old stored shapes in memory only; saving creates a new
 * immutable version and never mutates the historical row.
 */
export function getThemeWorkspace(userId: string, siteId: string): Promise<ThemeWorkspace | null> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{
      id: string
      revision: string
      draft_version_id: string
      published_version_id: string | null
      draft: unknown
      published: unknown
    }>(
      `SELECT t.id, t.revision, t.draft_version_id, t.published_version_id,
              draft.tokens AS draft, live.tokens AS published
         FROM themes t
         JOIN theme_versions draft ON draft.id = t.draft_version_id
         LEFT JOIN theme_versions live ON live.id = t.published_version_id
        WHERE t.site_id = $1`,
      [siteId],
    )
    const head = rows[0]
    if (!head) return null

    // Count only the current version of each visible page. The shell itself
    // always consumes primary/surface/ink, both fonts and radius; section CSS
    // adds truthful page counts beside the less universal tokens.
    const usageRows = await client.query<{ token: string; pages: string }>(
      `WITH current_sections AS (
         SELECT DISTINCT p.id AS page_id, section->>'section_def_id' AS def_id,
                (section->>'section_def_version')::integer AS def_version
           FROM pages p
           JOIN page_versions pv ON pv.id = COALESCE(p.published_version_id, p.draft_version_id)
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(pv.content) = 'array' THEN pv.content ELSE '[]'::jsonb END) section
          WHERE p.site_id = $1 AND p.archived_at IS NULL
       ), token_names(token) AS (
         VALUES ('primary'),('accent'),('surface'),('surfaceAlt'),('ink'),('muted'),
                ('primaryContrast'),('accentContrast'),('button')
       )
       SELECT token_names.token,
              count(DISTINCT current_sections.page_id) FILTER (
                WHERE sdv.source_css ILIKE '%var(--color-' || token_names.token || '%'
                   OR (token_names.token = 'button' AND sdv.slots @> '[{"kind":"button"}]'::jsonb)
              )::text AS pages
         FROM token_names
         LEFT JOIN current_sections ON true
         LEFT JOIN section_def_versions sdv
           ON sdv.section_def_id::text = current_sections.def_id
          AND sdv.version = current_sections.def_version
        GROUP BY token_names.token`,
      [siteId],
    )
    const usage = Object.fromEntries(usageRows.rows.map(row => [row.token, Number(row.pages)]))
    const previewPages = await client.query<{ title: string; version_id: string }>(
      `SELECT p.title, COALESCE(p.draft_version_id, p.published_version_id) AS version_id
         FROM pages p
        WHERE p.site_id = $1 AND p.archived_at IS NULL
          AND COALESCE(p.draft_version_id, p.published_version_id) IS NOT NULL
        ORDER BY p.sort_index, p.slug <> '', p.title`,
      [siteId],
    )
    return {
      id: head.id,
      revision: Number(head.revision),
      draftVersionId: head.draft_version_id,
      publishedVersionId: head.published_version_id,
      draft: ThemeTokens.parse(head.draft),
      published: ThemeTokens.parse(head.published ?? DEFAULT_THEME_TOKENS),
      usage,
      previewPages: previewPages.rows.map(page => ({ title: page.title, versionId: page.version_id })),
    }
  })
}

/** The same predicate the database commands enforce. */
export function canManageTheme(userId: string, siteId: string): Promise<boolean> {
  return asUser(
    { userId },
    async client =>
      (await client.query<{ allowed: boolean }>('SELECT app.can_administer_site($1) AS allowed', [siteId])).rows[0]
        ?.allowed === true,
  )
}

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
        `SELECT s.name,
        (SELECT count(*)::int FROM pages p WHERE p.site_id=s.id AND p.archived_at IS NULL AND ${ORDINARY_PAGE_SQL}) AS page_count,
        (SELECT count(*)::int FROM collections sc JOIN collection_entries se ON se.collection_id=sc.id WHERE sc.site_id=s.id AND sc.reader_key='stories' AND se.archived_at IS NULL) AS story_count
       FROM sites s WHERE s.id=$1`,
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

/** Published pages this reader may safely choose as same-site link targets. */
export function listLinkTargets(userId: string, siteId: string): Promise<LinkTarget[]> {
  return asUser({ userId }, async client => (await client.query<LinkTarget>(LINK_TARGETS_SQL, [siteId])).rows)
}

type MediaRow = {
  id: string
  revision: string
  site_id: string | null
  original_name: string
  alt_text: string
  decorative: boolean
  focal: unknown
  width: number | null
  height: number | null
  bytes: string | null
  mime_type: string
  status: MediaStatus
  folder: string
  attribution: string
  source: string
  tags: string[]
  created_at: Date
  deleted_at: Date | null
  used_on_items: number
  used_in_versions: number
  has_thumbnail: boolean
  has_card: boolean
  has_wide: boolean
}

function focalPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { x?: unknown; y?: unknown }
  return typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : null
}

function adminMediaUrl(mediaId: string): string {
  return `/media/${encodeURIComponent(mediaId)}/thumbnail`
}

/**
 * The site's own media and the shared pool, with usage facts calculated from
 * rows this reader can see. Governed relative media URLs are origin-agnostic:
 * admin resolves them through the session-protected route, while the public
 * app resolves the same id and variant through host-scoped site access.
 */
export function listMediaAssets(userId: string, siteId: string): Promise<MediaAsset[]> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<MediaRow>(
      `SELECT m.id, m.revision, m.site_id, m.original_name, m.alt_text,
              m.decorative, m.focal, m.width, m.height, m.bytes, m.mime_type,
              m.status, m.folder, m.attribution, m.source, m.tags, m.created_at, m.deleted_at,
              count(DISTINCT u.item_id)::int AS used_on_items,
              count(DISTINCT u.version_id)::int AS used_in_versions,
              COALESCE(bool_or(v.kind = 'thumbnail'), false) AS has_thumbnail,
              COALESCE(bool_or(v.kind = 'card'), false) AS has_card,
              COALESCE(bool_or(v.kind = 'wide'), false) AS has_wide
         FROM media m
         LEFT JOIN (SELECT media_id,item_id,version_id FROM media_usage
           UNION ALL SELECT media_id,site_id,version_id FROM site_file_media_usage) u ON u.media_id=m.id
         LEFT JOIN media_variants v ON v.media_id = m.id
        WHERE m.site_id = $1 OR m.site_id IS NULL
        GROUP BY m.id
        ORDER BY (m.status = 'deleted'), m.created_at DESC, m.original_name`,
      [siteId],
    )
    return rows.map(row => ({
      id: row.id,
      revision: Number(row.revision),
      siteId: row.site_id,
      scope: row.site_id === null ? 'shared' : 'site',
      name: row.original_name || 'Untitled image',
      altText: row.alt_text,
      decorative: row.decorative,
      focal: focalPoint(row.focal),
      width: row.width,
      height: row.height,
      bytes: row.bytes === null ? null : Number(row.bytes),
      mimeType: row.mime_type,
      status: row.status,
      folder: row.folder,
      attribution: row.attribution,
      source: row.source,
      tags: row.tags,
      variants: {
        original: true,
        thumbnail: row.has_thumbnail,
        card: row.has_card,
        wide: row.has_wide,
      },
      previewUrl: row.has_thumbnail ? adminMediaUrl(row.id) : null,
      deliveryUrl: row.has_wide ? `/media/${encodeURIComponent(row.id)}/wide` : null,
      usedOnItems: row.used_on_items,
      usedInVersions: row.used_in_versions,
      createdAt: row.created_at.toISOString(),
      deletedAt: row.deleted_at?.toISOString() ?? null,
    }))
  })
}

export function getPage(
  userId: string,
  pageId: string,
): Promise<(PageRow & { site_id: string; is_chapter_page?: boolean }) | null> {
  if (!UUID_SHAPE.test(pageId)) return Promise.resolve(null)
  return asUser(
    { userId },
    async client =>
      (
        await client.query<PageRow & { site_id: string }>(
          `SELECT p.id, p.site_id, p.slug, p.title, p.status, p.revision,
              p.draft_version_id, p.published_version_id, p.archived_at,app.is_chapter_page(p.id) AS is_chapter_page,
              (SELECT route.path FROM published_routes route
                WHERE route.page_id = p.id ORDER BY route.updated_at DESC LIMIT 1) AS live_path
         FROM pages p WHERE p.id = $1 AND p.archived_at IS NULL`,
          [pageId],
        )
      ).rows[0] ?? null,
  )
}

export async function listPageHistory(
  userId: string,
  pageId: string,
  options?: {
    includeAutosaves?: boolean
    beforeRevision?: string | null
    limit?: number
  },
): Promise<{ items: PageHistoryRow[]; nextBefore: string | null }> {
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100)
  return asUser({ userId }, async client => {
    const { rows } = await client.query<PageHistoryRow>(PAGE_HISTORY_SQL, [
      pageId,
      options?.includeAutosaves === true,
      options?.beforeRevision ?? null,
      limit + 1,
    ])
    const items = rows.slice(0, limit)
    return {
      items,
      nextBefore: rows.length > limit ? items.at(-1)!.revision : null,
    }
  })
}

export function getPageHistoryVersion(
  userId: string,
  pageId: string,
  versionId: string,
): Promise<PageHistoryRow | null> {
  return asUser(
    { userId },
    async client => (await client.query<PageHistoryRow>(PAGE_HISTORY_VERSION_SQL, [pageId, versionId])).rows[0] ?? null,
  )
}

export function getDraft(userId: string, versionId: string): Promise<DraftRow | null> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<DraftRow>(
          `SELECT id AS version_id, revision, content, meta, page_title, page_slug, carries_trusted_code, trusted_code_approved_by
         FROM page_versions WHERE id = $1`,
          [versionId],
        )
      ).rows[0] ?? null,
  )
}

/**
 * The preview manifest comes from the same SQL builder the publish command
 * uses, so preview cannot drift from what publishing would produce — the
 * byte-identity problem v1 solved with sync scripts (SPEC §3.3).
 */
export function buildPreview(
  userId: string,
  versionId: string,
  siteId: string,
  siteDrafts?: boolean,
  draftLists = false,
): Promise<{
  manifest: RenderManifest
  shell: SiteShell
  navigationPaths: Record<string, string>
} | null> {
  return asUser({ userId }, async client => {
    const manifest = await client.query<{ manifest: RenderManifest }>(
      'SELECT app.build_initial_preview_manifest(id) AS manifest FROM page_versions WHERE id=$1 AND site_id=$2',
      [versionId, siteId],
    )
    if (!manifest.rows[0]) return null
    const preview = await readSitePreview(
      client,
      siteId,
      siteDrafts === undefined ? undefined : siteDrafts ? 'draft' : 'published',
    )
    if (!preview) return null
    const page = manifest.rows[0].manifest.page
    return {
      manifest: draftLists
        ? await withDraftListPreview(client, manifest.rows[0].manifest, versionId, siteId)
        : manifest.rows[0].manifest,
      ...preview,
      navigationPaths: { ...preview.navigationPaths, [page.id]: page.path },
    }
  })
}

export type HeartbeatRow = { worker_id: string; role: string; last_seen_at: Date; version: string }

/** M0 exit criterion: the worker's heartbeat is visible in the product. */
export function latestHeartbeats(userId: string): Promise<HeartbeatRow[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<HeartbeatRow>(
          'SELECT worker_id, role, last_seen_at, version FROM job_heartbeats ORDER BY last_seen_at DESC',
        )
      ).rows,
  )
}

export type LibraryEntry = {
  starting_values?: Record<string, unknown>
  section_def_id: string
  slug: string
  name: string
  category: string
  version: number
  slots: { id: string; kind: string; label: string; constraints?: Record<string, unknown> }[]
  /** Where a pre-rendered thumbnail lives, or null while one has not been made. */
  thumbnail_path: string | null
  /** `structured` or `legacy`; the editor tells an author which model it is. */
  definition_kind: string
  /** Adding this needs a super admin's approval before the page can go live. */
  carries_trusted_code: boolean
  /** How many pages, across how many sites, already use this definition. */
  used_on_pages: number
  used_on_sites: number
  scope: 'global' | 'site'
  site_id: string | null
  /** page, header or footer (ADR 0010). Only page definitions are inserted into pages. */
  placement?: 'page' | 'header' | 'footer'
  image_focus_supported?: boolean
  appearance_support?: AppearanceSupport
  is_favourite?: boolean
}

type AppearanceLibraryRow = LibraryEntry & { css?: string; structured_doc?: unknown; compiled_ast?: unknown }
function withAppearanceSupport({ css, structured_doc, compiled_ast, ...row }: AppearanceLibraryRow): LibraryEntry {
  return {
    ...row,
    image_focus_supported: supportsImageFocus(row.definition_kind, compiled_ast),
    appearance_support: sectionAppearanceSupport({ ...row, css, structured_doc }),
  }
}

export function getPublishedThemeColors(userId: string, siteId: string): Promise<Record<string, string>> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{ colors: Record<string, string> }>(
      "SELECT payload #> '{theme,colors}' AS colors FROM published_site_shells WHERE site_id=$1",
      [siteId],
    )
    return { ...DEFAULT_THEME_TOKENS.colors, ...rows[0]?.colors }
  })
}

export function getDraftThemeColors(userId: string, siteId: string): Promise<Record<string, string>> {
  return asUser({ userId }, async client => {
    const row = (
      await client.query<{ tokens: unknown }>(
        'SELECT v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
        [siteId],
      )
    ).rows[0]
    return ThemeTokens.parse(row?.tokens ?? DEFAULT_THEME_TOKENS).colors
  })
}

/**
 * The section library, each definition at its newest version, with the two facts
 * a card needs beyond its name.
 *
 * **Usage counts are counts of what this reader can see.** They come out of a
 * query running as the reader's own database role, so RLS has already removed
 * every site they are not a member of. That makes "Used on 14 pages across 3
 * sites" true for the person reading it and *not* a global figure — which is the
 * honest version, since a contributor being told a definition is used on a site
 * they cannot open is being told about a page they cannot go and check. The
 * copy beside the number says so rather than leaving it to be inferred.
 *
 * Count distinct pages across their current draft and published versions. This
 * includes an addition waiting to publish and a removal still present live;
 * historical-only placements and archived pages do not inflate the count.
 */
export function listSectionLibrary(userId: string, siteId: string): Promise<LibraryEntry[]> {
  return asUser({ userId }, async client => {
    const rows = (
      await client.query<AppearanceLibraryRow>(
        `WITH newest AS (
         SELECT DISTINCT ON (d.id)
                d.id AS section_def_id, d.slug, d.name, d.category, d.scope, d.site_id, d.placement,
                v.version, v.slots, v.thumbnail_path, v.definition_kind, v.carries_trusted_code,
                v.compiled_css AS css, v.structured_doc, v.compiled_ast
           FROM section_defs d
           JOIN section_def_versions v ON v.section_def_id = d.id
          WHERE d.status = 'active' AND (d.scope = 'global' OR d.site_id = $1)
          ORDER BY d.id, v.version DESC
       ),
       current_uses AS (${CURRENT_SECTION_USES_SQL}),
       usage AS (
         SELECT section_def_id,
                count(DISTINCT page_id) AS used_on_pages,
                count(DISTINCT site_id) AS used_on_sites
           FROM current_uses
          GROUP BY 1
       )
       SELECT newest.*,
              EXISTS(SELECT 1 FROM section_favourites f WHERE f.site_id=$1
                AND f.section_def_id=newest.section_def_id) AS is_favourite,
              COALESCE(usage.used_on_pages, 0)::int AS used_on_pages,
              COALESCE(usage.used_on_sites, 0)::int AS used_on_sites
         FROM newest
         LEFT JOIN usage ON usage.section_def_id = newest.section_def_id::text
        ORDER BY newest.category, newest.name`,
        [siteId],
      )
    ).rows.map(withAppearanceSupport)
    const media = await echelonSiteMedia(client, siteId)
    return media
      ? rows.map(entry => ({ ...entry, starting_values: echelonSectionStartingValues(entry.slots, media, entry.slug) }))
      : rows
  })
}

export function listSectionUsage(userId: string, definitionId: string, after?: string) {
  if (!UUID_SHAPE.test(definitionId) || (after && !UUID_SHAPE.test(after)))
    return Promise.resolve({ rows: [] as SectionUsageRow[], next: null as string | null })
  return asUser({ userId }, async client => {
    const { rows } = await client.query<SectionUsageRow>(SECTION_USAGE_SQL, [definitionId, after ?? null])
    return { rows: rows.slice(0, 50), next: rows.length > 50 ? rows[49]!.page_id : null }
  })
}

/** Exact definitions pinned by this page, including versions no longer offered
 * in the insertion library. A newer template must not change an old inspector. */
export function listPageSectionVersions(userId: string, pageId: string): Promise<LibraryEntry[]> {
  return asUser({ userId }, async client =>
    (
      await client.query<AppearanceLibraryRow>(
        `
    SELECT DISTINCT d.id AS section_def_id,d.slug,d.name,d.category,d.scope,d.site_id,
      v.version,v.slots,v.thumbnail_path,v.definition_kind,v.carries_trusted_code,v.compiled_css AS css,v.structured_doc,v.compiled_ast,
      0::int AS used_on_pages,0::int AS used_on_sites
    FROM pages p JOIN page_versions pv ON pv.id IN (p.draft_version_id,p.published_version_id)
    CROSS JOIN LATERAL jsonb_array_elements(pv.content) section
    JOIN section_defs d ON d.id=(section->>'section_def_id')::uuid
    JOIN section_def_versions v ON v.section_def_id=d.id AND v.version=(section->>'section_def_version')::int
    WHERE p.id=$1
  `,
        [pageId],
      )
    ).rows.map(withAppearanceSupport),
  )
}

export type QueueHealthRow = {
  outbox_waiting: string
  outbox_running: string
  outbox_stalled: string
  outbox_retrying: string
  outbox_dead: string
  outbox_oldest_waiting_seconds: string | null
  schedules_waiting: string
  schedules_running: string
  schedules_stalled: string
  schedules_retrying: string
  schedules_failed: string
  schedules_overdue_seconds: string | null
  live_workers: string
  stale_workers: string
  last_heartbeat_at: Date | null
}

/**
 * Queue health, so an operator learns about a stalled queue from the app rather
 * than from a user asking why their scheduled post never went out (ADR 0003).
 */
export function jobQueueHealth(userId: string): Promise<QueueHealthRow> {
  return asUser(
    { userId },
    async client => (await client.query<QueueHealthRow>('SELECT * FROM app.job_queue_health()')).rows[0]!,
  )
}

export type AuthoringRights = {
  /** May author a section every site can use. */
  global: boolean
  /** May author a section for this one site. */
  site: boolean
}

/**
 * What this person is allowed to author, asked of the database's own predicates.
 *
 * Deliberately the same two functions migration 0029's command calls, so the
 * screen and the command cannot disagree about who may do what. A UI that
 * offered a choice the command refuses is a UI that teaches people their work
 * was lost; one that hid a choice the command allows is a feature nobody can
 * find. Both are the same bug — the screen guessing — and this removes the
 * guess rather than making it more careful.
 */
export function authoringRights(userId: string, siteId: string): Promise<AuthoringRights> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{ global: boolean; site: boolean }>(
      'SELECT app.is_super_admin() AS global, app.can_administer_site($1) AS site',
      [siteId],
    )
    const row = rows[0]
    return { global: row?.global === true, site: row?.site === true || row?.global === true }
  })
}

/** Private preview composition shared with the page canvas. */
export function getSiteShell(
  userId: string,
  siteId: string,
  context: SitePreviewContext = 'published',
): Promise<SitePreview | null> {
  return asUser({ userId }, client => readSitePreview(client, siteId, context))
}

/** Whether this person is a super admin, asked of the database's own predicate. */
/**
 * What to call this person in the sidebar.
 *
 * Read rather than assumed. `global_roles` is self-visible under RLS, so a
 * reader can always learn their own role and never anybody else's, and a person
 * with no global role is described by what they can actually do — edit the
 * sites somebody put them on — rather than being given a title the database
 * does not record.
 */
export function roleLabel(userId: string): Promise<string> {
  return asUser({ userId }, async client => {
    const global = (await client.query<{ role: string }>('SELECT role FROM global_roles WHERE user_id = $1', [userId]))
      .rows[0]
    if (global) {
      return roleDisplayName(global.role)
    }
    const site = (
      await client.query<{ role: string }>(
        `SELECT role FROM site_memberships WHERE user_id = $1
        ORDER BY CASE role WHEN 'site_admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END
        LIMIT 1`,
        [userId],
      )
    ).rows[0]
    if (!site) {
      const scopeRow = (
        await client.query<{ scopes: Record<string, { role: string }>; divisions: Record<string, unknown> }>(
          'SELECT app.current_page_scopes() AS scopes,app.current_division_scopes() AS divisions',
        )
      ).rows[0]
      const scopes = scopeRow?.scopes ?? {}
      return Object.keys(scopeRow?.divisions ?? {}).length
        ? roleDisplayName('editor') + ' · division'
        : Object.values(scopes).some(scope => scope.role === 'editor')
          ? roleDisplayName('editor') + ' · assigned pages'
          : Object.keys(scopes).length
            ? roleDisplayName('contributor') + ' · assigned pages'
            : 'No site access'
    }
    return roleDisplayName(site.role)
  })
}

export function isSuperAdmin(userId: string): Promise<boolean> {
  return asUser(
    { userId },
    async client => (await client.query<{ ok: boolean }>('SELECT app.is_super_admin() AS ok')).rows[0]?.ok === true,
  )
}
