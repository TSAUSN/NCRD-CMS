import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { corePageDefinitions } from '../src/lib/core-pages.ts'
import { sawsoSection } from '../src/lib/sawso-pages.ts'
import { readStoryPlacement } from '../src/lib/story-placement-repository.ts'
import { storyPlacement } from '../src/lib/story-placement.ts'
let db: TestDatabase,
  s: Scenario,
  collection: string,
  first: string,
  second: string,
  privateEntry: string,
  live: string,
  privatePage: string,
  article: string
const settings = {
  ...emptyStoriesSettings(),
  mainLabel: 'Programs',
  secondaryLabel: 'Areas',
  mainTags: [
    { id: 'food', label: 'Food', keywords: [] },
    { id: 'homes', label: 'Homes', keywords: [] },
  ],
  secondaryTags: [{ id: 'east', label: 'East', keywords: [], areas: ['asia' as const] }],
}
beforeAll(async () => {
  db = await TestDatabase.create('story_placement')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await installCoreLibrary(c)
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
    const day = new Date().toISOString().slice(0, 10),
      old = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      saved = (
        await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
          collection,
          JSON.stringify(
            ['first', 'second', 'private'].map((key, i) => ({
              id: null,
              stableKey: key,
              values: {
                title: '[' + key + ' story]',
                summary: '[Description]',
                body: '<p>[Private body not needed for placement]</p>',
                published_date: i === 0 ? old : day,
                tags: 'food',
                regions: 'east',
                reviewed: true,
                story_url: '/stories/' + key,
              },
            })),
          ),
        ])
      ).rows[0]!
    const rows = (await c.query('SELECT id,stable_key FROM collection_entries WHERE collection_id=$1', [collection]))
      .rows
    first = rows.find(row => row.stable_key === 'first')!.id
    second = rows.find(row => row.stable_key === 'second')!.id
    privateEntry = rows.find(row => row.stable_key === 'private')!.id
    await c.query('SELECT * FROM app.publish_story_entries($1,$2,$3)', [
      collection,
      saved.entry_revision,
      [first, second],
    ])
    const defs = await corePageDefinitions(c),
      feed = (tag: string) =>
        sawsoSection(defs, 'stories', 'Stories', {
          heading: '[Programs feed]',
          stories: {
            readerKey: 'stories',
            selection: {
              mode: 'automatic',
              filter: { field: 'tags', value: tag },
              dateField: 'published_date',
              maxAgeMonths: 13,
              limit: 1,
            },
          },
        })
    async function page(slug: string, sections: unknown, publish = false) {
      const id = (await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, '[' + slug + ']'])).rows[0]!
          .id,
        saved = (await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, JSON.stringify(sections), '{}']))
          .rows[0]!
      if (publish)
        await c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [id, saved.revision, ...CHECKED_CLEAN])
      return id
    }
    live = await page('live-feed', [feed('food')], true)
    privatePage = await page('private-feed', [feed('food')])
    article = await page(
      'stories/first',
      [
        sawsoSection(defs, 'story-detail', 'Story', {
          story: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: ['first'] } },
        }),
      ],
      true,
    )
    // Unrelated record/page drafts must not change this story's placement.
    const entries = (
      await c.query(
        'SELECT e.id,e.stable_key,v.values,c.entry_revision FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN collections c ON c.id=e.collection_id WHERE c.id=$1 ORDER BY e.sort_index,e.created_at,e.id',
        [collection],
      )
    ).rows
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collection,
      entries[0]!.entry_revision,
      JSON.stringify(
        entries.map(row => ({
          id: row.id,
          stableKey: row.stable_key,
          values:
            row.id === second ? { ...row.values, tags: 'homes', body: '<p>[Other private edit]</p>' } : row.values,
        })),
      ),
    ])
    const revision = (await c.query('SELECT revision FROM pages WHERE id=$1', [live])).rows[0]!.revision
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      live,
      revision,
      JSON.stringify([feed('homes')]),
      '{}',
    ])
  })
  await db.as('owner', c => c.query("UPDATE pages SET slug='unpublished-address' WHERE id=$1", [live]))
})
afterAll(async () => db?.close())
it('uses published other records and pages, includes the selected article and sends only placement fields', async () => {
  const context = await db.asUser(s.editorA, c => readStoryPlacement(c, s.siteA, collection, first))
  expect(context.privateSite).toBe(false)
  expect(context.hasArticle).toBe(true)
  expect(context.pages.map(page => page.id)).toContain(live)
  expect(context.pages.map(page => page.id)).not.toContain(privatePage)
  expect(context.pages.map(page => page.id)).not.toContain(article)
  expect(context.rows.map(row => row.id).sort()).toEqual([first, second].sort())
  expect(context.rows.some(row => row.id === privateEntry)).toBe(false)
  expect(context.rows.find(row => row.id === second)!.values.tags).toBe('food')
  expect(JSON.stringify(context)).not.toContain('Other private edit')
  expect(JSON.stringify(context.rows)).not.toContain('Private body not needed')
  expect(context.pages.find(page => page.id === live)!.path).toBe('/live-feed')
  const feed = context.pages.find(page => page.id === live)!.feeds[0]!
  expect(feed.selection).toMatchObject({ filter: { field: 'tags', value: 'food' } })
  const values = context.rows.find(row => row.id === first)!.values
  expect(storyPlacement(context, values, settings).places).toEqual([])
  await db.asUser(s.superAdmin, async c => {
    const revision = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [collection])).rows[0]!
      .entry_revision
    await c.query('SELECT * FROM app.publish_story_entries($1,$2,$3)', [collection, revision, [second]])
  })
  const refreshed = await db.asUser(s.editorA, c => readStoryPlacement(c, s.siteA, collection, first))
  expect(storyPlacement(refreshed, values, settings).places.map(page => page.id)).toEqual([live])
  expect(refreshed.pages.find(page => page.id === live)!.feeds[0]!.selection).toMatchObject({
    filter: { value: 'food' },
  })
})
it('keeps the entire projection behind site and collection ownership', async () => {
  await expect(db.asUser(s.editorB, c => readStoryPlacement(c, s.siteA, collection, first))).rejects.toMatchObject({
    kind: 'not_found',
  })
  await expect(db.asUser(s.superAdmin, c => readStoryPlacement(c, s.siteB, collection, first))).rejects.toMatchObject({
    kind: 'not_found',
  })
})

