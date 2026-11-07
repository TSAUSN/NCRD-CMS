import { test, expect } from '@playwright/test'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'

for (const width of [1440, 1024]) {
  test(`story workspace previews remain readable at ${width}`, async ({ page }, info) => {
    const f = await sawsoFixture(true, true)
    try {
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page, 'root@example.test')
      for (const [view, title, field] of [
        ['world', 'World View draft preview', 'Heading above the map'],
        ['split', 'Split View draft preview', 'Heading'],
      ]) {
        await page.goto(`/sites/${f.siteId}/stories?view=${view}`)
        const frame = page.locator(`iframe[title="${title}"]`)
        await expect(page.frameLocator(`iframe[title="${title}"]`).locator('[data-cms-stories-widget]')).toBeVisible()
        const preview = (await frame.boundingBox())!
        const settings = (await page.getByLabel(field!, { exact: true }).boundingBox())!
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        if (width === 1024) {
          expect(preview.width).toBeGreaterThan(600)
          expect(preview.y).toBeGreaterThan(settings.y + settings.height)
        } else {
          expect(preview.x).toBeGreaterThan(settings.x + settings.width)
        }
        await page.screenshot({ path: info.outputPath(`${view}-${width}.png`) })
      }
    } finally {
      await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
      f.client.release()
      await f.pool.end()
    }
  })
}
