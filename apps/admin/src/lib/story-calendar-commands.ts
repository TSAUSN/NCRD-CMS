import type { Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { validStoryDay } from './story-calendar.ts'
/** A chosen day changes one ordinary private record; publication still requires
 * the normal immutable review. Cancel before this command writes nothing. */
export async function saveStoryCalendarDay(
  client: Queryable,
  siteId: string,
  collectionId: string,
  entryId: string,
  revision: string,
  day: string,
) {
  if (!/^\d+$/.test(revision) || !validStoryDay(day))
    throw new DomainError('invalid_state', 'Choose a valid story day.')
  const list = (
    await client.query(
      "SELECT entry_revision,app.can_publish(site_id) AS allowed FROM collections WHERE id=$1 AND site_id=$2 AND reader_key='stories'",
      [collectionId, siteId],
    )
  ).rows[0]
  if (!list) throw new DomainError('not_found', 'This story is unavailable.')
  if (!list.allowed) throw new DomainError('not_authorized', 'Your role cannot schedule this story.')
  const rows = (
    await client.query(
      'SELECT e.id,e.stable_key,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.created_at,e.id',
      [collectionId],
    )
  ).rows
  const target = rows.find(row => row.id === entryId)
  if (!target) throw new DomainError('not_found', 'This story is unavailable.')
  if (target.published_version_id || (target.values.published_date && target.values.published_date !== day))
    throw new DomainError('invalid_state', 'Open this dated story to change its publication plan.')
  if (target.values.published_date === day) return { revision: String(list.entry_revision), values: target.values }
  if (String(list.entry_revision) !== revision)
    throw new DomainError('stale_revision', 'Stories changed. Reload Coming up before choosing a day.')
  const saved = (
    await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collectionId,
      revision,
      JSON.stringify(
        rows.map(row => ({
          id: row.id,
          stableKey: row.stable_key,
          values: row.id === entryId ? { ...row.values, published_date: day } : row.values,
        })),
      ),
    ])
  ).rows[0]!
  return { revision: String(saved.entry_revision), values: { ...target.values, published_date: day } }
}
