import { beforeAll, afterAll, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TestDatabase } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { createStoriesModel, emptyStoriesSettings } from '../src/content/index.ts'
let db: TestDatabase, s: Scenario, list: string
const item = [{ type: 'element', tag: 'article', children: [{ type: 'text', field: 'title' }] }]
const rows = [
  { key: 'both', tags: 'health, education', region: 'africa', reviewed: true },
  { key: 'education', tags: 'education', region: 'asia', reviewed: true },
  { key: 'europe', tags: 'health', region: 'europe', reviewed: true },
  { key: 'none', tags: '', region: '', reviewed: true },
  { key: 'unreviewed', tags: 'health', region: 'africa', reviewed: false },
  { key: 'hidden', tags: 'health', region: 'africa', reviewed: true, hidden: true },
  { key: 'removed', tags: 'health', region: 'africa', reviewed: true, feed_removed: true },
  { key: 'multi-region', tags: 'health', region: 'europe', regions: 'asia, africa', reviewed: true },
]
beforeAll(async () => {
  db = await TestDatabase.create('story_tag_selection')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    const model = createStoriesModel({
        ...emptyStoriesSettings(),
        mainTags: ['health', 'education'].map(id => ({ id, label: id, keywords: [] })),
        secondaryTags: ['africa', 'asia', 'europe'].map(id => ({ id, label: id, keywords: [], areas: [] })),
      }),
      created = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          s.siteA,
          'stories',
          'Stories',
          'stories',
          JSON.stringify(model.fields),
          JSON.stringify(model.presentation),
        ])
      ).rows[0]!
    list = created.collection_id
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [list, created.revision])
    const head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [list])).rows[0]!
    const saved = (
      await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        list,
        head.entry_revision,
        JSON.stringify(
          rows.map(({ key, ...values }) => ({
            id: null,
            stableKey: key,
            values: {
              ...values,
              title: key,
              summary: '[Description]',
              published_date: new Date().toISOString().slice(0, 10),
              story_url: '/stories/' + key,
            },
          })),
        ),
      ])
    ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [list, saved.entry_revision])
    const ordinary = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        'ordinary',
        'Ordinary list',
        'other_reader',
        JSON.stringify([{ key: 'title', label: 'Title', type: 'text', required: true }]),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'title',
          subtitleField: null,
          imageField: null,
          groupField: null,
        }),
      ])
    ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [ordinary.collection_id, ordinary.revision])
  })
})
afterAll(async () => db?.close())
const selection = (main: string[], secondary: string[]) => ({
  mode: 'automatic',
  limit: 200,
  storyTags: { main, secondary },
})
async function selected(value: unknown, draft = false, site = s.siteA) {
  return db.as('owner', async c =>
    (
      await c.query('SELECT app.normalize_list_selection($1,$2,$3,$4) AS result', [
        site,
        'stories',
        JSON.stringify(value),
        draft,
      ])
    ).rows[0]!.result.stableKeys.sort(),
  )
}
it('uses OR within each group, AND between groups, multiple regions and legacy region fallback while retaining visibility rules', async () => {
  expect(await selected(selection(['health', 'education'], ['africa', 'asia']))).toEqual([
    'both',
    'education',
    'multi-region',
    'unreviewed',
  ])
  expect(await selected(selection(['health'], ['asia']))).toEqual(['multi-region'])
  expect(await selected(selection([], ['europe']))).toEqual(['europe'])
  expect(await selected(selection(['education'], []))).toEqual(['both', 'education'])
  expect(await selected(selection([], []))).toEqual([
    'both',
    'education',
    'europe',
    'multi-region',
    'none',
    'unreviewed',
  ])
  expect(await selected(selection(['missing'], []))).toEqual([])
})
it('keeps new matching drafts private until publication and resolves the same verified entry envelope', async () => {
  await db.asUser(s.editorA, async c => {
    const entries = (
        await c.query(
          'SELECT e.id,e.stable_key AS "stableKey",v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index',
          [list],
        )
      ).rows,
      head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [list])).rows[0]!
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list,
      head.entry_revision,
      JSON.stringify(
        entries.map(entry => ({
          ...entry,
          values: entry.stableKey === 'europe' ? { ...entry.values, regions: 'asia' } : entry.values,
        })),
      ),
    ])
  })
  expect(await selected(selection(['health'], ['asia']))).toEqual(['multi-region'])
  expect(await selected(selection(['health'], ['asia']), true)).toEqual(['europe', 'multi-region'])
  const envelope = await db.as(
    'owner',
    async c =>
      (
        await c.query('SELECT app.resolve_collection_repeat($1,$2,$3,$4) AS result', [
          s.siteA,
          'stories',
          JSON.stringify(selection(['health'], ['asia'])),
          JSON.stringify(item),
        ])
      ).rows[0]!.result,
  )
  expect(envelope.entries.map((e: { stableKey: string }) => e.stableKey)).toEqual(['multi-region'])
  expect(envelope.readerKey).toBe('stories')
  await db.asUser(s.editorA, async c => {
    const head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [list])).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [list, head.entry_revision])
  })
  expect(await selected(selection(['health'], ['asia']))).toEqual(['europe', 'multi-region'])
})
it('refuses malformed or foreign choices and preserves existing command permissions', async () => {
  const malformed = [
    null,
    [],
    {},
    { main: [], secondary: [], extra: true },
    { main: 'health', secondary: [] },
    { main: [12], secondary: [] },
    { main: ['health', 'health'], secondary: [] },
    { main: ['Health'], secondary: [] },
    { main: ['a'.repeat(81)], secondary: [] },
    { main: Array.from({ length: 101 }, (_, i) => 'tag-' + i), secondary: [] },
  ]
  for (const storyTags of malformed)
    await expect(selected({ mode: 'automatic', limit: 6, storyTags })).rejects.toMatchObject({ code: 'CMS04' })
  await expect(selected(selection([], []), false, s.siteB)).rejects.toMatchObject({ code: 'CMS04' })
  await expect(
    db.asUser(s.contributorA, c =>
      c.query('SELECT app.normalize_list_selection($1,$2,$3,false)', [
        s.siteA,
        'stories',
        JSON.stringify(selection([], [])),
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' })
  await expect(
    db.as('owner', c =>
      c.query('SELECT app.normalize_list_selection($1,$2,$3,false)', [
        s.siteA,
        'other_reader',
        JSON.stringify(selection([], [])),
      ]),
    ),
  ).rejects.toMatchObject({ code: 'CMS04', message: 'tag groups belong to Stories sections' })
  const before = await db.asUser(
    s.superAdmin,
    async c =>
      (await c.query('SELECT entry_revision,published_entry_revision FROM collections WHERE id=$1', [list])).rows[0],
  )
  await expect(
    db.asUser(s.editorB, c =>
      c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [list, before!.entry_revision]),
    ),
  ).rejects.toMatchObject({ code: 'CMS02' })
  expect(
    await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query('SELECT entry_revision,published_entry_revision FROM collections WHERE id=$1', [list])).rows[0],
    ),
  ).toEqual(before)
})

it('reapplying the additive migration preserves every existing collection/entry pointer and its permissions', async () => {
  const snapshot = () =>
    db.as(
      'owner',
      async c =>
        (
          await c.query(
            `SELECT jsonb_build_object('collection',(SELECT to_jsonb(c) FROM collections c WHERE id=$1),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM collection_entries e WHERE collection_id=$1)) AS data`,
            [list],
          )
        ).rows[0]!.data,
    )
  const before = await snapshot()
  await db.as('owner', c =>
    c.query(readFileSync(new URL('../migrations/0170_story_tag_selection.sql', import.meta.url), 'utf8')),
  )
  expect(await snapshot()).toEqual(before)
  expect(await selected(selection(['health'], ['asia']))).toEqual(['europe', 'multi-region'])
  await expect(
    db.asUser(s.contributorA, c =>
      c.query('SELECT app.normalize_list_selection($1,$2,$3,false)', [
        s.siteA,
        'stories',
        JSON.stringify(selection([], [])),
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' })
})
