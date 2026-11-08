import 'server-only'
import { asUser } from '@cms/platform'
import { ThemeTokens, DEFAULT_THEME_TOKENS, type ThemeTokens as ThemeTokenValues } from '@cms/schema'

/** Native frame workspaces require site administration and the saved draft theme. */
export function getManagedDraftTheme(userId: string, siteId: string): Promise<ThemeTokenValues | null> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{ draft: unknown }>(
      `SELECT draft.tokens AS draft
         FROM themes t
         JOIN theme_versions draft ON draft.id = t.draft_version_id
        WHERE t.site_id = $1 AND app.can_administer_site($1)`,
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
