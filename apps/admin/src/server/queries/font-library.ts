import 'server-only'
import { asUser } from '@cms/platform'
import {
  NavTree,
  ThemeTokens,
  normalizeFooterConfig,
  normalizeHeaderConfig,
  type FooterConfig,
  type HeaderConfig,
} from '@cms/schema'
import { contentCounts } from '../../lib/content-counts.ts'
import { SITE_CONTENT_COUNTS_SQL } from '../../lib/site-summary.ts'

export type FontLibraryWorkspace = {
  draft: ThemeTokens
  revision: number
  header: HeaderConfig
  footer: FooterConfig
  menu: NavTree
  page: { id: string; versionId: string } | null
  contentSummary: string
}

/** Fonts needs the saved draft, one preview page, and the review counts. */
export function getFontLibraryWorkspace(userId: string, siteId: string): Promise<FontLibraryWorkspace | null> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{
      name: string
      draft: unknown
      revision: string
      header: unknown
      footer: unknown
      menu: unknown
      page_id: string | null
      page_version_id: string | null
      page_count: number
      story_count: number
    }>(
      `SELECT s.name, tv.tokens AS draft, t.revision,
              hd.content AS header, fd.content AS footer, nd.tree AS menu,
              chosen.id AS page_id, chosen.version_id AS page_version_id,
              ${SITE_CONTENT_COUNTS_SQL}
         FROM sites s
         JOIN themes t ON t.site_id=s.id
         JOIN theme_versions tv ON tv.id=t.draft_version_id
         JOIN global_elements h ON h.site_id=s.id AND h.kind='header'
         JOIN global_element_versions hd ON hd.id=h.draft_version_id
         JOIN global_elements f ON f.site_id=s.id AND f.kind='footer'
         JOIN global_element_versions fd ON fd.id=f.draft_version_id
         JOIN navigations n ON n.site_id=s.id
         JOIN navigation_versions nd ON nd.id=n.draft_version_id
         LEFT JOIN LATERAL (
           SELECT p.id, COALESCE(p.draft_version_id,p.published_version_id) AS version_id
             FROM pages p WHERE p.site_id=s.id AND p.archived_at IS NULL
              AND COALESCE(p.draft_version_id,p.published_version_id) IS NOT NULL
            ORDER BY p.published_version_id IS NULL,p.sort_index,p.slug <> '',p.title
            LIMIT 1
         ) chosen ON true
        WHERE s.id=$1 AND app.can_administer_site($1)`,
      [siteId],
    )
    const row = rows[0]
    if (!row) return null
    const header = normalizeHeaderConfig(row.header, row.name)
    const footer = normalizeFooterConfig(row.footer, row.name)
    if (!header || !footer) throw new Error('Stored header or footer uses an unsupported configuration version.')
    return {
      draft: ThemeTokens.parse(row.draft),
      revision: Number(row.revision),
      header,
      footer,
      menu: NavTree.parse(row.menu),
      page: row.page_id && row.page_version_id ? { id: row.page_id, versionId: row.page_version_id } : null,
      contentSummary: contentCounts(row.page_count, row.story_count),
    }
  })
}
