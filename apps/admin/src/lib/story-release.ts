import type { Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { releaseCandidates, type ReleaseItem } from './releases.ts'

/** Select only the saved Story and its own article page. Normal release review,
 * permissions, sample checks and scheduling remain the only publication path. */
export async function storyReleaseSelection(
  client: Queryable,
  siteId: string,
  entryId: string,
): Promise<ReleaseItem[]> {
  const row = (
    await client.query<{ collection_id: string; changed: boolean; page_id: string | null; story_date: string | null }>(
      `
  SELECT c.id AS collection_id,(e.draft_version_id IS DISTINCT FROM e.published_version_id OR e.sort_index IS DISTINCT FROM e.published_sort_index) AS changed,p.id AS page_id,v.values->>'published_date' AS story_date
  FROM collection_entries e JOIN collections c ON c.id=e.collection_id JOIN collection_entry_versions v ON v.id=e.draft_version_id
  LEFT JOIN pages p ON p.site_id=c.site_id AND app.page_path(p.slug)=v.values->>'story_url' AND p.archived_at IS NULL
  WHERE e.id=$1 AND c.site_id=$2 AND c.reader_key='stories' AND e.archived_at IS NULL`,
      [entryId, siteId],
    )
  ).rows[0]
  if (!row) throw new DomainError('not_found', 'This story is unavailable to this site.')
  if (!row.story_date)
    throw new DomainError('invalid_state', 'Choose a story date before publishing or scheduling this story.')
  const candidates = await releaseCandidates(client, siteId),
    selected: ReleaseItem[] = []
  if (row.changed) {
    const items = candidates.find(item => item.type === 'collection_entries' && item.id === row.collection_id)
    if (!items) throw new DomainError('stale_revision', 'Stories changed. Save and review this story again.')
    const fields = candidates.find(item => item.type === 'collection_schema' && item.id === row.collection_id)
    if (fields) selected.push(fields)
    selected.push({ ...items, entryIds: [entryId] })
  }
  const page = candidates.find(item => item.type === 'page' && item.id === row.page_id)
  if (page) selected.push(page)
  if (!selected.length) throw new DomainError('invalid_state', 'This story has no saved changes to publish.')
  return selected
}
