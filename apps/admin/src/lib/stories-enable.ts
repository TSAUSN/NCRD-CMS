import type { Queryable } from '@cms/platform'
import { createStoriesModel, emptyStoriesSettings, StoriesSetupInput } from '@cms/schema'
import { DomainError } from '@cms/domain'
/** Normal administrator command in the caller's transaction; retries are idempotent. */
export async function enableSiteStories(client: Queryable, siteId: string, input: unknown) {
  const parsed = StoriesSetupInput.safeParse(input)
  if (!parsed.success) throw new DomainError('invalid_state', 'Name both tag groups, using up to 80 characters each.')
  const site = (
    await client.query('SELECT archived_at,app.can_administer_site(id) AS allowed FROM sites WHERE id=$1', [siteId])
  ).rows[0]
  if (!site) throw new DomainError('not_found', 'This site is unavailable.')
  if (!site.allowed) throw new DomainError('not_authorized', 'Only a Site admin can turn on Stories.')
  if (site.archived_at) throw new DomainError('invalid_state', 'Restore this site before turning on Stories.')
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('site-stories:'||$1,0))", [siteId])
  const existing = (
    await client.query("SELECT id FROM collections WHERE site_id=$1 AND reader_key='stories'", [siteId])
  ).rows[0]
  if (existing) return { collectionId: String(existing.id), created: false }
  if ((await client.query("SELECT id FROM collections WHERE site_id=$1 AND slug='stories'", [siteId])).rowCount)
    throw new DomainError(
      'invalid_state',
      'A list already uses the Stories address. Rename that list before turning on Stories.',
    )
  const model = createStoriesModel({ ...emptyStoriesSettings(), ...parsed.data })
  const saved = (
    await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
      siteId,
      'stories',
      'Stories',
      'stories',
      JSON.stringify(model.fields),
      JSON.stringify(model.presentation),
    ])
  ).rows[0]!
  return { collectionId: String(saved.collection_id), created: true }
}
