import { isDeepStrictEqual } from 'node:util'
import type { Queryable } from '@cms/platform'
import {
  CollectionModel,
  StoryListPatch,
  featureStoryRows,
  applyStoryListPatch,
  parseCollectionEntryValues,
  storyTagIds,
} from '@cms/schema'
import { DomainError } from '@cms/domain'
import { escapeText } from '@cms/renderer'
import { storyListValues } from './story-list.ts'
/** Only the requested tags/flags change. Article fields come from the server. */
export async function patchStoryList(
  client: Queryable,
  siteId: string,
  collectionId: string,
  entryId: string,
  catalogRevision: string,
  entryRevision: string,
  input: unknown,
) {
  const parsed = StoryListPatch.safeParse(input)
  if (!parsed.success || !/^\d+$/.test(catalogRevision) || !/^\d+$/.test(entryRevision))
    throw new DomainError('invalid_state', 'Choose a tag or review setting and try again.')
  const list = (
    await client.query(
      `SELECT c.revision,c.entry_revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.site_id=$1 AND c.id=$2 AND c.reader_key='stories'`,
      [siteId, collectionId],
    )
  ).rows[0]
  if (!list) throw new DomainError('not_found', 'Stories is unavailable.')
  if (String(list.revision) !== catalogRevision || String(list.entry_revision) !== entryRevision)
    throw new DomainError('stale_revision', 'Someone else changed Stories. Your tag choices have not been saved.')
  const model = CollectionModel.parse({ fields: list.fields, presentation: list.sort }),
    settings = model.presentation.stories
  if (!settings)
    throw new DomainError(
      'invalid_state',
      'A Site admin needs to finish the Stories update before tags can be saved here.',
    )
  const rows = (
      await client.query(
        `SELECT e.id,e.stable_key,v.values,p.values AS published_values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id LEFT JOIN collection_entry_versions p ON p.id=e.published_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.created_at,e.id`,
        [collectionId],
      )
    ).rows,
    target = rows.find(e => e.id === entryId)
  if (!target) throw new DomainError('not_found', 'This story is unavailable.')
  if (parsed.data.action === 'featured') {
    if (!model.fields.some(field => field.key === 'newsroom_rank' && field.type === 'number'))
      throw new DomainError('invalid_state', 'A Site admin needs to update Stories before featuring a story.')
    let next
    try {
      next = featureStoryRows(
        rows.map(row => ({ id: String(row.id), values: row.values })),
        entryId,
        parsed.data.value,
      )
    } catch (error) {
      throw new DomainError(
        'invalid_state',
        error instanceof Error ? error.message : 'Choose up to 5 featured stories.',
      )
    }
    if (next.every((row, index) => isDeepStrictEqual(row.values, rows[index]!.values)))
      return {
        catalogRevision,
        entryRevision,
        entryId,
        values: storyListValues(target.values),
        changed: !isDeepStrictEqual(target.values, target.published_values),
        entries: rows.map(row => ({
          id: String(row.id),
          values: storyListValues(row.values),
          changed: !isDeepStrictEqual(row.values, row.published_values),
        })),
      }
    const result = (
      await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        collectionId,
        entryRevision,
        JSON.stringify(
          rows.map((row, index) => ({ id: row.id, stableKey: row.stable_key, values: next[index]!.values })),
        ),
      ])
    ).rows[0]!
    const entries = next.map((row, index) => ({
        id: row.id,
        values: storyListValues(row.values),
        changed: !isDeepStrictEqual(row.values, rows[index]!.published_values),
      })),
      saved = entries.find(row => row.id === entryId)!
    return {
      catalogRevision,
      entryRevision: String(result.entry_revision),
      entryId,
      values: saved.values,
      changed: saved.changed,
      entries,
    }
  }
  let values: Record<string, unknown>
  try {
    values = applyStoryListPatch(target.values, parsed.data, settings)
  } catch {
    throw new DomainError('stale_revision', 'Tags changed. Your choices have not been saved. Reload Stories.')
  }
  values.region_label = storyTagIds(values, 'secondary')
    .map(id => settings.secondaryTags.find(t => t.id === id)?.label ?? id)
    .join(', ')
  if (parsed.data.action === 'tag' && parsed.data.group === 'main') {
    const paths = new Set(
      (await client.query('SELECT slug FROM pages WHERE site_id=$1 AND archived_at IS NULL', [siteId])).rows.map(row =>
        String(row.slug),
      ),
    )
    values.sector_links = storyTagIds(values, 'main')
      .map(id => {
        const label = escapeText(settings.mainTags.find(t => t.id === id)?.label ?? id),
          path = 'ways-we-help/' + id
        return paths.has(path) ? '<a href="/' + path + '">' + label + '</a>' : label
      })
      .join(' ')
  }
  const checked = parseCollectionEntryValues(model.fields, values)
  if (!checked.ok)
    throw new DomainError('invalid_state', 'The story could not be saved. Open Edit story to check its fields.')
  const changed = !isDeepStrictEqual(checked.values, target.published_values)
  if (isDeepStrictEqual(checked.values, target.values))
    return { catalogRevision, entryRevision, entryId, values: storyListValues(checked.values), changed }
  const result = (
    await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collectionId,
      entryRevision,
      JSON.stringify(
        rows.map(row => ({
          id: row.id,
          stableKey: row.stable_key,
          values: row.id === entryId ? checked.values : row.values,
        })),
      ),
    ])
  ).rows[0]!
  return {
    catalogRevision,
    entryRevision: String(result.entry_revision),
    entryId,
    values: storyListValues(checked.values),
    changed,
  }
}
