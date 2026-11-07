import { test, expect } from '@playwright/test'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { echelonFixture } from '../fixtures/echelon.ts'
import { signIn } from '../helpers.ts'

for (const width of [1440, 1024]) {
  test(`chapter page identity and actions do not overlap while preparing a review at ${width}`, async ({ page }) => {
    const f = await echelonFixture(true)
    let resume!: () => void
    const pending = new Promise<void>(resolve => {
      resume = resolve
    })
    try {
      const chapter = f.pages.find(row => row.slug === 'chapters/atlanta')!
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page, 'root@example.test')
      await page.goto('/pages/' + chapter.id)
      const bar = page.locator('header.editor-bar')
      await expect(bar.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()
      await page.route('**/pages/' + chapter.id, async route => {
        if (route.request().method() === 'POST') await pending
        await route.continue()
      })
      await bar.getByRole('button', { name: 'Publish', exact: true }).click()
      await expect(bar.getByRole('button', { name: 'Preparing review…', exact: true })).toBeVisible()
      const identity = await bar.locator('.editor-title').boundingBox()
      const controls = await bar.locator('.bar-tools').boundingBox()
      expect(identity!.x + identity!.width).toBeLessThan(controls!.x)
      const pill = await bar.locator('.editor-title > span').boundingBox()
      expect(pill!.x + pill!.width).toBeLessThan(controls!.x)
      expect(controls!.x + controls!.width).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `../.r8-progress/pending-review-${width}.png` })
    } finally {
      resume()
      await page.unrouteAll({ behavior: 'wait' })
      f.client.release()
      await f.pool.end()
    }
  })
}

for (const width of [1440, 1024]) {
  test(`all hero slide actions fit the available screen at ${width}`, async ({ page }) => {
    const f = await sawsoFixture(true, true)
    try {
      const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page, 'root@example.test')
      await page.goto('/pages/' + home.id)
      const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
      await inspector.getByRole('button', { name: 'Open section: Hero slider', exact: true }).click()
      await inspector.getByRole('button', { name: 'Slide 3 actions', exact: true }).click()
      await inspector.getByRole('button', { name: 'Remove slide 3', exact: true }).click()
      await inspector.getByRole('checkbox', { name: 'Change slides automatically', exact: true }).uncheck()
      await inspector.getByRole('button', { name: 'Slide 1 actions', exact: true }).click()
      const remove = inspector.getByRole('button', { name: 'Remove slide 1', exact: true })
      await expect(remove).toBeVisible()
      expect(
        await remove.evaluate(node => {
          const item = node.getBoundingClientRect(),
            menu = node.parentElement!.getBoundingClientRect()
          return (
            item.top >= menu.top && item.bottom <= menu.bottom && item.left >= menu.left && item.right <= menu.right
          )
        }),
      ).toBe(true)
      await page.screenshot({ path: `../.r8-progress/hero-actions-${width}.png` })
      await page.keyboard.press('Escape')
      await expect(inspector.getByRole('button', { name: 'Slide 1 actions', exact: true })).toBeFocused()
    } finally {
      f.client.release()
      await f.pool.end()
    }
  })
}
