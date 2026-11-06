import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { createStoriesModel, emptyStoriesSettings, storyCatalog } from '../src/content/index.ts'
let db: TestDatabase, s: Scenario, list: string, other: string, original: Record<string, unknown>
const settings = {
  ...emptyStoriesSettings(),
  mainLabel: 'Programs',
  secondaryLabel: 'Areas',
  mainTags: [{ id: 'food', label: 'Food', keywords: ['private suggestion'] }],
  secondaryTags: [{ id: 'east', label: 'East', keywords: ['private region'], areas: ['asia' as const] }],
}
const item = [{ type: 'element', tag: 'article', children: [{ type: 'text', field: 'title' }] }]
const query = (sql: string, args: unknown[] = []) => db.as('owner', c => c.query(sql, args))
const resolve = (site?: string, reader = 'stories') =>
  query('SELECT app.resolve_collection_repeat($1,$2,$3,$4) AS value', [
    site ?? s.siteA,
    reader,
    JSON.stringify({ mode: 'automatic', limit: 6 }),
    JSON.stringify(item),
  ]).then(r => r.rows[0]!.value)
beforeAll(async () => {
  db = await TestDatabase.create('story_catalog')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    for (const [site, reader] of [
      [s.siteA, 'stories'],
      [s.siteB, 'stories'],
      [s.siteA, 'other_reader'],
    ]) {
      const model = createStoriesModel({
          ...settings,
          mainLabel: site === s.siteB ? 'Other programs' : settings.mainLabel,
        }),
        created = (
          await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
            site,
            reader!.replaceAll('_', '-'),
            'Stories',
            reader,
            JSON.stringify(model.fields),
            JSON.stringify(model.presentation),
          ])
        ).rows[0]!
      await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [created.collection_id, created.revision])
      if (site === s.siteA && reader === 'stories') list = created.collection_id
      if (reader === 'other_reader') other = created.collection_id
    }
  })
  original = await resolve()
})
afterAll(async () => db.close())
it('projects only this published catalog, preserves order and legacy envelopes and leaves other readers unchanged', async () => {
  expect(original.storyCatalog).toEqual(storyCatalog(settings))
  expect(JSON.stringify(original)).not.toContain('private suggestion')
  expect(JSON.stringify(original)).not.toContain('publishUnreviewed')
  expect((await resolve(s.siteB)).storyCatalog.mainLabel).toBe('Other programs')
  expect((await resolve(s.siteA, 'other_reader')).storyCatalog).toBeUndefined()
  expect(
    (await query('SELECT app.template_collection_binding_shape_valid($1) AS valid', [JSON.stringify(original)]))
      .rows[0]!.valid,
  ).toBe(true)
  const legacy = { ...original }
  delete legacy.storyCatalog
  expect(
    (await query('SELECT app.template_collection_binding_shape_valid($1) AS valid', [JSON.stringify(legacy)])).rows[0]!
      .valid,
  ).toBe(true)
})
it('keeps draft names private, returns authoritative draft metadata for canvas tickets and pins old snapshots after publication', async () => {
  const changed = {
    ...settings,
    mainLabel: 'Projects',
    secondaryTags: [{ ...settings.secondaryTags[0]!, label: 'Eastern area', areas: ['africa'] }],
  }
  await db.asUser(s.superAdmin, async c => {
    const head = (
      await c.query(
        'SELECT c.revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
        [list],
      )
    ).rows[0]!
    await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
      list,
      head.revision,
      JSON.stringify(head.fields),
      JSON.stringify({ ...head.sort, stories: changed }),
    ])
  })
  expect((await resolve()).storyCatalog).toEqual(storyCatalog(settings))
  const draft = (
    await query('SELECT app.canvas_draft_list($1,$2,$3) AS value', [
      s.siteA,
      JSON.stringify({ readerKey: 'stories' }),
      JSON.stringify({ ...original, storyCatalog: { forged: true } }),
    ])
  ).rows[0]!.value
  expect(draft.storyCatalog).toEqual(storyCatalog(changed as typeof settings))
  await db.asUser(s.superAdmin, async c => {
    const head = (await c.query('SELECT revision FROM collections WHERE id=$1', [list])).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [list, head.revision])
  })
  expect((await resolve()).storyCatalog).toEqual(storyCatalog(changed as typeof settings))
  expect(
    (await query('SELECT app.with_story_catalog($1,false) AS value', [JSON.stringify(original)])).rows[0]!.value,
  ).toEqual(original)
})
it('rejects unknown/private catalog shape and retains private helper permissions', async () => {
  for (const storyCatalog of [
    { ...(original.storyCatalog as object), source: 'sawso' },
    { ...(original.storyCatalog as object), mainTags: [settings.mainTags[0]] },
    { ...(original.storyCatalog as object), secondaryTags: [{ id: 'east', label: 'East', areas: ['country'] }] },
  ])
    expect(
      (
        await query('SELECT app.template_collection_binding_shape_valid($1) AS valid', [
          JSON.stringify({ ...original, storyCatalog }),
        ])
      ).rows[0]!.valid,
    ).toBe(false)
  expect(
    (
      await query('SELECT app.template_collection_binding_shape_valid($1) AS valid', [
        JSON.stringify({ ...original, readerKey: 'other_reader' }),
      ])
    ).rows[0]!.valid,
  ).toBe(false)
  for (const actor of [s.superAdmin, s.editorA, s.editorB])
    await expectSqlState(
      db.asUser(actor, c => c.query('SELECT app.with_story_catalog($1,true)', [JSON.stringify(original)])),
      '42501',
    )
  const rows = (await db.asUser(s.editorB, c => c.query('SELECT id FROM collections WHERE id=$1', [list]))).rows
  expect(rows).toHaveLength(0)
  expect(other).toBeTruthy()
})
it('pins the six-story sector display rule only for the approved SAWSO source without exposing its connection', async () => {
  await db.asUser(s.superAdmin, async c => {
    const head = (
        await c.query(
          'SELECT c.revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
          [list],
        )
      ).rows[0]!,
      next = { ...head.sort, stories: { ...head.sort.stories, source: 'sawso' } }
    const saved = (
      await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
        list,
        head.revision,
        JSON.stringify(head.fields),
        JSON.stringify(next),
      ])
    ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [list, saved.revision])
  })
  const bound = await resolve()
  expect(bound.storyCatalog.sectorPageLimit).toBe(6)
  expect(bound.storyCatalog.source).toBeUndefined()
  expect(
    (await query('SELECT app.template_collection_binding_shape_valid($1) AS valid', [JSON.stringify(bound)])).rows[0]!
      .valid,
  ).toBe(true)
  for (const limit of [7, '6', null])
    expect(
      (
        await query('SELECT app.template_collection_binding_shape_valid($1) AS valid', [
          JSON.stringify({ ...bound, storyCatalog: { ...bound.storyCatalog, sectorPageLimit: limit } }),
        ])
      ).rows[0]!.valid,
    ).toBe(false)
  expect(
    (await query('SELECT app.with_story_catalog($1,false) AS value', [JSON.stringify(original)])).rows[0]!.value
      .storyCatalog.sectorPageLimit,
  ).toBeUndefined()
})
