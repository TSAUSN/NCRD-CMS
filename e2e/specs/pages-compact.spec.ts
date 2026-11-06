import { test, expect } from '@playwright/test'
import { signIn } from './helpers.ts'
test('Pages keeps actions together and filters its Main pages and Drafts groups', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  const base = await page.getByRole('link', { name: 'Demo site', exact: true }).getAttribute('href')
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
