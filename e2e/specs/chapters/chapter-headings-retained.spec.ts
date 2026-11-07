import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ECHELON_CHAPTER_SOURCES } from '../../../packages/seeds/src/echelon-chapters-source.ts'
// Explicit, read-only retained-demo check. No reset, fixture or data writes in this journey.
test('two published chapters use their exact source names inside the shared hero', async ({ browser }, info) => {
  test.skip(process.env.CMS_CHECK_RETAINED_ECHELON !== '1', 'Run explicitly against the retained local demo.')
  const context = await browser.newContext({ javaScriptEnabled: false }),
    page = await context.newPage(),
    folder = resolve('../.r8-progress/round3/chapter-headings/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    for (const slug of ['peoria', 'boston']) {
      const source = ECHELON_CHAPTER_SOURCES.find(row => row.slug === slug)!
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto('http://echelon-chapters.staging.localhost:3001/chapters/' + slug)
        await page.evaluate(() => document.fonts.ready)
        await expect(page.locator('h1')).toHaveText(source.name)
        await expect(page.getByRole('heading', { name: 'Echelon · Our chapter', exact: true })).toHaveCount(0)
        expect(await page.locator('img[src*="/cms-samples/"]').count()).toBe(0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page
          .locator('.cms-section--core-echelon-hero')
          .screenshot({ path: resolve(folder, slug + '-' + width + '.png') })
      }
    }
  } finally {
    await context.close()
  }
})
