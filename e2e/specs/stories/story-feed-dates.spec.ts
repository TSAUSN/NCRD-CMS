import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
import { storyDateInFeed } from '../../../packages/schema/src/content/stories.ts'
import { STORY_SAMPLE_BODY } from '../../../packages/seeds/src/sawso-stories.ts'
test('expired stories leave public feeds and Live filters while their own pages work without JavaScript', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-feed-dates/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let visitor: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    const entries = (
        await f.client.query(
          "SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY v.values->>'published_date'",
          [f.collectionId],
        )
      ).rows,
      expired = entries[0]!,
      title = String(expired.values.title),
      path = String(expired.values.story_url),
      live = entries.filter(row => storyDateInFeed(row.values.published_date)).length
    expect(storyDateInFeed(expired.values.published_date)).toBe(false)
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const head = (await f.client.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collectionId])).rows[0]!
    await f.client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      f.collectionId,
      head.entry_revision,
      JSON.stringify(
        entries.map(row => ({
          id: row.id,
          stableKey: row.stable_key,
          values: row.id === expired.id ? { ...row.values, body: STORY_SAMPLE_BODY, body_is_sample: true } : row.values,
        })),
      ),
    ])
    const pages = (
      await f.client.query('SELECT id FROM pages WHERE site_id=$1 AND slug=ANY($2::text[])', [
        f.siteId,
        ['', 'newsroom', path.slice(1)],
      ])
    ).rows
    expect(pages).toHaveLength(3)
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/publishing?siteLook=1&lists=1&pages=' + pages.map(row => row.id).join(','))
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
    await expect(sample.or(page.getByRole('alertdialog'))).toBeVisible({ timeout: 60000 })
    if (await sample.isVisible()) {
      await sample.check()
      const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
      if (await reason.isVisible()) await reason.fill('Reviewing the isolated Story date-window fixture.')
      await publish.click()
    }
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    const base = '/sites/' + f.siteId + '/stories'
    await page.goto(base + '?q=' + encodeURIComponent(title))
    await expect(page.getByText(new RegExp('^' + live + ' live ·'))).toBeVisible()
    await expect(page.getByRole('article', { name: title, exact: true })).toContainText('Not in feeds')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'older-story-' + width + '.png') })
    }
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('live')
    await expect(page.getByRole('article')).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('untagged')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'filter-caption-' + width + '.png') })
    }
    visitor = await browser.newContext({ javaScriptEnabled: false })
    const view = await visitor.newPage(),
      origin = 'http://' + f.hostname + `:${E2E_PORTS.site}`
    for (const width of [1440, 1024, 390]) {
      await view.setViewportSize({ width, height: 900 })
      await view.goto(origin + '/newsroom?q=' + encodeURIComponent(title))
      await expect(view.locator('.core-story-card')).toHaveCount(0)
      await expect(
        view.getByText('No current stories are available. Please check back soon.', { exact: true }),
      ).toBeVisible()
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.screenshot({ path: resolve(folder, 'expired-feed-' + width + '.png'), fullPage: true })
      expect((await view.goto(origin + path))?.status()).toBe(200)
      await expect(view.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible()
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.screenshot({ path: resolve(folder, 'retained-article-' + width + '.png'), fullPage: true })
    }
  } finally {
    await visitor?.close()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
