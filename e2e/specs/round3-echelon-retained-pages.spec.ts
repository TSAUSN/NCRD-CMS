import { ECHELON_CHAPTER_SOURCES } from '../../packages/seeds/src/echelon-chapters-source.ts'
import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Opt-in, read-only inspection of the retained local demo. No fixture, reset or data writes.
test('retained Echelon national and chapter pages use imported photos and the approved section map', async ({
  browser,
}, testInfo) => {
  test.skip(
    process.env.CMS_CHECK_RETAINED_ECHELON !== '1',
    'The retained demo is checked explicitly, separately from isolated fixtures.',
  )
  test.setTimeout(60000)
  const folder = resolve('../.r8-progress/round3/echelon-national/actual-pages', testInfo.project.name)
  await mkdir(folder, { recursive: true })
  const context = await browser.newContext({ javaScriptEnabled: false }),
    view = await context.newPage()
  try {
    for (const [part, path] of [
      ['national', '/'],
      ['chapter', '/chapters/peoria'],
    ] as const) {
      for (const width of [1440, 390]) {
        await view.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
        await view.goto('http://echelon-chapters.staging.localhost:3001' + path)
        await view.evaluate(() => document.fonts.ready)
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect(await view.locator('img[src*="/cms-samples/"]').count()).toBe(0)
        expect(await view.locator('img[src^="/media/"]').count()).toBeGreaterThanOrEqual(5)
        expect(
          await view
            .locator('img')
            .evaluateAll(images =>
              images.every(
                image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        ).toBe(true)
        expect(await view.locator('h1').evaluate(node => getComputedStyle(node).fontFamily)).not.toMatch(/Trajan/i)
        expect(
          await view.evaluate(() =>
            Array.from(document.fonts).some(font => font.family.includes('Creato Display') && font.status === 'loaded'),
          ),
        ).toBe(true)
        const main = view.locator('main')
        if (part === 'national') {
          await expect(main.getByRole('heading', { name: 'Stories from our community', exact: true })).toBeVisible()
          await expect(main.getByRole('heading', { name: 'What’s coming up', exact: true })).toHaveCount(0)
          await expect(view.getByRole('navigation', { name: 'Echelon social media' }).getByRole('link')).toHaveCount(3)
          await expect(view.getByRole('searchbox', { name: 'Find a chapter by name' })).toBeVisible()
        } else {
          await expect(main.getByRole('heading', { name: 'Stories from our community', exact: true })).toHaveCount(0)
          await expect(main.getByText('Sample events', { exact: true })).toBeVisible()
          await expect(main.getByText('[Membership chair name]', { exact: true })).toBeVisible()
          const source = await readFile(resolve(import.meta.dirname, '../reference/echelon-chapter-text.txt'), 'utf8'),
            copy = (await main.innerText()).replace(/\s+/g, ' ')
          for (const line of source
            .replace('Echelon · Our chapter', ECHELON_CHAPTER_SOURCES.find(row => row.slug === 'peoria')!.name)
            .split(/\n/)
            .map(text => text.replace(/\s+/g, ' ').trim())
            .filter(text => text.length > 1))
            expect(copy).toContain(line)
        }
        await view.screenshot({ path: resolve(folder, part + '-' + width + '.png'), fullPage: true })
        if (width === 390) {
          await view.getByText('Menu', { exact: true }).click()
          await expect(view.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
        }
      }
    }
  } finally {
    await context.close()
  }
})
