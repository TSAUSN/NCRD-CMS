import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { corePageDefinitions } from '../src/lib/core-pages.ts'
import { sawsoSection } from '../src/lib/sawso-pages.ts'
let db: TestDatabase, s: Scenario, list: string
const item = [{ type: 'element', tag: 'article', children: [{ type: 'text', field: 'title' }] }],
  host = 'site-a.staging.example.test'
beforeAll(async () => {
  db = await TestDatabase.create('story_visibility')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await installCoreLibrary(c)
    const model = createStoriesModel(emptyStoriesSettings())
    model.fields.push({ key: 'in_feed', label: 'Source feed', type: 'boolean', required: false })
    const made = (
      await c.query("SELECT * FROM app.create_collection($1,'stories','Stories','stories',$2,$3)", [
        s.siteA,
        JSON.stringify(model.fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!
    list = made.collection_id
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [list, made.revision])
    const rows = ['old', 'future', 'hidden', 'removed', 'missing', 'pending'].map(key => ({
        id: null,
        stableKey: key,
        values: {
          title: '[' + key + ' story]',
          summary: '[Description]',
          published_date:
            key === 'old' ? '1999-01-01' : key === 'future' ? '2099-01-01' : new Date().toISOString().slice(0, 10),
          story_url: '/stories/' + key,
          tags: '',
          in_feed: key !== 'missing',
          body: '<p>[' + key + ' words]</p>',
          ...(key === 'hidden'
            ? { hidden: true }
            : key === 'removed'
              ? { feed_removed: true }
              : key === 'missing'
                ? { in_feed: false }
                : {}),
        },
      })),
      saved = (await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [list, JSON.stringify(rows)]))
        .rows[0]!
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [list, saved.entry_revision])
    const defs = await corePageDefinitions(c)
    for (const key of ['old', 'future', 'hidden', 'removed', 'missing', 'pending']) {
      const id = (
          await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'stories/' + key, '[' + key + ' article]'])
        ).rows[0]!.id,
        sections = [
          sawsoSection(defs, 'story-detail', 'Story', {
            story: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [key] } },
          }),
        ],
        head = (await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, JSON.stringify(sections), '{}']))
          .rows[0]!
      await c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [id, head.revision, ...CHECKED_CLEAN])
    }
    const plain = (
        await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'ordinary-page', '[Ordinary page]'])
      ).rows[0]!.id,
      head = (
        await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          plain,
          JSON.stringify([
            sawsoSection(defs, 'text-block', 'Introduction', {
              heading: '[Ordinary page]',
              body: '<p>[Own words]</p>',
            }),
            sawsoSection(defs, 'story-detail', 'Story', {
              story: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: ['hidden'] } },
            }),
          ]),
          '{}',
        ])
      ).rows[0]!
    await c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [plain, head.revision, ...CHECKED_CLEAN])
  })
})
afterAll(async () => db?.close())
const choose = (keys: unknown, draft = false) =>
  db.as(
    'owner',
    async c =>
      (
        await c.query('SELECT app.normalize_list_selection($1,$2,$3,$4) AS value', [
          s.siteA,
          'stories',
          JSON.stringify({ mode: 'manual', stableKeys: keys }),
          draft,
        ])
      ).rows[0]!.value,
  )
const route = (path: string, hostname = host) =>
  db.as('public', async c => (await c.query('SELECT * FROM public_api.resolve_route($1,$2)', [hostname, path])).rows)
it('filters explicit visibility for ordered manual selections and keeps older/future direct articles', async () => {
  expect((await choose(['hidden', 'future', 'removed', 'old', 'missing'])).stableKeys).toEqual(['future', 'old'])
  for (const key of ['old', 'future']) expect(await route('/stories/' + key)).toHaveLength(1)
  for (const key of ['hidden', 'removed', 'missing']) expect(await route('/stories/' + key)).toHaveLength(0)
  expect(await route('/ordinary-page')).toHaveLength(1)
  expect((await route('/ordinary-page'))[0]!.render_manifest.sections[1].instance.values.story.entries).toEqual([])
})
it('omits hidden articles from public paths and does not expose them through another host or helper', async () => {
  const paths = await db.as('public', async c =>
    (await c.query('SELECT * FROM public_api.site_routes($1)', [host])).rows.map(row => row.path),
  )
  expect(paths).toContain('/stories/old')
  expect(paths).toContain('/ordinary-page')
  for (const key of ['hidden', 'removed', 'missing']) expect(paths).not.toContain('/stories/' + key)
  expect(await route('/stories/old', 'site-b.staging.example.test')).toHaveLength(0)
  expect(await route('/stories/old', 'unknown.example.test')).toHaveLength(0)
  await expect(db.as('public', c => c.query("SELECT app.story_visible('{}')"))).rejects.toMatchObject({ code: '42501' })
  await expect(
    db.asUser(s.editorA, c => c.query("SELECT app.story_article_visible($1,$2,'/')", [s.siteA, s.pageA])),
  ).rejects.toMatchObject({ code: '42501' })
})
it('keeps invalid/duplicate/missing manual selections refused by the existing resolver', async () => {
  for (const keys of [['hidden', 'hidden'], ['unknown'], [123], ['bad key']])
    await expect(
      db.as('owner', c =>
        c.query('SELECT app.resolve_collection_repeat($1,$2,$3,$4)', [
          s.siteA,
          'stories',
          JSON.stringify({ mode: 'manual', stableKeys: keys }),
          JSON.stringify(item),
        ]),
      ),
    ).rejects.toMatchObject({ code: 'CMS04' })
})
it('keeps a hide draft private, then hides on guarded publication and restores the same records', async () => {
  const original = (await route('/stories/pending'))[0]!
  async function setHidden(hidden: boolean) {
    return db.asUser(s.superAdmin, async c => {
      const rows = (
          await c.query(
            'SELECT e.id,e.stable_key AS "stableKey",v.values,c.entry_revision FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN collections c ON c.id=e.collection_id WHERE c.id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index',
            [list],
          )
        ).rows,
        saved = (
          await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
            list,
            rows[0]!.entry_revision,
            JSON.stringify(
              rows.map(row => ({
                id: row.id,
                stableKey: row.stableKey,
                values: row.stableKey === 'pending' ? { ...row.values, hidden } : row.values,
              })),
            ),
          ])
        ).rows[0]!
      return { id: rows.find(row => row.stableKey === 'pending')!.id, revision: saved.entry_revision }
    })
  }
  const hidden = await setHidden(true)
  expect((await choose(['pending'], true)).stableKeys).toEqual([])
  expect((await choose(['pending'])).stableKeys).toEqual(['pending'])
  expect(await route('/stories/pending')).toHaveLength(1)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.publish_story_entries($1,$2,$3)', [list, hidden.revision, [hidden.id]]),
  )
  expect(await route('/stories/pending')).toHaveLength(0)
  const restored = await setHidden(false)
  expect(restored.id).toBe(hidden.id)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.publish_story_entries($1,$2,$3)', [list, restored.revision, [restored.id]]),
  )
  const after = (await route('/stories/pending'))[0]!
  expect(after.page_id).toBe(original.page_id)
  expect(after.page_version_id).toBe(original.page_version_id)
  expect(after.render_manifest.sections[0].instance.values.story.entries[0].values.body).toContain('[pending words]')
})
