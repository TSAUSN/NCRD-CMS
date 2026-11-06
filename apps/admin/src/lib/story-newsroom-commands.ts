import type { Queryable } from '@cms/platform'
import { CollectionModel, withStoriesCatalog, storyFeatureRank } from '@cms/schema'
import { DomainError } from '@cms/domain'
import { isDeepStrictEqual } from 'node:util'
import { storyListValues } from './story-list.ts'
async function load(client: Queryable, siteId: string, collectionId: string, revision: string, entryRevision: string) {
  if (!/^\d+$/.test(revision) || !/^\d+$/.test(entryRevision))
    throw new DomainError('invalid_state', 'Reload Stories before saving.')
  const head = (
    await client.query(
      `SELECT c.revision::text,c.entry_revision::text,v.fields,v.sort,app.can_administer_site(c.site_id) AS admin FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1 AND c.site_id=$2 AND c.reader_key='stories'`,
      [collectionId, siteId],
    )
  ).rows[0]
  if (!head) throw new DomainError('not_found', 'Stories is unavailable.')
  if (head.revision !== revision || head.entry_revision !== entryRevision)
    throw new DomainError('stale_revision', 'Saved Stories changed. Review the saved order before trying again.')
  const model = CollectionModel.parse({ fields: head.fields, presentation: head.sort })
  return { head, model }
}
export async function updateStoriesWriting(
  client: Queryable,
  siteId: string,
  collectionId: string,
  revision: string,
  entryRevision: string,
) {
  const { head, model } = await load(client, siteId, collectionId, revision, entryRevision)
  if (!head.admin) throw new DomainError('not_authorized', 'A Site admin updates Stories.')
  if (!model.presentation.stories)
    throw new DomainError('invalid_state', 'Finish Stories setup before adding its new controls.')
  const next = withStoriesCatalog(model, model.presentation.stories)
  if (isDeepStrictEqual(next, model)) return { revision, entryRevision }
  const saved = (
    await client.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
      collectionId,
      revision,
      JSON.stringify(next.fields),
      JSON.stringify(next.presentation),
    ])
  ).rows[0]!
  return { revision: String(saved.revision), entryRevision }
}
export async function saveNewsroomOrder(
  client: Queryable,
  siteId: string,
  collectionId: string,
  revision: string,
  entryRevision: string,
  ids: unknown,
) {
  const { model } = await load(client, siteId, collectionId, revision, entryRevision)
  if (
    !Array.isArray(ids) ||
    ids.length > 5 ||
    ids.some(id => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw new DomainError('invalid_state', 'Choose each featured story once, up to 5.')
  if (!model.fields.some(field => field.key === 'newsroom_rank' && field.type === 'number'))
    throw new DomainError('invalid_state', 'A Site admin needs to update Stories first.')
  const rows = (
      await client.query(
        'SELECT e.id,e.stable_key,v.values,p.values AS published_values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id LEFT JOIN collection_entry_versions p ON p.id=e.published_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.created_at,e.id',
        [collectionId],
      )
    ).rows,
    featured = rows.filter(row => storyFeatureRank(row.values))
  if (featured.length !== ids.length || featured.some(row => !ids.includes(row.id)))
    throw new DomainError('stale_revision', 'The featured stories changed. Review the saved list before reordering.')
  const next = rows.map(row => ({
    ...row,
    values: storyFeatureRank(row.values) ? { ...row.values, newsroom_rank: ids.indexOf(row.id) + 1 } : row.values,
  }))
  let savedRevision = entryRevision
  if (next.some((row, index) => !isDeepStrictEqual(row.values, rows[index]!.values))) {
    const saved = (
      await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        collectionId,
        entryRevision,
        JSON.stringify(next.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values }))),
      ])
    ).rows[0]!
    savedRevision = String(saved.entry_revision)
  }
  return {
    catalogRevision: revision,
    entryRevision: savedRevision,
    entries: next.map(row => ({
      id: String(row.id),
      values: storyListValues(row.values),
      changed: !isDeepStrictEqual(row.values, row.published_values),
    })),
  }
}