it('projects a new unsaved story without inserting a placeholder or exposing private context', async () => {
  const id = '23456789-2345-4234-8234-234567890123',
    candidate = { id, stableKey: 'new-' + id, createdAt: new Date().toISOString() }
  const before = await db.asUser(
    s.editorA,
    async c =>
      (await c.query('SELECT count(*)::int AS count FROM collection_entries WHERE collection_id=$1', [collection]))
        .rows[0]!.count,
  )
  const context = await db.asUser(s.editorA, c => readStoryPlacement(c, s.siteA, collection, candidate))
  expect(context.candidate).toMatchObject({ id, stableKey: candidate.stableKey })
  expect(context.hasArticle).toBe(false)
  expect(context.rows.some(row => row.id === id)).toBe(false)
  expect(context.pages.map(page => page.id)).toContain(live)
  expect(context.pages.map(page => page.id)).not.toContain(privatePage)
  expect(context.rows.some(row => row.id === privateEntry)).toBe(false)
  expect(JSON.stringify(context)).not.toContain('Other private edit')
  const after = await db.asUser(
    s.editorA,
    async c =>
      (await c.query('SELECT count(*)::int AS count FROM collection_entries WHERE collection_id=$1', [collection]))
        .rows[0]!.count,
  )
  expect(after).toBe(before)
  await expect(db.asUser(s.editorB, c => readStoryPlacement(c, s.siteA, collection, candidate))).rejects.toMatchObject({
    kind: 'not_found',
  })
})
