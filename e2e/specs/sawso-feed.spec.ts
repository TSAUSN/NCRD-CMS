import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn, canvas } from './helpers.ts'
test('Health shows its published six stories and its shared archive link at every width without JavaScript', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true)
  try {
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/publishing')
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check({ timeout: 60000 })
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    const context = await browser.newContext({ javaScriptEnabled: false }),
      remote: string[] = []
    try {
      const view = await context.newPage()
      view.on('request', r => {
        const h = new URL(r.url()).hostname
        if (!['127.0.0.1', 'localhost'].includes(h) && !h.endsWith('.localhost')) remote.push(r.url())
      })
      const folder = resolve('../.r8-progress/sawso/feed')
      await mkdir(folder, { recursive: true })
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 900 })
        await view.goto('http://' + f.hostname + `:${E2E_PORTS.site}/ways-we-help/health`)
        await expect(view.getByRole('heading', { name: 'Community health programs', exact: true })).toBeVisible()
        await expect(view.locator('.core-story-card')).toHaveCount(6)
        await expect(view.locator('.core-story-card:visible')).toHaveCount(6)
        const archive = view.locator('.core-story-desktop-link a,.core-story-more a')
        await expect(archive).toHaveCount(2)
        for (const link of await archive.all()) {
          await expect(link).toHaveText('Visit our newsroom')
          await expect(link).toHaveAttribute('href', '/newsroom?sector=health')
        }
        await expect(archive.locator('visible=true').first()).toBeVisible()
        const surface = view.locator('.core-stories>.container')
        await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        const panel = await surface.boundingBox()
        for (const link of await archive.locator('visible=true').all()) {
          const box = await link.boundingBox()
          expect(box!.x).toBeGreaterThanOrEqual(panel!.x)
          expect(box!.y).toBeGreaterThanOrEqual(panel!.y)
          expect(box!.y + box!.height).toBeLessThanOrEqual(panel!.y + panel!.height)
        }
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'health-' + width + '.png'), fullPage: true })
      }
      expect(await view.locator('script').count()).toBe(0)
      expect(remote).toEqual([])
    } finally {
      await context.close()
    }
    const health = (
      await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug='ways-we-help/health'", [f.siteId])
    ).rows[0]!.id
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/pages/' + health)
    await canvas(page).locator('.core-stories h2').click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector.getByLabel('Title', { exact: true })).toHaveValue('Stories about health')
    await inspector.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(
      inspector
        .getByRole('group', { name: 'Project Sectors', exact: true })
        .getByRole('button', { name: 'Health', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(inspector.getByLabel('Maximum stories')).toHaveValue('6')
    await page.screenshot({ path: resolve('../.r8-progress/sawso/feed/editor-1440.png'), fullPage: false })
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
