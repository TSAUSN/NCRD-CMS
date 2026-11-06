import { afterAll, beforeAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TestDatabase } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario, list: string
const fields = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'tags', label: 'Tags', type: 'text', required: false },
  { key: 'track', label: 'Track', type: 'select', required: false, options: ['Community', 'Wellbeing'] },
]
const item = [{ type: 'element', tag: 'article', children: [{ type: 'text', field: 'name' }] }]
beforeAll(async () => {
  db = await TestDatabase.create('list_selection')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async client => {
    const created = (
      await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        'chosen-speakers',
        'Speakers',
        'chosen_speakers',
        JSON.stringify(fields),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'name',
          subtitleField: null,
          imageField: null,
          groupField: null,
        }),
      ])
    ).rows[0]!
    list = created.collection_id
    await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [list, created.revision])
    for (const [index, values] of [
      { name: 'Earlier', tags: 'Family, Community', track: 'Community' },
      { name: 'Middle', tags: 'community-based', track: 'Wellbeing' },
      { name: 'Latest', tags: 'community', track: 'Community' },
    ].entries()) {
      const previous = (
        await client.query(
          'SELECT e.id,e.stable_key AS "stableKey",v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index',
          [list],
        )
      ).rows
      await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        list,
        index,
        JSON.stringify([...previous, { id: null, stableKey: ['earlier', 'middle', 'latest'][index], values }]),
      ])
    }
    await client.query('SELECT * FROM app.publish_collection_entries($1,3)', [list])
  })
  await db.as('owner', client =>
    client.query(
      "UPDATE collection_entries SET created_at=CASE stable_key WHEN 'earlier' THEN '2026-01-01'::timestamptz WHEN 'middle' THEN '2026-02-01'::timestamptz ELSE '2026-03-01'::timestamptz END WHERE collection_id=$1",
      [list],
    ),
  )
})
afterAll(async () => {
  await db?.close()
})
async function resolve(selection: unknown) {
  return db.as('owner', async client =>
    (
      await client.query('SELECT app.resolve_collection_repeat($1,$2,$3,$4) AS result', [
        s.siteA,
        'chosen_speakers',
        JSON.stringify(selection),
        JSON.stringify(item),
      ])
    ).rows[0]!.result.entries.map((entry: { stableKey: string }) => entry.stableKey),
  )
}
it('sorts dynamically by added date and matches exact comma-separated tags or categories', async () => {
  expect(await resolve({ mode: 'automatic', limit: 2, order: 'newest' })).toEqual(['latest', 'middle'])
  expect(await resolve({ mode: 'automatic', limit: 125, order: 'newest' })).toEqual(['latest', 'middle', 'earlier'])
  expect(await resolve({ mode: 'automatic', limit: 100, filter: { field: 'tags', value: ' COMMUNITY ' } })).toEqual([
    'earlier',
    'latest',
  ])
  expect(
    await resolve({ mode: 'automatic', limit: 1, filter: { field: 'track', value: 'Community' }, order: 'newest' }),
  ).toEqual(['latest'])
  expect(await resolve({ mode: 'automatic', limit: 100, filter: { field: 'tags', value: 'missing' } })).toEqual([])
})
it('refuses unbounded, undeclared, malformed and foreign selections without granting a new reader', async () => {
  for (const selection of [
    { mode: 'automatic', limit: 201, order: 'newest' },
    { mode: 'automatic', limit: 1, order: 'random' },
    { mode: 'automatic', limit: 1, filter: { field: 'name', value: 'Earlier' } },
    { mode: 'automatic', limit: 1, filter: { field: 'track', value: '', sql: 'true' } },
  ])
    await expect(resolve(selection)).rejects.toMatchObject({ code: 'CMS04' })
  await expect(
    db.as('owner', client =>
      client.query('SELECT app.resolve_collection_repeat($1,$2,$3,$4)', [
        s.siteB,
        'chosen_speakers',
        '{"mode":"automatic","limit":1,"order":"newest"}',
        JSON.stringify(item),
      ]),
    ),
  ).rejects.toMatchObject({ code: 'CMS04' })
  await expect(
    db.asUser(s.contributorA, client =>
      client.query('SELECT app.normalize_list_selection($1,$2,$3,false)', [
        s.siteA,
        'chosen_speakers',
        '{"mode":"automatic","limit":1,"order":"newest"}',
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' })
})
it('keeps publication pointers and records unchanged on an idempotent migration repeat', async () => {
  const before = await db.as(
    'owner',
    async client => (await client.query('SELECT * FROM collections WHERE id=$1', [list])).rows,
  )
  await db.as('owner', client =>
    client.query(readFileSync(new URL('../migrations/0126_list_selection.sql', import.meta.url), 'utf8')),
  )
  expect(await resolve({ mode: 'automatic', limit: 2, order: 'newest' })).toEqual(['latest', 'middle'])
  expect(
    await db.as('owner', async client => (await client.query('SELECT * FROM collections WHERE id=$1', [list])).rows),
  ).toEqual(before)
})
it('adds new matching drafts privately and includes them in public choices only after publication', async () => {
  await db.asUser(s.editorA, async client => {
    const existing = (
      await client.query(
        'SELECT e.id,e.stable_key AS "stableKey",v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index',
        [list],
      )
    ).rows
    const revision = (await client.query('SELECT entry_revision FROM collections WHERE id=$1', [list])).rows[0]!
      .entry_revision
    await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list,
      revision,
      JSON.stringify([
        ...existing,
        {
          id: null,
          stableKey: 'new-draft',
          values: { name: 'A private addition', tags: 'Community', track: 'Community' },
        },
      ]),
    ])
  })
  const selection = { mode: 'automatic', limit: 1, order: 'newest', filter: { field: 'tags', value: 'Community' } }
  expect(await resolve(selection)).toEqual(['latest'])
  const draft = await db.as(
    'owner',
    async client =>
      (
        await client.query('SELECT app.normalize_list_selection($1,$2,$3,true) AS selection', [
          s.siteA,
          'chosen_speakers',
          JSON.stringify(selection),
        ])
      ).rows[0]!.selection,
  )
  expect(draft).toEqual({ mode: 'manual', stableKeys: ['new-draft'] })
  await db.asUser(s.editorA, async client => {
    const revision = (await client.query('SELECT entry_revision FROM collections WHERE id=$1', [list])).rows[0]!
      .entry_revision
    await client.query('SELECT * FROM app.publish_collection_entries($1,$2)', [list, revision])
  })
  expect(await resolve(selection)).toEqual(['new-draft'])
})
