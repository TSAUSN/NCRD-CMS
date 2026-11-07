import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { saveNewsroomOrder } from '../../../apps/admin/src/lib/story-newsroom-commands.ts'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
import { createStoriesModel, emptyStoriesSettings, storyDateInFeed } from '@cms/schema'
async function publishSelected(page: Page, siteId: string) {
  await page.goto('/sites/' + siteId + '/publishing?lists=1')
  const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
  await publish.click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible({
    timeout: 60000,
  })
  const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
  if (await sample.isVisible()) await sample.check()
  const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings', exact: true })
  if (await reason.isVisible()) await reason.fill('Checking this isolated local Story ordering fixture.')
  await publish.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
}
test('Symphony Stories keeps tagging intact, features five private stories in order, preserves sector dates and publishes an optional author', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/symphony-stories/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let visitor: Awaited<ReturnType<typeof browser.newContext>> | undefined
  let sourceReads = 0
  try {
    const all = (
        await f.client.query(
          "SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY v.values->>'published_date',e.id",
          [f.collectionId],
        )
      ).rows,
      eligible = all.filter(
        row => storyDateInFeed(row.values.published_date) && !row.values.hidden && !row.values.feed_removed,
      ),
      chosen = eligible.slice(0, 6)
    expect(chosen.length).toBe(6)
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const def = (
        await f.client.query(
          "SELECT d.id,v.version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='core-story-split' ORDER BY v.version DESC LIMIT 1",
        )
      ).rows[0]!,
      news = (await f.client.query("SELECT app.create_page($1,'featured-news','[Newsroom]') AS id", [f.siteId]))
        .rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      news,
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
            stories: {
              readerKey: 'stories',
              selection: {
                mode: 'automatic',
                limit: 200,
                order: 'newest',
                dateField: 'published_date',
                maxAgeMonths: 13,
              },
            },
          },
        },
      ]),
      '{}',
    ])
    await f.client.query('COMMIT')
    await page.route('https://sawso.org/**', async route => {
      sourceReads++
      await route.abort()
    })
    await signIn(page, 'root@example.test')
    await publishSelected(page, f.siteId)
    visitor = await browser.newContext({ javaScriptEnabled: false })
    const publicPage = await visitor.newPage(),
      newsUrl = 'http://' + f.hostname + `:${E2E_PORTS.site}/featured-news`,
      sectorUrl = 'http://' + f.hostname + `:${E2E_PORTS.site}/ways-we-help/health`,
      titles = () => publicPage.locator('.core-story-card h3').allTextContents()
    await publicPage.goto(sectorUrl)
    const sectorBefore = await titles()
    await publicPage.goto(newsUrl)
    const newsBefore = await titles()
    expect(newsBefore).not.toContain(chosen[0]!.values.title)
    const heads = async () =>
        (
          await f.client.query(
            'SELECT e.id,e.published_version_id FROM collection_entries e WHERE e.collection_id=$1 ORDER BY e.id',
            [f.collectionId],
          )
        ).rows,
      live = await heads(),
      base = '/sites/' + f.siteId + '/stories',
      capture = async (name: string) => {
        await page.evaluate(() => scrollTo(0, 0))
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
    await page.goto(base)
    const row = (index: number) => page.getByRole('article', { name: chosen[index]!.values.title, exact: true })
    await expect(row(0).getByRole('checkbox', { name: 'Reviewed', exact: true })).toBeVisible()
    await expect(row(0).getByRole('group', { name: 'Project Sectors', exact: true }).getByRole('button')).toHaveCount(8)
    await expect(row(0).getByRole('group', { name: 'Regions', exact: true }).getByRole('button')).toHaveCount(4)
    for (let index = 0; index < 5; index++) {
      await row(index).getByRole('button', { name: 'Feature', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Story changes saved' })).toBeVisible()
      await expect(row(index).getByRole('button', { name: 'Featured', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
    await row(5).getByRole('button', { name: 'Feature', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'You can feature up to 5 stories' })).toBeVisible()
    expect(await heads()).toEqual(live)
    await capture('list-stars')
    await page.getByRole('link', { name: 'Newsroom order', exact: true }).click()
    const featured = page.getByRole('list', { name: 'Featured stories', exact: true })
    await expect(featured.locator('[data-feature-id]')).toHaveCount(5)
    await expect(
      page.getByRole('list', { name: 'Newsroom visitor preview', exact: true }).locator('strong').first(),
    ).toHaveText(chosen[0]!.values.title)
    await capture('newsroom-order')
    const moving = featured.locator('[data-feature-id="' + chosen[4]!.id + '"]')
    if (info.project.name === 'chromium')
      await moving.dragTo(featured.locator('[data-feature-id="' + chosen[0]!.id + '"]'), {
        targetPosition: { x: 12, y: 4 },
      })
    else
      for (let n = 0; n < 4; n++) {
        await moving.getByRole('button', { name: 'Move ' + chosen[4]!.values.title + ' up', exact: true }).click()
        await expect(page.getByRole('status')).toHaveText('Newsroom order saved.')
      }
    await expect(featured.locator('[data-feature-id]').first()).toHaveAttribute('data-feature-id', chosen[4]!.id)
    await expect(page.getByRole('status')).toHaveText('Newsroom order saved.')
    await capture('featured-order-saved')
    expect(await heads()).toEqual(live)
    await publicPage.goto(newsUrl)
    expect(await titles()).toEqual(newsBefore)
    await publicPage.goto(sectorUrl)
    expect(await titles()).toEqual(sectorBefore)
    const snapshot = (await f.client.query('SELECT c.entry_revision FROM collections c WHERE id=$1', [f.collectionId]))
        .rows[0]!,
      current = (
        await f.client.query(
          'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id',
          [f.collectionId],
        )
      ).rows
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    await expect(
      f.client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        f.collectionId,
        snapshot.entry_revision,
        JSON.stringify(
          current.map((record, index) => ({
            id: record.id,
            stableKey: record.stable_key,
            values: { ...record.values, newsroom_rank: index < 6 ? 1 : 0 },
          })),
        ),
      ]),
    ).rejects.toMatchObject({ code: 'CMS04' })
    await f.client.query('ROLLBACK')
    expect(
      (await f.client.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collectionId])).rows[0]!
        .entry_revision,
    ).toBe(snapshot.entry_revision)
    await publishSelected(page, f.siteId)
    await publicPage.goto(newsUrl)
    expect((await titles())[0]).toBe(chosen[4]!.values.title)
    await publicPage.goto(sectorUrl)
    expect(await titles()).toEqual(sectorBefore)
    const first = chosen[4]!
    await page.goto(base + '/' + first.id)
    await expect(page.getByLabel('Author (optional)', { exact: true })).toBeVisible()
    await expect(page.getByText(String(first.values.summary.length) + ' / 155', { exact: true })).toBeVisible()
    await page.getByLabel('Author (optional)', { exact: true }).fill('[Name]')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Story draft saved' })).toBeVisible()
    await expect(page.getByLabel('Author (optional)', { exact: true })).toHaveValue('[Name]')
    await capture('writer-author')
    await publishSelected(page, f.siteId)
    for (const width of [1440, 1024, 390]) {
      await publicPage.setViewportSize({ width, height: 900 })
      await publicPage.goto(newsUrl)
      await expect(publicPage.locator('.core-story-card h3').first()).toHaveText(first.values.title)
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await publicPage.screenshot({ path: resolve(folder, 'public-featured-no-script-' + width + '.png') })
    }
    await publicPage.goto('http://' + f.hostname + `:${E2E_PORTS.site}` + first.values.story_url)
    await expect(publicPage.getByText('By [Name]', { exact: true })).toBeVisible()
    expect(sourceReads).toBe(0)
  } finally {
    await visitor?.close()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('Newsroom controls upgrade explicitly, preserve draft words and recover from failed and conflicting order saves without expanding access', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/symphony-stories/' + info.project.name)
  let editorContext: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      editor = (await c.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id,
      outsider = (await c.query("SELECT id FROM app_users WHERE email='contributor@example.test'")).rows[0]!.id,
      model = createStoriesModel(emptyStoriesSettings()),
      fields = model.fields.filter(field => !['author', 'newsroom_rank'].includes(field.key))
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query("SELECT app.set_site_membership($1,$2,'editor')", [editor, f.site])
    const collection = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        f.site,
        'stories',
        'Stories',
        'stories',
        JSON.stringify(fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!.collection_id
    await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      collection,
      JSON.stringify(
        ['First', 'Second', 'Third'].map(word => ({
          id: null,
          stableKey: word.toLowerCase(),
          values: {
            title: '[' + word + ' story]',
            summary: '[Summary]',
            published_date: '2026-10-01',
            story_url: '/stories/' + word.toLowerCase(),
            body: '<p>[Saved words]</p>',
          },
        })),
      ),
    ])
    await c.query('COMMIT')
    const before = (
        await c.query(
          'SELECT e.id,e.draft_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index',
          [collection],
        )
      ).rows,
      base = '/sites/' + f.site + '/stories'
    await signIn(page, 'root@example.test')
    await page.goto(base)
    await expect(page.getByRole('button', { name: 'Feature', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Update Stories', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Feature', exact: true })).toHaveCount(3)
    expect(
      (
        await c.query(
          'SELECT e.id,e.draft_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index',
          [collection],
        )
      ).rows,
    ).toEqual(before)
    editorContext = await browser.newContext()
    const edit = await editorContext.newPage()
    await signIn(edit, 'editor@example.test')
    await edit.goto(base)
    await expect(edit.getByRole('link', { name: 'Manage tags', exact: true })).toHaveCount(0)
    for (const word of ['First', 'Second', 'Third']) {
      await edit
        .getByRole('article', { name: '[' + word + ' story]', exact: true })
        .getByRole('button', { name: 'Feature', exact: true })
        .click()
      await expect(edit.getByRole('status').filter({ hasText: 'Story changes saved' })).toBeVisible()
    }
    await edit.getByRole('link', { name: 'Newsroom order', exact: true }).click()
    const featured = edit.getByRole('list', { name: 'Featured stories', exact: true }),
      last = featured.locator('[data-feature-id]').last(),
      lastId = await last.getAttribute('data-feature-id')
    let abort = true
    await edit.route('**/sites/' + f.site + '/stories*', async route => {
      if (abort && route.request().method() === 'POST') {
        abort = false
        await route.abort('failed')
      } else await route.continue()
    })
    await last.getByRole('button', { name: /^Move .* up$/ }).click()
    await expect(edit.getByRole('alert').filter({ hasText: 'could not be confirmed' })).toContainText(
      'could not be confirmed',
    )
    await edit.getByRole('link', { name: 'Pages', exact: true }).click()
    const leave = edit.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    for (const width of [1440, 1024]) {
      await edit.setViewportSize({ width, height: 1000 })
      await edit.screenshot({ path: resolve(folder, 'order-save-error-' + width + '.png') })
    }
    await edit.getByRole('button', { name: 'Retry changes', exact: true }).click()
    await expect(edit.getByRole('status')).toHaveText('Newsroom order saved.')
    await expect(featured.locator('[data-feature-id]').nth(1)).toHaveAttribute('data-feature-id', lastId!)
    await expect(
      featured
        .locator('[data-feature-id]')
        .nth(1)
        .getByRole('button', { name: /^Move .* up$/ }),
    ).toBeEnabled()
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [collection])).rows[0]!,
      rows = (
        await c.query(
          'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id',
          [collection],
        )
      ).rows
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collection,
      head.entry_revision,
      JSON.stringify(
        rows.map((row, index) => ({
          id: row.id,
          stableKey: row.stable_key,
          values: index === 0 ? { ...row.values, body: '<p>[Concurrent saved words]</p>' } : row.values,
        })),
      ),
    ])
    await c.query('COMMIT')
    await featured
      .locator('[data-feature-id]')
      .nth(1)
      .getByRole('button', { name: /^Move .* up$/ })
      .click()
    await expect(edit.getByRole('alert').filter({ hasText: 'Saved Stories changed' })).toContainText(
      'Saved Stories changed',
    )
    for (const width of [1440, 1024]) {
      await edit.setViewportSize({ width, height: 1000 })
      await edit.screenshot({ path: resolve(folder, 'order-conflict-' + width + '.png') })
    }
    await edit.getByRole('button', { name: 'Use saved order', exact: true }).click()
    await expect(edit.getByRole('status')).toHaveText('Saved Newsroom order restored. Unsaved proposal discarded.')
    expect(
      (
        await c.query(
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
          [rows[0]!.id],
        )
      ).rows[0]!.values.body,
    ).toBe('<p>[Concurrent saved words]</p>')
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.set_site_membership($1,$2,NULL)', [outsider, f.site])
    await c.query('COMMIT')
    const current = (
        await c.query('SELECT revision::text,entry_revision::text FROM collections WHERE id=$1', [collection])
      ).rows[0]!,
      ids = (
        await c.query(
          "SELECT e.id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND (v.values->>'newsroom_rank')~'^[1-5]$' ORDER BY (v.values->>'newsroom_rank')::int",
          [collection],
        )
      ).rows.map(row => String(row.id))
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [outsider])
    await expect(
      saveNewsroomOrder(c, f.site, collection, current.revision, current.entry_revision, [...ids].reverse()),
    ).rejects.toThrow('Stories is unavailable')
    await c.query('ROLLBACK')
    expect(
      (await c.query('SELECT revision::text,entry_revision::text FROM collections WHERE id=$1', [collection])).rows[0],
    ).toEqual(current)
  } finally {
    await editorContext?.close()
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
