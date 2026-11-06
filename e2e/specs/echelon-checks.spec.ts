import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn } from './helpers.ts'
test.use({ actionTimeout: 15_000 })
test('January and July checks record both chapter wordings locally, with one message per contact', async ({ page }) => {
  test.setTimeout(90_000)
  const f = await echelonFixture(true),
    folder = resolve('../.r8-progress/echelon/checks'),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/settings?tab=reviews')
    const settings = page.getByRole('region', { name: 'Chapter checks', exact: true })
    await settings.getByRole('heading', { name: 'Review reminders', exact: true }).scrollIntoViewIfNeeded()
    await capture('check-settings')
    await settings.getByRole('tab', { name: 'Division makes changes', exact: true }).click()
    await settings.locator('summary').filter({ hasText: 'Test tools (this computer only)' }).click()
    await settings.getByRole('button', { name: 'Record waiting review messages', exact: true }).scrollIntoViewIfNeeded()
    await capture('check-preview')
    await settings.getByLabel('Check year', { exact: true }).fill('2201')
    await settings.getByRole('button', { name: 'Record contact check', exact: true }).click()
    await expect(settings.getByRole('alert')).toContainText('Choose a year and January or July')
    await settings.getByRole('alert').scrollIntoViewIfNeeded()
    await capture('check-error')
    await settings.getByLabel('Check year', { exact: true }).fill('2027')
    await settings.getByRole('button', { name: 'Record contact check', exact: true }).click()
    await expect(settings.getByRole('status')).toContainText('43 messages recorded')
    await expect(settings.getByRole('status')).toContainText('No email was sent')
    await settings.getByRole('button', { name: 'Record contact check', exact: true }).click()
    await expect(settings.getByRole('status')).toContainText('No new messages to record')
    await settings.getByRole('link', { name: 'Open local outbox', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Local outbox', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'January chapter page check', exact: true })).toHaveCount(43)
    const editor = page
        .getByRole('region', { name: 'January chapter page check', exact: true })
        .filter({ hasText: 'maryland@example.test' }),
      division = page
        .getByRole('region', { name: 'January chapter page check', exact: true })
        .filter({ hasText: 'contact-indianapolis@example.test' })
    await expect(editor).toContainText('please take a few minutes to check your chapter page')
    await expect(division).toContainText('in one email to the [Division] web team by January 31')
    await expect(division).toContainText('Nothing to change? Just reply “all good”.')
    await expect(editor.getByRole('link', { name: 'Check my page', exact: true })).toHaveAttribute(
      'href',
      /\/pages\/[a-f0-9-]{36}$/,
    )
    await editor.scrollIntoViewIfNeeded()
    await capture('editor-check-message')
    await division.scrollIntoViewIfNeeded()
    await capture('division-check-message')
    await page.goto('/sites/' + f.site + '/settings?tab=reviews')
    await settings.locator('summary').filter({ hasText: 'Test tools (this computer only)' }).click()
    await settings.getByLabel('Check month', { exact: true }).selectOption('07')
    await settings.getByLabel('Check year', { exact: true }).fill('2027')
    await settings.getByRole('button', { name: 'Record contact check', exact: true }).click()
    await expect(settings.getByRole('status')).toContainText('43 messages recorded')
    await settings.getByLabel('January and July contact checks', { exact: true }).uncheck()
    await settings.getByRole('button', { name: 'Save check settings', exact: true }).click()
    await expect(settings.getByRole('status')).toContainText('Chapter checks saved')
    await settings.getByLabel('Check year', { exact: true }).fill('2028')
    await expect(settings.getByRole('button', { name: 'Record contact check', exact: true })).toBeDisabled()
    await settings.getByRole('button', { name: 'Record contact check', exact: true }).scrollIntoViewIfNeeded()
    await capture('checks-off')
    const summary = (
      await f.pool.query(
        'SELECT kind,count(*)::integer AS count FROM local_chapter_outbox WHERE site_id=$1 GROUP BY kind',
        [f.site],
      )
    ).rows
    expect(summary).toEqual([{ kind: 'check', count: 86 }])
    expect(errors).toEqual([])
  } finally {
    f.client.release()
    await f.pool.end()
  }
})
