import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { expectSqlState, TestDatabase } from './harness.ts'
import { emptyStoriesSettings } from '../src/content/stories.ts'
const fields = [{ key: 'title', label: 'Title', required: true, type: 'text' }]
const settings = {
  ...emptyStoriesSettings(),
  mainTags: [{ id: 'education', label: 'Education', keywords: ['school'] }],
  secondaryTags: [{ id: 'africa', label: 'Africa', keywords: ['congo'], areas: ['africa'] }],
}
const presentation = {
  schemaVersion: 1,
  titleField: 'title',
  subtitleField: null,
  imageField: null,
  groupField: null,
  stories: settings,
}
describe('Stories catalogs use existing immutable collection permissions', () => {
  let db: TestDatabase,
    s: Scenario,
    counter = 0
  beforeAll(async () => {
    db = await TestDatabase.create('stories_settings')
    s = await seedScenario(db)
  })
  afterAll(async () => db.close())
  const query = (user: string, sql: string, args: unknown[] = []) => db.asUser(user, c => c.query(sql, args))
  async function create(p: unknown = presentation) {
    const key = `stories-${++counter}`
    return (
      await query(s.superAdmin, 'SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        key,
        'Stories',
        key.replace('-', '_'),
        JSON.stringify(fields),
        JSON.stringify(p),
      ])
    ).rows[0]!
  }
  it('keeps a renamed draft private until ordinary publication and preserves IDs/history', async () => {
    const c = await create()
    await query(s.superAdmin, 'SELECT * FROM app.publish_collection_schema($1,1)', [c.collection_id])
    const next = {
      ...presentation,
      stories: { ...settings, mainLabel: 'Sectors', mainTags: [{ ...settings.mainTags[0], label: 'Learning' }] },
    }
    const saved = (
      await query(s.superAdmin, 'SELECT * FROM app.save_collection_schema($1,2,$2,$3)', [
        c.collection_id,
        JSON.stringify(fields),
        JSON.stringify(next),
      ])
    ).rows[0]!
    const state = (
      await query(
        s.editorA,
        `SELECT d.sort AS draft,p.sort AS published FROM collections c JOIN collection_schema_versions d ON d.id=c.draft_schema_version_id JOIN collection_schema_versions p ON p.id=c.published_schema_version_id WHERE c.id=$1`,
        [c.collection_id],
      )
    ).rows[0]!
    expect(state.draft.stories.mainTags).toEqual([{ id: 'education', label: 'Learning', keywords: ['school'] }])
    expect(state.published.stories.mainTags[0].label).toBe('Education')
    await expectSqlState(
      query(s.superAdmin, 'SELECT * FROM app.save_collection_schema($1,2,$2,$3)', [
        c.collection_id,
        JSON.stringify(fields),
        JSON.stringify(next),
      ]),
      'CMS01',
    )
    await query(s.superAdmin, 'SELECT * FROM app.publish_collection_schema($1,$2)', [c.collection_id, saved.revision])
    const live = (
      await query(
        s.editorA,
        'SELECT v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.published_schema_version_id WHERE c.id=$1',
        [c.collection_id],
      )
    ).rows[0]!.sort
    expect(live.stories.mainLabel).toBe('Sectors')
    expect(
      (await query(s.editorA, 'SELECT sort FROM collection_schema_versions WHERE id=$1', [c.schema_version_id]))
        .rows[0]!.sort,
    ).toEqual(presentation)
  })
  it('refuses content editors, contributors and another site, without changing the head', async () => {
    const c = await create()
    for (const actor of [s.editorA, s.contributorA, s.editorB])
      await expectSqlState(
        query(actor, 'SELECT * FROM app.save_collection_schema($1,1,$2,$3)', [
          c.collection_id,
          JSON.stringify(fields),
          JSON.stringify(presentation),
        ]),
        'CMS02',
      )
    expect(
      (await query(s.superAdmin, 'SELECT revision FROM collections WHERE id=$1', [c.collection_id])).rows[0]!.revision,
    ).toBe('1')
    expect((await query(s.editorB, 'SELECT id FROM collections WHERE id=$1', [c.collection_id])).rows).toHaveLength(0)
  })
  it('enforces the closed catalog even when a caller bypasses the TypeScript form', async () => {
    const bad = [
      null,
      [],
      { ...settings, source: 'https://another-feed.test' },
      { ...settings, publishUnreviewed: 'yes' },
      { ...settings, unknown: true },
      { ...settings, mainTags: [settings.mainTags[0], settings.mainTags[0]] },
      { ...settings, mainTags: [{ ...settings.mainTags[0], id: 'changed ID' }] },
      { ...settings, mainTags: [{ ...settings.mainTags[0], keywords: ['water', ' WATER '] }] },
      { ...settings, secondaryTags: [{ ...settings.secondaryTags[0], areas: ['a-country'] }] },
      { ...settings, secondaryTags: [{ ...settings.secondaryTags[0], areas: ['africa', 'africa'] }] },
    ]
    for (const stories of bad) await expectSqlState(create({ ...presentation, stories }), 'CMS04')
    expect(
      (await create({ ...presentation, stories: { ...settings, mainTags: [], secondaryTags: [] } })).collection_id,
    ).toBeTruthy()
    const { stories: _, ...ordinary } = presentation
    expect((await create(ordinary)).collection_id).toBeTruthy()
    await expectSqlState(create({ ...ordinary, unknown: true }), 'CMS04')
  })
})
