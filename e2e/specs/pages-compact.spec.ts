import { test, expect } from '@playwright/test'
import { signIn } from './helpers.ts'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
test('Pages keeps actions together and filters its Main pages and Drafts groups', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  const base = await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).getAttribute('href')
  await page.goto(base + '/pages')
  const rows = page.getByRole('table', { name: 'Pages', exact: true }).locator('tbody tr')
  const count = await rows.count()
  const status = page.getByRole('group', { name: 'Page groups', exact: true })
  await status.getByRole('button', { name: /^Drafts \d+$/ }).click()
  await expect(status.getByRole('button', { name: /^Drafts \d+$/ })).toHaveAttribute('aria-pressed', 'true')
  for (const row of await rows.all()) await expect(row.locator('[data-status="draft"]')).toHaveCount(1)
  await status.getByRole('button', { name: /^Main pages \d+$/ }).click()
  await expect(page.getByRole('table', { name: 'Pages', exact: true }).locator('tbody tr')).toHaveCount(count)
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `../.r8-progress/polish-pages-${width}.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('Pages shows the same Eastern edit date when the browser is in UTC', async ({ browser, baseURL }) => {
  const f = await siteLookFixture()
  const context = await browser.newContext({ baseURL, timezoneId: 'UTC' })
  const title = '[Pages midnight fixture]'
  try {
    const client = await f.pool.connect()
    try {
      await client.query('BEGIN')
      const actor = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
      const created = await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        f.site,
        'local-midnight-fixture',
        title,
      ])
      // Only the empty test page is dated. Its editing day crosses midnight in UTC.
      const stamped = await client.query('UPDATE pages SET created_at=$2 WHERE id=$1 AND draft_version_id IS NULL', [
        created.rows[0]!.id,
        '2026-10-29T03:43:41Z',
      ])
      expect(stamped.rowCount).toBe(1)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    const page = await context.newPage()
    await signIn(page, 'root@example.test')
    const hydrationErrors: string[] = []
    page.on('pageerror', error => {
      if (/Minified React error #418|hydration/i.test(error.message)) hydrationErrors.push(error.message)
    })
    await page.goto('/sites/' + f.site + '/pages')
    const table = page.getByRole('table', { name: 'Pages', exact: true })
    const row = table.getByRole('row').filter({ has: page.getByRole('link', { name: title, exact: true }) })
    await expect(row.locator('time')).toHaveText('Oct 28')
    await page.getByRole('searchbox', { name: 'Search pages and stories', exact: true }).fill(title)
    await expect(table.locator('tbody tr')).toHaveCount(1)
    await expect(row.locator('time')).toHaveText('Oct 28')
    expect(hydrationErrors).toEqual([])
  } finally {
    await context.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
