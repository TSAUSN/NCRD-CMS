import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createStoriesModel, emptyStoriesSettings, StructuredRepeatBinding } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { corePageDefinitions } from '../src/lib/core-pages.ts'
import { sawsoSection } from '../src/lib/sawso-pages.ts'
import { withDraftListPreview } from '../src/lib/draft-list-preview.ts'
import { renderPage, type RenderManifest } from '@cms/renderer'
let db: TestDatabase, s: Scenario, list: string, world: string, split: string, feed: string, worldVersion: string
const settings = {
    ...emptyStoriesSettings(),
    mainTags: [{ id: 'food', label: 'Food', keywords: [] }],
    secondaryTags: [{ id: 'east', label: 'East', keywords: [], areas: ['asia' as const] }],
  },
  host = 'site-a.staging.example.test'
beforeAll(async () => {
  db = await TestDatabase.create('full_story_source')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await installCoreLibrary(c)
    const model = createStoriesModel(settings)
    model.fields.push(
      { key: 'credit', label: 'Credit', type: 'text', required: true },
      { key: 'editor_note', label: 'Editor note', type: 'text', required: false },
    )
    const made = (
      await c.query("SELECT * FROM app.create_collection($1,'stories','Stories','stories',$2,$3)", [
        s.siteA,
        JSON.stringify(model.fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!
    list = made.collection_id
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [list, made.revision])
    const day = new Date().toISOString().slice(0, 10),
      keys = [
        ...Array.from({ length: 201 }, (_, i) => 'story-' + String(i).padStart(4, '0')),
        'expired',
        'future',
        'hidden',
        'removed',
      ],
      rows = keys.map(key => ({
        id: null,
        stableKey: key,
        values: {
          title: '[' + key + ']',
          summary: '[Description]',
          credit: '[Required credit]',
          editor_note: '[Unused optional note]',
          published_date: key === 'expired' ? '1999-01-01' : key === 'future' ? '2099-01-01' : day,
          tags: 'food',
          regions: 'east',
          story_url: '/stories/' + key,
          body: '<p>[Full article words] ' + 'Words '.repeat(150) + '</p>',
          photo: { src: '/cms-samples/r8-landscape.png', alt: '[Story photo]', decorative: false },
          hidden: key === 'hidden',
          feed_removed: key === 'removed',
        },
      })),
      saved = (await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [list, JSON.stringify(rows)]))
        .rows[0]!
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [list, saved.entry_revision])
    const defs = await corePageDefinitions(c),
      binding = {
        readerKey: 'stories',
        selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', maxAgeMonths: 13, limit: 200 },
      }
    for (const kind of ['story-world', 'story-split', 'stories']) {
      const id = (await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, kind, '[' + kind + ']'])).rows[0]!
          .id,
        head = (
          await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
            id,
            JSON.stringify([
              sawsoSection(defs, kind, 'Stories', {
                heading: '[Stories]',
                stories: binding,
                start_region: 'east',
                per_region: '200',
                start_view: 'recent',
                page_size: '6',
              }),
            ]),
            '{}',
          ])
        ).rows[0]!
      await c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [id, head.revision, ...CHECKED_CLEAN])
      if (kind === 'story-world') {
        world = id
        worldVersion = head.version_id
      } else if (kind === 'story-split') split = id
      else feed = id
    }
  })
})
afterAll(async () => db?.close())
async function manifest(page: string) {
  return db.as(
    'owner',
    async c =>
      (await c.query('SELECT render_manifest FROM published_routes WHERE page_id=$1', [page])).rows[0]!
        .render_manifest as RenderManifest,
  )
}
it('uses all eligible stories beyond200 for managed World/Split while ordinary authored feeds keep200', async () => {
  for (const id of [world, split]) {
    const m = await manifest(id),
      source = m.sections[0]!.instance.values!.stories as {
        entries: { stableKey: string; values: Record<string, unknown> }[]
      }
    expect(source.entries).toHaveLength(201)
    expect(source.entries.at(-1)!.stableKey).toBe('story-0200')
    expect(source.entries[0]!.values.credit).toBe('[Required credit]')
    expect(source.entries[0]!.values.body).toBeUndefined()
    expect(source.entries[0]!.values.editor_note).toBeUndefined()
    expect(source.entries[0]!.values.photo).toBeTruthy()
    expect(JSON.stringify(m)).not.toContain('[Full article words]')
    expect(
      (
        await db.as('owner', c =>
          c.query('SELECT app.template_collection_binding_shape_valid($1) AS valid', [JSON.stringify(source)]),
        )
      ).rows[0]!.valid,
    ).toBe(true)
  }
  const ordinary = (await manifest(feed)).sections[0]!.instance.values!.stories as {
    entries: { values: Record<string, unknown> }[]
  }
  expect(ordinary.entries).toHaveLength(200)
  expect(ordinary.entries[0]!.values.body).toContain('[Full article words]')
  expect(
    StructuredRepeatBinding.safeParse({ readerKey: 'stories', selection: { mode: 'automatic', limit: 201 } }).success,
  ).toBe(false)
})
it('renders full region and sector counts and reaches the last story without JavaScript', async () => {
  const worldManifest = await manifest(world),
    splitManifest = await manifest(split),
    shell = await db.as(
      'owner',
      async c =>
        (await c.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [s.siteA])).rows[0]!.payload,
    )
  const worldHtml = renderPage({
    manifest: worldManifest,
    shell,
    isStaging: true,
    options: { storyWidgets: { path: '/story-world', query: { story0_region: 'east' } } },
  }).html
  expect(worldHtml).toContain('[story-0200]')
  expect(worldHtml).toContain('201')
  expect(worldHtml).not.toContain('[expired]')
  const splitHtml = renderPage({
    manifest: splitManifest,
    shell,
    isStaging: true,
    options: { storyWidgets: { path: '/story-split', query: { story0_view: 'recent', story0_page: '34' } } },
  }).html
  expect(splitHtml).toContain('[story-0200]')
  expect(splitHtml).toContain('Showing 201 of 201 stories')
})
it('keeps private drafts out of public sources while the authenticated draft preview uses its full pool', async () => {
  await db.asUser(s.superAdmin, async c => {
    const rows = (
      await c.query(
        'SELECT e.id,e.stable_key AS "stableKey",v.values,c.entry_revision FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN collections c ON c.id=e.collection_id WHERE c.id=$1 ORDER BY e.sort_index',
        [list],
      )
    ).rows
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      list,
      rows[0]!.entry_revision,
      JSON.stringify([
        ...rows.map(row => ({ id: row.id, stableKey: row.stableKey, values: row.values })),
        {
          id: null,
          stableKey: 'private',
          values: { ...rows[0]!.values, title: '[Private new story]', story_url: '/stories/private' },
        },
      ]),
    ])
  })
  expect(
    ((await manifest(world)).sections[0]!.instance.values!.stories as { entries: unknown[] }).entries,
  ).toHaveLength(201)
  const base = await manifest(world),
    preview = await db.asUser(s.editorA, c => withDraftListPreview(c, structuredClone(base), worldVersion, s.siteA)),
    source = preview.sections[0]!.instance.values!.stories as { entries: { values: Record<string, unknown> }[] }
  expect(source.entries).toHaveLength(202)
  expect(source.entries.some(row => row.values.title === '[Private new story]')).toBe(true)
  expect(source.entries[0]!.values.body).toBeUndefined()
})
it('keeps new helpers private, preserves other-reader bounds and leaves stored page bindings unchanged', async () => {
  for (const actor of ['public', 'authenticated'] as const)
    await expect(
      db.as(actor, c =>
        c.query(
          'SELECT app.normalize_list_selection_bounded($1,\'stories\',\'{"mode":"automatic","limit":2000}\',false,2000)',
          [s.siteA],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' })
  await expect(
    db.as('owner', c =>
      c.query(
        'SELECT app.normalize_list_selection_bounded($1,\'other\',\'{"mode":"automatic","limit":201}\',false,2000)',
        [s.siteA],
      ),
    ),
  ).rejects.toMatchObject({ code: 'CMS04' })
  const row = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query('SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
          world,
        ])
      ).rows[0]!,
  )
  expect(row.content[0].values.stories.selection.limit).toBe(200)
  const publicRows = await db.as(
    'public',
    async c => (await c.query('SELECT * FROM public_api.resolve_route($1,$2)', [host, '/story-world'])).rows,
  )
  expect(publicRows).toHaveLength(1)
})
