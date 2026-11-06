import { E2E_PORTS } from '../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
async function publish(page: Page) {
  const button = page.getByRole('button', { name: 'Publish selected (1)', exact: true })
  await button.click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await button.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
test('scoped Story publication refuses partial featured swaps and a sixth live feature,while independent words and the reviewed group still publish', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/story-feature-publication/' + info.project.name),
    visitor = await browser.newContext({ javaScriptEnabled: false }),
    view = await visitor.newPage()
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      model = createStoriesModel(emptyStoriesSettings()),
      day = new Date().toISOString().slice(0, 10)
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const collection = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        f.site,
        'stories',
        'Stories',
        'stories',
        JSON.stringify(model.fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!.collection_id
    await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      collection,
      JSON.stringify(
        Array.from({ length: 6 }, (_, index) => ({
          id: null,
          stableKey: 'story-' + (index + 1),
          values: {
            title: '[Story ' + (index + 1) + ']',
            summary: '[Description]',
            published_date: day,
            story_url: '/visit',
            body: '<p>[Saved words]</p>',
            newsroom_rank: index < 5 ? index + 1 : 0,
          },
        })),
      ),
    ])
    const schema = (await c.query('SELECT revision FROM collections WHERE id=$1', [collection])).rows[0]!
    await c.query('SELECT app.publish_collection_schema($1,$2)', [collection, schema.revision])
    await c.query('SELECT app.publish_collection_entries($1,1)', [collection])
    const def = (
      await c.query(
        "SELECT d.id,v.version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-story-split' ORDER BY v.version DESC LIMIT 1",
      )
    ).rows[0]!
    for (const [slug, selection] of [
      ['news', { mode: 'automatic', limit: 200, order: 'newest', dateField: 'published_date', maxAgeMonths: 13 }],
      [
        'chosen-news',
        { mode: 'manual', stableKeys: ['story-6', 'story-5', 'story-4', 'story-3', 'story-2', 'story-1'] },
      ],
    ] as const) {
      const id = (await c.query('SELECT app.create_page($1,$2,$3) AS id', [f.site, slug, '[' + slug + ']'])).rows[0]!.id
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify([
          {
            section_def_id: def.id,
            section_def_version: def.version,
            label: 'Split View',
            values: {
              heading: 'News and Stories',
              introduction: '[Introduction]',
              start_view: 'recent',
              page_size: '6',
              stories: { readerKey: 'stories', selection },
            },
          },
        ]),
        JSON.stringify({ description: '[Stories description]' }),
      ])
      await c.query("SELECT app.publish_page($1,1,3,NULL,'[]')", [id])
    }
    await c.query('COMMIT')
    const records = async () =>
        (
          await c.query(
            'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
            [collection],
          )
        ).rows,
      live = async () =>
        (
          await c.query(
            'SELECT e.id,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.published_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
            [collection],
          )
        ).rows,
      save = async (rows: Awaited<ReturnType<typeof records>>) => {
        await c.query('BEGIN')
        await c.query('SET LOCAL ROLE cms_authenticated_user')
        await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
        const head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [collection])).rows[0]!
        await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
          collection,
          head.entry_revision,
          JSON.stringify(rows.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values }))),
        ])
        await c.query('COMMIT')
      },
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 950 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      },
      base = '/sites/' + f.site + '/stories'
    const original = await live(),
      rows = await records()
    rows[0]!.values.newsroom_rank = 2
    rows[1]!.values.newsroom_rank = 1
    rows[5]!.values.body = '<p>[Independent saved words]</p>'
    await save(rows)
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const revision = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [collection])).rows[0]!
      .entry_revision
    await expect(
      c.query('SELECT * FROM app.publish_story_entries($1,$2,$3)', [collection, revision, [rows[0]!.id]]),
    ).rejects.toMatchObject({ code: 'CMS04', message: expect.stringContaining('Newsroom order together') })
    await c.query('ROLLBACK')
    expect(await live()).toEqual(original)
    await signIn(page, 'root@example.test')
    await page.goto(base + '/' + rows[0]!.id)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Newsroom order together' })).toBeVisible()
    await capture('partial-swap-refused')
    expect(await live()).toEqual(original)
    await page.goto(base + '/' + rows[5]!.id)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Publish selected (1)', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    const independent = await live()
    expect(independent[5]!.values.body).toBe('<p>[Independent saved words]</p>')
    expect(independent.slice(0, 5)).toEqual(original.slice(0, 5))
    await page.goto('/sites/' + f.site + '/publishing?lists=1')
    await publish(page)
    const swapped = await live()
    expect(swapped[0]!.values.newsroom_rank).toBe(2)
    expect(swapped[1]!.values.newsroom_rank).toBe(1)
    await view.goto('http://' + f.host + `:${E2E_PORTS.site}/news`)
    await expect(view.locator('.core-story-card h3').first()).toHaveText('[Story 2]')
    await view.goto('http://' + f.host + `:${E2E_PORTS.site}/chosen-news`)
    await expect(view.locator('.core-story-card h3').first()).toHaveText('[Story 6]')
    const next = await records()
    next[0]!.values.newsroom_rank = 0
    for (let index = 2; index < 5; index++) next[index]!.values.newsroom_rank = index
    next[5]!.values.newsroom_rank = 5
    await save(next)
    await page.goto(base + '/' + next[5]!.id)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Newsroom order together' })).toBeVisible()
    await capture('sixth-live-feature-refused')
    expect(await live()).toEqual(swapped)
    await page.goto('/sites/' + f.site + '/publishing?lists=1')
    await publish(page)
    expect((await live()).filter(row => row.values.newsroom_rank > 0)).toHaveLength(5)
  } finally {
    await visitor.close()
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
