import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn } from './helpers.ts'

test('chapter Settings shows the real default choices and both reminder previews while local tools stay available', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000)
  const f = await echelonFixture(true),
    folder = resolve('../.r8-progress/round3/chapter-settings-admin/' + info.project.name),
    staffContext = await browser.newContext()
  try {
    await mkdir(folder, { recursive: true })
    const heads = (
      await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
        f.site,
      ])
    ).rows
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/settings?tab=publishing')
    const defaults = page.getByRole('region', { name: 'Chapter defaults', exact: true })
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.evaluate(() => document.fonts.ready)
        await page
          .getByRole('heading', { name: 'Settings', level: 1, exact: true })
          .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await expect(defaults.getByRole('heading', { name: 'Publishing and approval', exact: true })).toBeVisible()
    await expect(defaults.getByRole('radio', { name: /^Division web team makes changes/ })).toBeChecked()
    await capture('publishing')
    await defaults.getByRole('radio', { name: /^Chapter editors sign in/ }).check()
    await defaults.getByRole('button', { name: 'Save chapter defaults', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Chapter defaults saved' })).toBeVisible()
    await page.reload()
    await expect(defaults.getByRole('radio', { name: /^Chapter editors sign in/ })).toBeChecked()
    await capture('chapter-editors')
    await page.getByRole('link', { name: 'Review reminders', exact: true }).click()
    const checks = page.getByRole('region', { name: 'Chapter checks', exact: true })
    await expect(checks.getByRole('tab', { name: 'Chapters with editors', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(checks.getByRole('tabpanel')).toContainText('please take a few minutes')
    await capture('reminders-editors')
    await checks.getByRole('tab', { name: 'Division makes changes', exact: true }).click()
    await expect(checks.getByRole('tabpanel')).toContainText('in one email to the [Division] web team')
    await capture('reminders-division')
    await expect(checks.getByRole('button', { name: 'Record contact check', exact: true })).toBeHidden()
    await expect(checks.locator('details')).toHaveCount(1)
    await expect(checks.getByRole('switch', { name: 'January and July contact checks', exact: true })).toBeVisible()
    await checks.locator('summary').filter({ hasText: 'Test tools (this computer only)' }).click()
    await expect(checks.getByRole('button', { name: 'Record contact check', exact: true })).toBeVisible()
    await expect(checks.getByLabel('January and July contact checks', { exact: true })).toBeChecked()
    await capture('local-tools')
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
    await f.pool.query(
      "INSERT INTO site_memberships(site_id,user_id,role) SELECT $1,id,'site_admin' FROM app_users WHERE email='editor@example.test'",
      [f.site],
    )
    const staff = await staffContext.newPage()
    await signIn(staff, 'editor@example.test')
    await staff.goto('/sites/' + f.site + '/settings?tab=reviews')
    await expect(staff.getByRole('switch', { name: 'January and July contact checks', exact: true })).toBeVisible()
    await expect(staff.getByText('Test tools (this computer only)', { exact: true })).toHaveCount(0)
    await expect(staff.getByRole('button', { name: 'Record contact check', exact: true })).toHaveCount(0)
  } finally {
    await staffContext.close()
    f.client.release()
    await f.pool.end()
  }
})
