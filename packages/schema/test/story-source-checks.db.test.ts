import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
import { createStoriesModel, emptyStoriesSettings } from '../src/index.ts'
const counts = { added: 0, updated: 0, removed: 0, total: 1, preserved: 0 }
const baseline = {
  sourceId: '1',
  stableKey: 'story-one',
  fields: {
    title: 'Source title',
    summary: 'Source summary',
    published_date: '2026-10-30',
    old_address: 'https://sawso.org/sawso/story/one',
    image_url: '',
  },
}
describe('manual Stories checks keep source state private and retries idempotent', () => {
  let db: TestDatabase, s: Scenario, collection: string
  const query = (actor: string, sql: string, args: unknown[] = []) => db.asUser(actor, c => c.query(sql, args))
  const begin = (id: string, actor?: string) =>
    query(actor ?? s.superAdmin, 'SELECT app.begin_story_source_check($1,$2,$3) AS value', [
      s.siteA,
      collection,
      id,
    ]).then(r => r.rows[0]!.value)
  const finish = (id: string, result: unknown = counts, baselines: unknown = [baseline], actor?: string) =>
    query(actor ?? s.superAdmin, 'SELECT app.finish_story_source_check($1,$2,$3,$4) AS value', [
      collection,
      id,
      JSON.stringify(result),
      JSON.stringify(baselines),
    ]).then(r => r.rows[0]!.value)
  beforeAll(async () => {
    db = await TestDatabase.create('story_source')
    s = await seedScenario(db)
    await query(s.superAdmin, "SELECT app.set_site_membership($1,$2,'site_admin')", [s.contributorA, s.siteA])
    const model = createStoriesModel({ ...emptyStoriesSettings(), source: 'sawso' })
    collection = (
      await query(s.superAdmin, 'SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        'stories',
        'Stories',
        'stories',
        JSON.stringify(model.fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!.collection_id
    await query(s.superAdmin, 'SELECT * FROM app.save_collection_entries($1,0,$2)', [
      collection,
      JSON.stringify([
        {
          id: null,
          stableKey: 'story-one',
          values: {
            title: 'CMS title',
            summary: 'CMS summary',
            published_date: '2026-10-30',
            story_url: '/stories/one',
          },
        },
      ]),
    ])
  })
  afterAll(async () => db.close())
  it('authorizes the source before starting; gives one lease and never restarts a request', async () => {
    const id = randomUUID()
    for (const actor of [s.editorA, s.editorB, s.disabled]) await expectSqlState(begin(id, actor), 'CMS02')
    expect((await begin(id)).started).toBe(true)
    expect((await begin(id)).started).toBe(false)
    const busy = await begin(randomUUID(), s.contributorA)
    expect(busy.started).toBe(false)
    expect(busy.check.id).toBe(id)
    await finish(id)
    const replay = await begin(id)
    expect(replay.started).toBe(false)
    expect(replay.check.status).toBe('ok')
    expect((await finish(id, { error: 'network' }, [])).status).toBe('ok')
  })
  it('allows owned Site admins, hides baselines from Editors and other sites, and grants no direct writes or public access', async () => {
    const id = randomUUID()
    expect((await begin(id, s.contributorA)).started).toBe(true)
    await finish(id, counts, [baseline], s.contributorA)
    expect(
      (await query(s.editorA, 'SELECT id FROM story_source_checks WHERE collection_id=$1', [collection])).rows.length,
    ).toBeGreaterThan(0)
    expect((await query(s.editorA, 'SELECT * FROM story_source_baselines')).rows).toHaveLength(0)
    expect((await query(s.editorB, 'SELECT * FROM story_source_checks')).rows).toHaveLength(0)
    await expectSqlState(query(s.superAdmin, "UPDATE story_source_checks SET status='ok'"), '42501')
    for (const role of ['public', 'worker'] as const)
      await expectSqlState(
        db.as(role, c => c.query('SELECT * FROM public.story_source_checks')),
        '42501',
      )
  })
  it('rejects malformed results, foreign entries and changed source identities without finishing or changing content', async () => {
    const id = randomUUID()
    await begin(id)
    for (const result of [
      { ...counts, added: -1 },
      { ...counts, extra: 1 },
      { ...counts, total: '1' },
      { error: 'raw remote body' },
    ])
      await expectSqlState(finish(id, result, []), 'CMS04')
    for (const records of [
      [{ ...baseline, stableKey: 'not-here' }],
      [{ ...baseline, sourceId: '2' }],
      [{ ...baseline, fields: { ...baseline.fields, body: 'not allowed' } }],
      [baseline, baseline],
    ])
      await expectSqlState(finish(id, counts, records), 'CMS04')
    expect((await begin(id)).check.status).toBe('checking')
    expect((await finish(id, { error: 'format' }, [])).status).toBe('error')
    expect(
      (
        await query(
          s.superAdmin,
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
          [collection],
        )
      ).rows[0]!.values.title,
    ).toBe('CMS title')
  })
  it('rolls a baseline update and result back with the surrounding draft transaction', async () => {
    const id = randomUUID()
    await begin(id)
    await expect(
      db.asUser(s.superAdmin, async c => {
        await c.query('SELECT app.finish_story_source_check($1,$2,$3,$4)', [
          collection,
          id,
          JSON.stringify(counts),
          JSON.stringify([{ ...baseline, fields: { ...baseline.fields, title: 'Changed source' } }]),
        ])
        throw new Error('save failed')
      }),
    ).rejects.toThrow('save failed')
    expect(
      (await query(s.superAdmin, 'SELECT fields FROM story_source_baselines WHERE collection_id=$1', [collection]))
        .rows[0]!.fields.title,
    ).toBe('Source title')
    expect((await begin(id)).check.status).toBe('checking')
    await finish(id, { error: 'save' }, [])
  })
  it('expires abandoned checks once, denies a late finish and never fetches again on an expired request', async () => {
    const id = randomUUID()
    await begin(id)
    await db.as('owner', c =>
      c.query("UPDATE story_source_checks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id]),
    )
    await expectSqlState(finish(id), 'CMS01')
    const expired = await begin(id)
    expect(expired.started).toBe(false)
    expect(expired.check.status).toBe('error')
    expect(expired.check.result.error).toBe('timeout')
    const next = randomUUID()
    expect((await begin(next)).started).toBe(true)
    await finish(next)
  })
  it('rechecks access and source at completion, without publishing collection heads', async () => {
    const before = (
      await query(
        s.superAdmin,
        'SELECT draft_schema_version_id,published_schema_version_id,entry_revision FROM collections WHERE id=$1',
        [collection],
      )
    ).rows[0]
    const id = randomUUID()
    await begin(id, s.contributorA)
    await query(s.superAdmin, "SELECT app.set_site_membership($1,$2,'editor')", [s.contributorA, s.siteA])
    await expectSqlState(finish(id, counts, [baseline], s.contributorA), 'CMS02')
    await query(s.superAdmin, "SELECT app.set_site_membership($1,$2,'site_admin')", [s.contributorA, s.siteA])
    await finish(id, counts, [baseline], s.contributorA)
    expect(
      (
        await query(
          s.superAdmin,
          'SELECT draft_schema_version_id,published_schema_version_id,entry_revision FROM collections WHERE id=$1',
          [collection],
        )
      ).rows[0],
    ).toEqual(before)
  })
  it('serializes two simultaneous clicks using the collection lock', async () => {
    const results = await Promise.all([begin(randomUUID()), begin(randomUUID())])
    expect(results.filter(result => result.started)).toHaveLength(1)
    expect(results[0].check.id).toBe(results[1].check.id)
    await finish(results[0].check.id)
  })
  it('cannot use an unconnected library as a source-read destination', async () => {
    const model = createStoriesModel(emptyStoriesSettings())
    const other = (
      await query(s.superAdmin, 'SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteB,
        'stories',
        'Stories',
        'stories',
        JSON.stringify(model.fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!.collection_id
    await expectSqlState(
      query(s.superAdmin, 'SELECT app.begin_story_source_check($1,$2,$3)', [s.siteB, other, randomUUID()]),
      'CMS04',
    )
    expect(
      (await query(s.superAdmin, 'SELECT id FROM story_source_checks WHERE collection_id=$1', [other])).rows,
    ).toHaveLength(0)
  })
})
