import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
import { enableSiteStories } from '../src/lib/stories-enable.ts'
import { changeStoriesTags } from '../src/lib/stories-tags.ts'
let db: TestDatabase, s: Scenario
const setup = { mainLabel: 'Topics', secondaryLabel: 'Places', publishUnreviewed: true }
beforeAll(async () => {
  db = await TestDatabase.create('stories_enable')
  s = await seedScenario(db)
})
afterAll(async () => db.close())
it('creates one empty private site-owned catalog through existing administrator commands, without borrowing stories or a source', async () => {
  for (const user of [s.editorA, s.contributorA])
    await expect(mapErrors(() => db.asUser(user, c => enableSiteStories(c, s.siteA, setup)))).rejects.toMatchObject({
      kind: 'not_authorized',
    })
  await expect(db.asUser(s.editorB, c => enableSiteStories(c, s.siteA, setup))).rejects.toMatchObject({
    kind: 'not_found',
  })
  await db.asUser(s.superAdmin, c =>
    c.query("SELECT app.set_site_membership($1,$2,'site_admin')", [s.editorA, s.siteA]),
  )
  const result = await db.asUser(s.editorA, c => enableSiteStories(c, s.siteA, setup))
  expect(result.created).toBe(true)
  const repeated = await db.asUser(s.editorA, c =>
    enableSiteStories(c, s.siteA, { ...setup, mainLabel: 'Ignored retry' }),
  )
  expect(repeated).toEqual({ collectionId: result.collectionId, created: false })
  const state = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query(
          'SELECT c.published_schema_version_id,c.entry_revision,v.sort,(SELECT count(*) FROM collection_entries e WHERE e.collection_id=c.id)::int AS entries FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
          [result.collectionId],
        )
      ).rows[0]!,
  )
  expect(state).toMatchObject({
    published_schema_version_id: null,
    entry_revision: '0',
    entries: 0,
    sort: { stories: { ...setup, source: 'none', mainTags: [], secondaryTags: [] } },
  })
  const other = await db.asUser(s.superAdmin, c =>
    enableSiteStories(c, s.siteB, { ...setup, mainLabel: 'Themes', publishUnreviewed: false }),
  )
  expect(other.collectionId).not.toBe(result.collectionId)
  const changed = await db.asUser(s.editorA, c =>
    changeStoriesTags(c, s.siteA, result.collectionId, '1', '0', { action: 'review-policy', publishUnreviewed: false }),
  )
  expect(changed.settings.publishUnreviewed).toBe(false)
  expect(
    await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query('SELECT count(*)::int AS n FROM collections WHERE reader_key=$1', ['stories'])).rows[0]!.n,
    ),
  ).toBe(2)
})
it('rejects blank labels and unexpected source settings atomically', async () => {
  for (const input of [
    { ...setup, mainLabel: ' ' },
    { ...setup, source: 'sawso' },
  ])
    await expect(db.asUser(s.superAdmin, c => enableSiteStories(c, s.siteB, input))).rejects.toMatchObject({
      kind: 'invalid_state',
    })
})
