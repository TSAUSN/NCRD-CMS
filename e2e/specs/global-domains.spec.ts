import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { signIn } from './helpers.ts'
test('global Domains reads existing addresses for a Super Admin and grants no editor access', async ({
  page,
  browser,
}) => {
  await signIn(page, 'root@example.test')
  await page.getByRole('link', { name: 'Domains', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Domains', exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Domains', exact: true })).toContainText('demo.staging.localhost')
  await expect(page.getByRole('button', { name: 'Connect a domain', exact: true })).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: 'demo.staging.localhost' })).toContainText('Local preview')
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    if (width === 390) {
      await expect(page.getByText('Scroll sideways to see all address details.', { exact: true })).toBeVisible()
      expect(
        await page
          .getByRole('row')
          .filter({ hasText: 'demo.staging.localhost' })
          .locator('code')
          .evaluate(node => node.getBoundingClientRect().height),
      ).toBeLessThan(30)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.screenshot({ path: `../.r8-progress/polish-domains-${width}.png` })
  }
  const context = await browser.newContext()
  try {
    const editor = await context.newPage()
    await signIn(editor, 'editor@example.test')
    await expect(editor.getByRole('link', { name: 'Domains', exact: true })).toHaveCount(0)
    const response = await editor.goto(`http://127.0.0.1:${E2E_PORTS.admin}/domains`)
    expect(response?.status()).toBe(404)
  } finally {
    await context.close()
  }
})
