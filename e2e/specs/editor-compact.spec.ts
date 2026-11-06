import { test, expect } from '@playwright/test'
import { signIn, openSeededPage } from './helpers.ts'
test('compact editor exposes the existing page settings from its right panel', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await openSeededPage(page)
  await page.getByRole('button', { name: 'Open page settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Page settings', exact: true })
  await expect(settings.getByLabel('Search title', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: 'Close Page settings', exact: true }).click()
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: `../.r8-progress/polish-editor-${width}.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
