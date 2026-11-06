import { beforeAll, afterAll, it, expect } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
import { createStoriesModel, emptyStoriesSettings } from '../src/index.ts'
let db: TestDatabase, s: Scenario, list: string, generic: string
beforeAll(async () => {
  db = await TestDatabase.create('story_save')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    const model = createStoriesModel(emptyStoriesSettings())
    for (const key of ['stories', 'other_records']) {
      const created = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          s.siteA,
          key.replaceAll('_', '-'),
          key,
          key,
          JSON.stringify(model.fields),
          JSON.stringify(model.presentation),
        ])
      ).rows[0]!
      if (key === 'stories') list = created.collection_id
      else generic = created.collection_id
      await c.query('SELECT app.publish_collection_schema($1,$2)', [created.collection_id, created.revision])
      const saved = (
        await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
          created.collection_id,
          JSON.stringify(
            [1, 2].map(n => ({
              id: null,
              stableKey: 'story-' + n,
              values: {
                title: '[Story ' + n + ']',
                summary: '[Description]',
                published_date: '2026-10-31',
                story_url: '/stories/story-' + n,
                body: '<p>[Story text]</p>',
              },
            })),
          ),
        ])
      ).rows[0]!
      await c.query('SELECT app.publish_collection_entries($1,$2)', [created.collection_id, saved.entry_revision])
    }
  })
})
afterAll(async () => {
  await db?.close()
})
async function state(id = list) {
  return db.asUser(s.superAdmin, async c => ({
    head: (await c.query('SELECT * FROM collections WHERE id=$1', [id])).rows[0]!,
    entries: (
      await c.query(
        'SELECT e.*,v.values,v.schema_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
        [id],
      )
    ).rows,
    versions: (await c.query('SELECT * FROM collection_entry_versions WHERE collection_id=$1 ORDER BY id', [id])).rows,
  }))
}
const batch = (rows: Awaited<ReturnType<typeof state>>['entries']) =>
  rows.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values }))
it('leaves a completely unchanged published Stories list and every immutable version exactly as it was', async () => {
  const before = await state(),
    result = await db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        list,
        before.head.entry_revision,
        JSON.stringify(batch(before.entries)),
      ]),
    )
  expect(String(result.rows[0]!.entry_revision)).toBe(String(before.head.entry_revision))
  expect(await state()).toEqual(before)
})
it('versions only the changed Story while preserving another Story draft and both public pointers', async () => {
  const before = await state(),
    values = batch(before.entries)
  values[0]!.values = { ...values[0]!.values, summary: '[Changed description]' }
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list,
      before.head.entry_revision,
      JSON.stringify(values),
    ]),
  )
  const after = await state()
  expect(after.entries[1]).toEqual(before.entries[1])
  expect(after.entries[0]!.draft_version_id).not.toBe(before.entries[0]!.draft_version_id)
  expect(after.entries[0]!.published_version_id).toBe(before.entries[0]!.published_version_id)
  expect(after.versions.length).toBe(before.versions.length + 1)
  expect(Number(after.head.entry_revision)).toBe(Number(before.head.entry_revision) + 1)
})
it('still records actual reordering, draft removal and restoration without changing public heads', async () => {
  const before = await state(),
    original = batch(before.entries)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list,
      before.head.entry_revision,
      JSON.stringify([...original].reverse()),
    ]),
  )
  let current = await state()
  expect(current.entries.map(row => row.id)).toEqual(before.entries.map(row => row.id).reverse())
  expect(current.versions.length).toBe(before.versions.length + 2)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list,
      current.head.entry_revision,
      JSON.stringify(batch(current.entries).slice(0, 1)),
    ]),
  )
  current = await state()
  expect(current.entries.filter(row => row.archived_at !== null)).toHaveLength(1)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list,
      current.head.entry_revision,
      JSON.stringify(original),
    ]),
  )
  current = await state()
  expect(current.entries.every(row => row.archived_at === null)).toBe(true)
  for (const row of current.entries)
    expect(row.published_version_id).toBe(before.entries.find(previous => previous.id === row.id)!.published_version_id)
})
it('versions rows for a real field upgrade even when their existing words are unchanged', async () => {
  const before = await state()
  await db.asUser(s.superAdmin, async c => {
    const schema = (
        await c.query('SELECT fields,sort FROM collection_schema_versions WHERE id=$1', [
          before.head.draft_schema_version_id,
        ])
      ).rows[0]!,
      saved = (
        await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
          list,
          before.head.revision,
          JSON.stringify([
            ...schema.fields,
            { key: 'checked_note', label: 'Checked note', type: 'text', required: false },
          ]),
          JSON.stringify(schema.sort),
        ])
      ).rows[0]!
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list,
      before.head.entry_revision,
      JSON.stringify(batch(before.entries)),
    ])
    const current = (
      await c.query(
        'SELECT v.schema_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
        [list],
      )
    ).rows
    expect(current.every(row => row.schema_version_id === saved.schema_version_id)).toBe(true)
  })
  const after = await state()
  expect(after.versions.length).toBe(before.versions.length + 2)
  for (const row of after.entries)
    expect(row.values.summary).toBe(before.entries.find(previous => previous.id === row.id)!.values.summary)
})
it('does not bypass missing/stale revision, foreign-role, batch-shape or ownership checks for apparently unchanged Stories', async () => {
  const before = await state(),
    values = batch(before.entries)
  for (const revision of [null, '999999'])
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [list, revision, JSON.stringify(values)]),
      ),
      'CMS01',
    )
  await expectSqlState(
    db.asUser(s.editorB, c =>
      c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        list,
        before.head.entry_revision,
        JSON.stringify(values),
      ]),
    ),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        list,
        before.head.entry_revision,
        JSON.stringify([{ ...values[0], extra: true }]),
      ]),
    ),
    'CMS04',
  )
  const other = await state(generic)
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        list,
        before.head.entry_revision,
        JSON.stringify([{ ...values[0], id: other.entries[0]!.id }]),
      ]),
    ),
    'CMS04',
  )
  expect(await state()).toEqual(before)
})
it('keeps the previous save/version behavior for ordinary non-Story lists', async () => {
  const before = await state(generic)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      generic,
      before.head.entry_revision,
      JSON.stringify(batch(before.entries)),
    ]),
  )
  const after = await state(generic)
  expect(Number(after.head.entry_revision)).toBe(Number(before.head.entry_revision) + 1)
  expect(after.versions.length).toBe(before.versions.length + 2)
  for (const row of after.entries)
    expect(row.values).toEqual(before.entries.find(previous => previous.id === row.id)!.values)
})
