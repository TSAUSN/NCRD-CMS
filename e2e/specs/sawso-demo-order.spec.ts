import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('SAWSO leads Home and the site switcher without hiding other visible sites', async ({ page }) => {
  const f = await sawsoFixture(),
    originalSlug = (await f.client.query('SELECT slug FROM sites WHERE id=$1', [f.siteId])).rows[0]!.slug
  try {
    await f.client.query("UPDATE sites SET slug='sawso' WHERE id=$1", [f.siteId])
    await signIn(page, 'root@example.test')
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Home', exact: true, level: 1 })).toBeVisible()
    await page.getByText('More tasks', { exact: true }).click()
    const tasks = page.locator('section[aria-labelledby="home-tasks"]')
    await expect(tasks.getByRole('link').first()).toContainText('SAWSO')
    await expect(
      page
        .getByRole('region', { name: 'Needs you', exact: true })
        .locator('[data-attention-site="' + f.siteId + '"]')
        .filter({ hasText: /changes? (is|are) not live/ }),
    ).toBeVisible()
    const card = page.locator('article.site-card').filter({ has: page.locator('a[href="/sites/' + f.siteId + '"]') })
    // This fixture has no saved home-page picture; Home explains that immediately.
    await card.getByText('No home-page preview', { exact: true }).scrollIntoViewIfNeeded()
    await expect(card.getByText('No home-page preview', { exact: true })).toBeVisible()
    await expect(card.locator('iframe')).toHaveCount(0)
    await expect(card.getByText('Loading saved preview…', { exact: true })).toHaveCount(0)
    const folder = resolve('../.r8-progress/sawso/demo')
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page
        .getByRole('heading', { name: 'Home', level: 1, exact: true })
        .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
      await page.screenshot({ path: resolve(folder, 'home-' + width + '.png') })
    }
    await page.goto('/sites/' + f.siteId)
    await page.getByRole('button', { name: 'Switch site · SAWSO', exact: true }).click()
    const menu = page
      .locator('details')
      .filter({ has: page.getByRole('button', { name: 'Switch site · SAWSO', exact: true }) })
    await expect(menu.getByRole('link').nth(1)).toHaveText('SAWSO')
    await expect(menu.getByRole('link', { name: 'Demo site', exact: true })).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: resolve(folder, 'switcher-1440.png') })
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now(),slug=$2 WHERE id=$1', [f.siteId, originalSlug])
    f.client.release()
    await f.pool.end()
  }
})
