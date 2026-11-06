import { expect, test } from '@playwright/test'
import { canvas, signIn } from './helpers.ts'

async function openSeededPage(page: import('@playwright/test').Page) {
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(canvas(page).locator('h1')).toBeVisible()
}

test('device previews use the actual device width and preserve click selection while scaled', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page, 'root@example.test')
  await openSeededPage(page)
  const heading = (await canvas(page).locator('[data-cms-slot="heading"]').first().innerText()).trim()
  expect(heading).not.toBe('')
  for (const [name, width] of [
    ['Desktop', 1280],
    ['Tablet', 768],
    ['Phone', 390],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect
      .poll(() =>
        canvas(page)
          .locator('html')
          .evaluate(node => node.clientWidth),
      )
      .toBe(width)
    if (width < 768) await canvas(page).locator('.cms-phone-menu summary').click()
    const menu = canvas(page).locator(width >= 768 ? '.cms-desktop-nav .cms-nav-list' : '.cms-phone-menu .cms-nav-list')
    await expect(menu).toBeVisible()
    await expect(menu).toHaveCSS('flex-direction', width >= 768 ? 'row' : 'column')
    await canvas(page).locator('[data-cms-slot="heading"]').first().click()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(heading)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
