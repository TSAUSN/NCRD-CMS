import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { createStoriesModel, emptyStoriesSettings } from '../src/content/index.ts'
let db: TestDatabase, s: Scenario, list: string
const item = [{ type: 'element', tag: 'article', children: [{ type: 'text', field: 'title' }] }]
beforeAll(async () => {
  db = await TestDatabase.create('story_feed_dates')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    const dates = (
      await c.query(
        `SELECT (current_timestamp AT TIME ZONE 'UTC')::date::text AS today,((current_timestamp AT TIME ZONE 'UTC')::date+1)::text AS future,((current_timestamp AT TIME ZONE 'UTC')::date-interval '13 months')::date::text AS boundary,(((current_timestamp AT TIME ZONE 'UTC')::date-interval '13 months')::date-1)::text AS expired`,
      )
    ).rows[0]!
    const model = createStoriesModel(emptyStoriesSettings()),
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
    const rows = ['today', 'future', 'boundary', 'expired'].map(key => ({
        id: null,
        stableKey: key,
        values: {
          title: key,
          summary: '[Description]',
          published_date: dates[key],
          tags: 'health',
          region: 'africa',
          story_url: '/stories/' + key,
        },
      })),
      head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [list])).rows[0]!,
      saved = (
        await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
          list,
          head.entry_revision,
          JSON.stringify(rows),
        ])
      ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [list, saved.entry_revision])
  })
})
afterAll(async () => db?.close())
const choose = (selection: unknown, zone = 'UTC') =>
  db.as('owner', async c => {
    await c.query("SELECT set_config('TimeZone',$1,true)", [zone])
    return (
      await c.query('SELECT app.normalize_list_selection($1,$2,$3,false) AS selected', [
        s.siteA,
        'stories',
        JSON.stringify(selection),
      ])
    ).rows[0]!.selected
  })
it('defaults every automatic Story feed to the UTC13-month window before applying its limit', async () => {
  for (const zone of ['UTC', 'Pacific/Kiritimati', 'Etc/GMT+12'])
    expect((await choose({ mode: 'automatic', limit: 200 }, zone)).stableKeys.sort()).toEqual(['boundary', 'today'])
  expect(
    (await choose({ mode: 'automatic', limit: 1, storyTags: { main: ['health'], secondary: ['africa'] } })).stableKeys,
  ).toEqual(['today'])
})
it('refuses a different Story age/date while manual article selections remain accessible', async () => {
  for (const selection of [
    { mode: 'automatic', limit: 6, maxAgeMonths: 24 },
    { mode: 'automatic', limit: 6, maxAgeMonths: '13' },
    { mode: 'automatic', limit: 6, dateField: 'another_date' },
  ])
    await expect(choose(selection)).rejects.toMatchObject({ code: 'CMS04' })
  const manual = { mode: 'manual', stableKeys: ['expired', 'future'] }
  expect(await choose(manual)).toEqual(manual)
  const resolved = await db.as(
    'owner',
    async c =>
      (
        await c.query('SELECT app.resolve_collection_repeat($1,$2,$3,$4) AS result', [
          s.siteA,
          'stories',
          JSON.stringify(manual),
          JSON.stringify(item),
        ])
      ).rows[0]!.result,
  )
  expect(resolved.entries.map((entry: { stableKey: string }) => entry.stableKey)).toEqual(['expired', 'future'])
})
