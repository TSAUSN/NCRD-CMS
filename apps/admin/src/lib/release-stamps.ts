import 'server-only'
import { asUser } from '@cms/platform'
import type { ReleaseItem } from './releases.ts'
export type ReleaseStamp = { actor: string; when: string }
const tables = {
  page: 'page_versions',
  theme: 'theme_versions',
  navigation: 'navigation_versions',
  frame: 'global_element_versions',
  collection_schema: 'collection_schema_versions',
  chapter_setup: 'chapter_versions',
  site_settings: 'site_setting_versions',
} as const
/** Informational saved-version stamps stay separate from immutable publication pins. */
export function releaseStamps(
  userId: string,
  siteId: string,
  items: ReleaseItem[],
): Promise<Record<string, ReleaseStamp>> {
  return asUser({ userId }, async client => {
    const result: Record<string, ReleaseStamp> = {}
    const rows: Record<string, { author_id: string | null; created_at: Date }> = {}
    for (const [kind, table] of Object.entries(tables)) {
      const ids = items
        .filter(item => item.type === kind)
        .flatMap(item => [item.versionId, item.secondaryVersionId].filter((id): id is string => Boolean(id)))
      if (!ids.length) continue
      for (const row of (
        await client.query<{ id: string; author_id: string; created_at: Date }>(
          'SELECT id,author_id,created_at FROM ' + table + ' WHERE site_id=$1 AND id=ANY($2::uuid[])',
          [siteId, ids],
        )
      ).rows)
        rows[row.id] = row
    }
    const files = items
      .filter(item => item.type === 'site_files')
      .map(item => item.versionId)
      .filter(Boolean)
    if (files.length)
      for (const row of (
        await client.query<{ id: string; author_id: string; created_at: Date }>(
          'SELECT id,reviewed_by AS author_id,reviewed_at AS created_at FROM site_file_versions WHERE site_id=$1 AND id=ANY($2::uuid[])',
          [siteId, files],
        )
      ).rows)
        rows[row.id] = row
    const store = (item: ReleaseItem, row: { author_id: string | null; created_at: Date } | undefined) => {
      if (row)
        result[item.key] = {
          actor: row.author_id === userId ? 'You' : row.author_id ? 'Another editor' : 'Not recorded',
          when: row.created_at.toISOString(),
        }
    }
    const frameChanged = items.some(item => item.type === 'frame')
      ? new Set(
          (
            await client.query<{ draft_version_id: string }>(
              'SELECT draft_version_id FROM global_elements WHERE site_id=$1 AND draft_version_id IS DISTINCT FROM published_version_id',
              [siteId],
            )
          ).rows.map(row => row.draft_version_id),
        )
      : null
    for (const item of items) {
      if (item.type === 'collection_entries') {
        const row = (
          await client.query<{ author_id: string | null; created_at: Date }>(
            `SELECT CASE WHEN e.archived_at>v.created_at THEN NULL ELSE v.author_id END AS author_id,GREATEST(v.created_at,e.archived_at) AS created_at FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.site_id=$1 AND e.collection_id=$2 AND ($3::uuid[] IS NULL OR e.id=ANY($3::uuid[])) AND (e.draft_version_id IS DISTINCT FROM e.published_version_id OR e.archived_at>v.created_at) ORDER BY GREATEST(v.created_at,e.archived_at) DESC LIMIT 1`,
            [siteId, item.id, item.entryIds ?? null],
          )
        ).rows[0]
        store(item, row)
      } else
        store(
          item,
          [item.versionId, item.secondaryVersionId]
            .filter(id => item.type !== 'frame' || frameChanged?.has(id ?? ''))
            .map(id => rows[id ?? ''])
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0],
        )
    }
    return result
  })
}
