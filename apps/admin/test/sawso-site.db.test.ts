import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { ensureSawsoSite } from '../src/lib/sawso-site.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('sawso_site')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('initializes the private SAWSO Stories list once and preserves every saved record on retry', async () => {
  const site = await db.asUser(s.superAdmin, c => ensureSawsoSite(c, randomUUID()))
  await db.asUser(s.superAdmin, async c => {
    const rows = () =>
      c.query(
        'SELECT e.id,e.stable_key,e.draft_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index',
        [site.collectionId],
      )
    const before = (await rows()).rows
    expect(before).toHaveLength(34)
    expect(before.filter(row => row.values.body)).toHaveLength(3)
    const collection = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [site.collectionId]))
      .rows[0]!
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      site.collectionId,
      collection.entry_revision,
      JSON.stringify(before.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values }))),
    ])
    const saved = (await rows()).rows
    expect(await ensureSawsoSite(c, randomUUID())).toEqual(site)
    expect((await rows()).rows).toEqual(saved)
  })
  expect(
    (
      await db.asUser(s.editorB, c =>
        c.query('SELECT id FROM collection_entries WHERE collection_id=$1', [site.collectionId]),
      )
    ).rows,
  ).toEqual([])
  expect(
    (await db.as('public', c => c.query('SELECT * FROM public_api.site_routes($1)', [site.hostname]))).rows,
  ).toEqual([])
})
