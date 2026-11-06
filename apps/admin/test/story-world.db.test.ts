import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { renderSection, type RenderManifest } from '@cms/renderer'
import { corePageDefinitions } from '../src/lib/core-pages.ts'
import { sawsoSection } from '../src/lib/sawso-pages.ts'
import { withDraftListPreview } from '../src/lib/draft-list-preview.ts'
import { readCollectionBindingOptions } from '../src/lib/collection-binding-options.ts'
let db: TestDatabase,
  s: Scenario,
  page: string,
  version: string,
  collection: string,
  definition: string,
  definitionVersion: number
const settings = {
  ...emptyStoriesSettings(),
  mainLabel: 'Programs',
  secondaryLabel: 'Areas',
  mainTags: [{ id: 'food', label: 'Food', keywords: ['private keyword'] }],
  secondaryTags: [
    { id: 'east', label: 'Eastern area', keywords: [], areas: ['asia' as const] },
    { id: 'south', label: 'Southern area', keywords: [], areas: ['africa' as const] },
  ],
}
beforeAll(async () => {
  db = await TestDatabase.create('story_world')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    const installed = await installCoreLibrary(c),
      world = installed.definitions.get('core-story-world')!
    definition = world.id
    definitionVersion = world.version
    const model = createStoriesModel(settings),
      created = (
        await c.query("SELECT * FROM app.create_collection($1,'stories','Stories','stories',$2,$3)", [
          s.siteA,
          JSON.stringify(model.fields),
          JSON.stringify(model.presentation),
        ])
      ).rows[0]!
    collection = created.collection_id
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [collection, created.revision])
    const saved = (
      await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
        collection,
        JSON.stringify(
          ['east', 'south'].map((area, i) => ({
            id: null,
            stableKey: 'story-' + i,
            values: {
              title: '[Story ' + i + ']',
              summary: '[Description]',
              published_date: new Date().toISOString().slice(0, 10),
              tags: 'food',
              regions: area,
              reviewed: true,
              story_url: '/stories/story-' + i,
            },
          })),
        ),
      ])
    ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [collection, saved.entry_revision])
    page = (await c.query("SELECT app.create_page($1,'world','[World page]') AS id", [s.siteA])).rows[0]!.id
    const section = sawsoSection(await corePageDefinitions(c), 'story-world', 'World View', {
      heading: 'Where We Work',
      start_region: 'east',
      per_region: '3',
      stories: {
        readerKey: 'stories',
        selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', maxAgeMonths: 13, limit: 200 },
      },
    })
    version = (await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [page, JSON.stringify([section]), '{}']))
      .rows[0]!.version_id
  })
})
afterAll(async () => db.close())
async function manifest() {
  return db.asUser(
    s.editorA,
    async c =>
      (
        await c.query(
          'SELECT app.build_initial_preview_manifest(id) AS manifest FROM page_versions WHERE id=$1 AND site_id=$2',
          [version, s.siteA],
        )
      ).rows[0]!.manifest as RenderManifest,
  )
}
it('installs World View idempotently and saves/renders a normal private page with this site’s pinned Story binding', async () => {
  const before = await db.asUser(s.superAdmin, c =>
      c.query('SELECT revision,published_version_id FROM pages WHERE id=$1', [page]),
    ),
    installed = await db.asUser(s.superAdmin, c => installCoreLibrary(c))
  expect(installed.created).toBe(0)
  expect(installed.updated).toBe(0)
  const data = await manifest(),
    html = renderSection(data.sections[0]!, 0, { nationalPanels: true, storyWidgets: { path: '/world' } })
  expect(html).toContain('Eastern area: 1 story')
  expect(html).toContain('Our Stories from Eastern area')
  expect(html.match(/class="core-story-card"/g)).toHaveLength(1)
  expect(html).toContain('story0_region=south#s0')
  expect(html).not.toContain('private keyword')
  expect(html).not.toContain('national-content-panel')
  expect(before.rows[0]!.published_version_id).toBeNull()
})
it('uses saved draft region labels only for explicit draft previews and preserves the published catalog/page head', async () => {
  await db.asUser(s.superAdmin, async c => {
    const head = (
      await c.query(
        'SELECT c.revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
        [collection],
      )
    ).rows[0]!
    await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
      collection,
      head.revision,
      JSON.stringify(head.fields),
      JSON.stringify({
        ...head.sort,
        stories: {
          ...settings,
          secondaryTags: [{ ...settings.secondaryTags[0]!, label: 'Draft area' }, settings.secondaryTags[1]],
        },
      }),
    ])
  })
  const published = await manifest(),
    draft = await db.asUser(s.editorA, c => withDraftListPreview(c, structuredClone(published), version, s.siteA))
  expect(renderSection(published.sections[0]!, 0)).toContain('Eastern area: 1 story')
  expect(renderSection(draft.sections[0]!, 0)).toContain('Draft area: 1 story')
  expect(
    (await db.asUser(s.superAdmin, c => c.query('SELECT revision,published_version_id FROM pages WHERE id=$1', [page])))
      .rows[0],
  ).toEqual({ revision: '1', published_version_id: null })
})
it('loads only owned Story picker choices and keeps a foreign actor outside the page/library data', async () => {
  const options = await db.asUser(s.editorA, c =>
    readCollectionBindingOptions(c, s.siteA, definition, definitionVersion, 'stories'),
  )
  expect(options?.[0]?.storyTags).toMatchObject({
    mainLabel: 'Programs',
    secondaryLabel: 'Areas',
    secondaryTags: [
      { id: 'east', label: 'Draft area' },
      { id: 'south', label: 'Southern area' },
    ],
  })
  expect(JSON.stringify(options)).not.toContain('private keyword')
  expect(
    await db.asUser(s.editorB, c => readCollectionBindingOptions(c, s.siteA, definition, definitionVersion, 'stories')),
  ).toBeNull()
  expect(
    (await db.asUser(s.editorB, c => c.query('SELECT id FROM page_versions WHERE id=$1', [version]))).rows,
  ).toHaveLength(0)
})
