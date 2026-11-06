import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn, canvas } from './helpers.ts'
test.use({ actionTimeout: 15_000 })
test('a site administrator sets up a division and its staff add their first chapter', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const f = await echelonFixture(false, false),
    email = 'division-' + randomUUID().slice(0, 8) + '@example.test',
    folder = resolve('../.r8-progress/echelon/teams')
  const staffContext = await browser.newContext(),
    staff = await staffContext.newPage(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  staff.on('pageerror', error => errors.push(error.message))
  const capture = async (name: string, active = page) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await active.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/settings?tab=publishing')
    await page.getByRole('radio', { name: /^Chapter editors sign in/ }).check()
    await page.getByRole('button', { name: 'Save chapter defaults', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Chapter defaults saved' })).toBeVisible()
    await page.getByLabel('Division name', { exact: true }).fill('Example division (sample)')
    await page.getByRole('button', { name: 'Add division team', exact: true }).click()
    await page.locator('summary').filter({ hasText: 'Example division (sample)' }).click()
    await page.getByLabel('Staff name', { exact: true }).fill('Division staff (sample)')
    await page.getByLabel('Staff email', { exact: true }).fill(email)
    await page.getByRole('button', { name: 'Add division staff', exact: true }).click()
    await expect(page.getByText(email, { exact: true })).toBeVisible()
    await page.getByRole('heading', { name: 'Settings', exact: true, level: 1 }).scrollIntoViewIfNeeded()
    await capture('settings-top')
    await page.getByRole('group', { name: 'New chapters start with', exact: true }).scrollIntoViewIfNeeded()
    await capture('settings-defaults')
    await page.getByRole('button', { name: 'Add division staff', exact: true }).scrollIntoViewIfNeeded()
    await capture('division-team')
    await signIn(staff, email)
    await capture('division-home', staff)
    await staff.getByRole('link', { name: /Set up chapters/ }).click()
    await expect(staff.getByRole('table', { name: 'Chapters', exact: true }).locator('tbody tr')).toHaveCount(0)
    await expect(staff.getByText('No chapters match.', { exact: false })).toBeVisible()
    await expect(staff.getByText('Test tools (this computer only)', { exact: true })).toHaveCount(0)
    await capture('empty-division', staff)
    await staff.getByRole('button', { name: '+ Add a chapter', exact: true }).click()
    const form = staff.getByRole('dialog', { name: 'Add a chapter', exact: true })
    await form.getByRole('textbox', { name: /^Chapter name/ }).fill('Maryland Chapter')
    await capture('add-chapter', staff)
    await form.getByRole('button', { name: 'Continue', exact: true }).click()
    await capture('chapter-sections', staff)
    await form.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(form.getByLabel('How the page gets updated', { exact: true })).toHaveValue('chapter-editors')
    await expect(form.getByLabel('Division web team', { exact: true })).toHaveValue(/.+/)
    await capture('chapter-people', staff)
    await form.getByRole('button', { name: 'Save chapter', exact: true }).click()
    await expect(staff.getByRole('status').filter({ hasText: 'Chapter saved as a draft' })).toBeVisible()
    const row = staff.getByRole('row').filter({ hasText: 'Maryland Chapter' })
    await row.getByRole('button', { name: 'Maryland Chapter', exact: true }).click()
    await expect(
      staff
        .getByRole('dialog', { name: 'Maryland Chapter', exact: true })
        .getByRole('button', { name: 'Invite a volunteer', exact: true }),
    ).toBeVisible()
    await capture('created-chapter', staff)
    await staff
      .getByRole('dialog', { name: 'Maryland Chapter', exact: true })
      .getByRole('button', { name: 'Set up', exact: true })
      .click()
    await staff.getByRole('link', { name: 'Open chapter page', exact: true }).click()
    await expect(canvas(staff).locator('h1')).toHaveText('Maryland Chapter')
    await expect(staff.getByRole('link', { name: 'Site look', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await staffContext.close()
    f.client.release()
    await f.pool.end()
  }
})
