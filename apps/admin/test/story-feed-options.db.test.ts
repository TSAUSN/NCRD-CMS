import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { readCollectionBindingOptions } from '../src/lib/collection-binding-options.ts'
let db: TestDatabase, s: Scenario, definition: string, version: number, collection: string
const settings = {
  ...emptyStoriesSettings(),
  mainLabel: 'Programs',
  secondaryLabel: 'Areas',
  mainTags: [{ id: 'food', label: 'Food', keywords: ['private-keyword'] }],
  secondaryTags: [{ id: 'east', label: 'East', keywords: [], areas: [] }],
}
beforeAll(async () => {
  db = await TestDatabase.create('story_feed_options')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await installCoreLibrary(c)
    const d = (
      await c.query(
        "SELECT d.id,max(v.version)::int AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-stories' AND d.scope='global' GROUP BY d.id",
      )
    ).rows[0]!
    definition = d.id
    version = d.version
    const model = createStoriesModel(settings)
    collection = (
      await c.query("SELECT * FROM app.create_collection($1,'stories','Stories','stories',$2,$3)", [
        s.siteA,
        JSON.stringify(model.fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!.collection_id
  })
})
afterAll(async () => {
  await db?.close()
})
it('loads the current site draft labels before publication without exposing keywords or private article bodies', async () => {
  const options = await db.asUser(s.editorA, c =>
      readCollectionBindingOptions(c, s.siteA, definition, version, 'stories'),
    ),
    story = options?.find(o => o.readerKey === 'stories')
  expect(story?.storyTags).toEqual({
    mainLabel: 'Programs',
    secondaryLabel: 'Areas',
    source: 'none',
    mainTags: [{ id: 'food', label: 'Food' }],
    secondaryTags: [{ id: 'east', label: 'East' }],
  })
  expect(JSON.stringify(story)).not.toContain('private-keyword')
  expect(story?.entries).toEqual([])
  expect(story?.compatible).toBe(false)
  await db.asUser(s.superAdmin, async c => {
    const head = (
        await c.query(
          'SELECT c.revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
          [collection],
        )
      ).rows[0]!,
      next = {
        ...head.sort,
        stories: {
          ...head.sort.stories,
          mainLabel: 'Projects',
          mainTags: [{ ...settings.mainTags[0], label: 'Food support' }],
        },
      }
    await c.query('SELECT app.save_collection_schema($1,$2,$3,$4)', [
      collection,
      head.revision,
      JSON.stringify(head.fields),
      JSON.stringify(next),
    ])
  })
  const changed = await db.asUser(s.editorA, c =>
    readCollectionBindingOptions(c, s.siteA, definition, version, 'stories'),
  )
  expect(changed?.find(o => o.readerKey === 'stories')?.storyTags).toMatchObject({
    mainLabel: 'Projects',
    mainTags: [{ id: 'food', label: 'Food support' }],
  })
  expect(
    await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query('SELECT published_schema_version_id FROM collections WHERE id=$1', [collection])).rows[0]!
          .published_schema_version_id,
    ),
  ).toBeNull()
})
it('keeps foreign-site, invalid-definition and nonrepeat choices hidden', async () => {
  expect(
    await db.asUser(s.editorB, c => readCollectionBindingOptions(c, s.siteA, definition, version, 'stories')),
  ).toBeNull()
  expect(
    await db.asUser(s.editorA, c => readCollectionBindingOptions(c, s.siteA, definition, version, 'heading')),
  ).toBeNull()
  expect(
    await db.asUser(s.editorA, c => readCollectionBindingOptions(c, s.siteA, definition, 999, 'stories')),
  ).toBeNull()
})
