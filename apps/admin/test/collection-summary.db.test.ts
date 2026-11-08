import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { SiteSetup } from '@cms/schema'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { mapErrors } from '@cms/domain'
let db: TestDatabase, scenario: Scenario
vi.mock('server-only', () => ({}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { getCollectionWorkspace, getReleaseCollectionSelections } from '../src/lib/collection-queries.ts'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { publishStarterFixture } from './site-fixture.ts'

beforeAll(async () => {
  db = await TestDatabase.create('collection_summary')
  scenario = await seedScenario(db)
  await db.asUser(scenario.superAdmin, client => installCoreLibrary(client))
})
afterAll(async () => {
  await db?.close()
})

it('counts actual record changes rather than new version IDs from saving the whole list', async () => {
  let siteId = '',
    collectionId = ''
  await db.asUser(scenario.superAdmin, async client => {
    siteId = (
      await createSiteFromSetupInTransaction(
        client,
        randomUUID(),
        SiteSetup.parse({ ...starterSiteSetup('event'), name: 'Change summary', slug: 'change-summary' }),
        'change-summary.staging.example.test',
      )
    ).siteId
    await publishStarterFixture(client, siteId)
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [scenario.editorA, siteId, 'editor'])
    collectionId = (
      await client.query("SELECT id FROM collections WHERE site_id=$1 AND reader_key='speakers'", [siteId])
    ).rows[0]!.id
    await client.query('SELECT app.save_collection_entries($1,0,$2)', [
      collectionId,
      JSON.stringify(
        ['Jordan', 'Casey'].map(name => ({
          id: null,
          stableKey: name.toLowerCase(),
          values: { name, role: 'Organizer' },
        })),
      ),
    ])
    await client.query('SELECT app.publish_collection_entries($1,1)', [collectionId])
  })
  const missingId = randomUUID()
  const exact = await getReleaseCollectionSelections(scenario.editorA, siteId, [missingId, collectionId])
  expect([...exact.keys()]).toEqual([collectionId])
  expect(exact.get(collectionId)?.id).toBe(collectionId)
  expect(await getReleaseCollectionSelections(scenario.editorB, siteId, [collectionId])).toEqual(new Map())
  const read = () => getCollectionWorkspace(scenario.editorA, siteId, collectionId)
  let state = await read()
  expect(state.selected!.changedEntries).toBe(0)
  const save = async (drafts: { id: string | null; stableKey: string; values: Record<string, unknown> }[]) => {
    const current = await read()
    await db.asUser(scenario.editorA, client =>
      client.query('SELECT app.save_collection_entries($1,$2,$3)', [
        collectionId,
        current.selected!.entryRevision,
        JSON.stringify(drafts),
      ]),
    )
  }
  const drafts = state.selected!.entries.map(({ id, stableKey, values }) => ({ id, stableKey, values }))
  drafts[0]!.values.role = 'Keynote speaker'
  await save(drafts)
  expect((await read()).selected!.changedEntries).toBe(1)
  await save(drafts)
  state = await read()
  expect(state.selected!.changedEntries).toBe(1)
  expect(state.collections.find(item => item.id === collectionId)!.changedEntries).toBe(1)
  await db.asUser(scenario.editorA, client =>
    client.query('SELECT app.publish_collection_entries($1,$2)', [collectionId, state.selected!.entryRevision]),
  )
  expect((await read()).selected!.changedEntries).toBe(0)
  await save([...drafts].reverse())
  expect((await read()).selected!.changedEntries).toBe(2)
  expect((await getCollectionWorkspace(scenario.editorB, siteId, collectionId)).selected).toBeNull()
})
