import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
test('retained Data values keeps the real desktop sidebar and shows private numbers and empty states', async ({
  page,
}, info) => {
  test.skip(process.env.CMS_CHECK_RETAINED_DATA_VALUES !== '1', 'Explicit read-only retained-demo check.')
  const folder = resolve('../.r8-progress/round3/data-values/actual-pages/' + info.project.name),
    base = 'http://localhost:3000',
    sawso = '95976d54-9dfc-41d3-83e1-93f1d070a76f',
    echelon = '616d295e-c28a-45ea-9786-bd2f55a21679'
  await mkdir(folder, { recursive: true })
  await page.goto(base + '/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill('admin@example.test')
  await page.getByRole('button', { name: 'Continue to local CMS', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(base + '/sites/' + sawso + '/data')
    await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
    const sidebar = await page.getByRole('complementary', { name: 'CMS navigation', exact: true }).boundingBox()
    expect(sidebar!.width).toBeGreaterThan(200)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, 'retained-list-' + width + '.png'), fullPage: true })
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(page.getByLabel('Value', { exact: true })).toHaveValue('152')
    await page.screenshot({ path: resolve(folder, 'retained-edit-' + width + '.png'), fullPage: true })
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.goto(base + '/sites/' + echelon + '/data')
    await expect(page.getByRole('heading', { name: 'No numbers yet', exact: true })).toBeVisible()
    await page.screenshot({ path: resolve(folder, 'retained-empty-' + width + '.png'), fullPage: true })
  }
})
