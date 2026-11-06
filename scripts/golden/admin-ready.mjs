import { createRequire } from 'node:module'
import { join } from 'node:path'
import { root } from './local.mjs'
const { expect } = createRequire(join(root, 'e2e/package.json'))('@playwright/test')
/** Wait for the actual screen/content, including delayed iframe requests.
 * Network silence and a visible outer heading do not establish preview readiness. */
export async function adminReady(page, row) {
  if (/^\/pages\/[a-f0-9-]+$/.test(row.path)) {
    await expect(page.locator('.editor')).toBeVisible()
    await expect(page.locator('iframe[title="Page canvas"]')).toBeVisible()
    await expect(page.frameLocator('iframe[title="Page canvas"]').locator('#cms-main')).toBeVisible()
  } else await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(/^Loading[^\n]*$/)).toHaveCount(0, { timeout: 15000 })
  await expect(page.getByText(/^Updating site preview…$/)).toHaveCount(0, { timeout: 15000 })
  await expect(page.getByText(/^Opening[^\n]*preview…$/)).toHaveCount(0, { timeout: 15000 })
  if (row.pattern === '/sites/[siteId]/design')
    await expect(page.frameLocator('iframe[title="Site look page preview"]').locator('#cms-main')).toBeVisible()
  if (['stories?view=world', 'stories?view=split'].includes(row.pattern)) {
    const title = row.pattern.endsWith('world') ? 'World View draft preview' : 'Split View draft preview'
    await expect(page.frameLocator(`iframe[title="${title}"]`).locator('[data-cms-stories-widget]')).toBeVisible()
  }
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15000 })
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      const element = await frame.frameElement(),
        box = await element.boundingBox()
      if (!box || box.y >= page.viewportSize().height || box.y + box.height <= 0) continue
    }
    await Promise.race([
      frame.evaluate(async () => {
        await document.fonts.ready
        const images = Array.from(document.images).filter(img => {
          const r = img.getBoundingClientRect()
          return (
            r.width > 0 &&
            r.height > 0 &&
            r.top < Math.min(innerHeight, 1000) &&
            r.bottom > 0 &&
            (img.loading !== 'lazy' || img.complete)
          )
        })
        await Promise.all(images.map(img => img.decode()))
      }),
      new Promise((_, reject) => setTimeout(() => reject(Error('Visible preview fonts/images did not finish.')), 5000)),
    ])
  }
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
}
