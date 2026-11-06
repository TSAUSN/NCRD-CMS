import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { nationalNavigationScriptHash } from '@cms/renderer'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('national public pages and the shared story template work through plain links without JavaScript', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true)
  try {
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/publishing')
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check({ timeout: 60000 })
    const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
    if (await reason.isVisible()) await reason.fill('Reviewing approved public layouts in an isolated sample fixture.')
    await publish.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    const context = await browser.newContext({ javaScriptEnabled: false }),
      remote: string[] = []
    try {
      const view = await context.newPage(),
        origin = 'http://' + f.hostname + `:${E2E_PORTS.site}`,
        folder = resolve('../.r8-progress/sawso/public')
      await mkdir(folder, { recursive: true })
      view.on('request', r => {
        const host = new URL(r.url()).hostname
        if (!['localhost', '127.0.0.1'].includes(host) && !host.endsWith('.localhost')) remote.push(host)
      })
      for (const width of [1440, 390]) {
        await view.setViewportSize({ width, height: 900 })
        await view.goto(origin + '/')
        await expect(view.locator('.national-slider')).toBeVisible()
        await expect(view.locator('.national-photo-tile')).toHaveCount(8)
        await expect(view.getByRole('heading', { level: 1 })).toHaveCount(1)
        const impact = view.locator('.national-tiles').first()
        await expect(impact.locator('.national-tile')).toHaveCount(5)
        const photo = await view
          .locator('.core-newsroom-panel[data-view=home] .core-story-photo img')
          .first()
          .boundingBox()
        expect(photo!.width / photo!.height).toBeCloseTo(2, 1)
        const boxes = await impact
          .locator('.national-tile')
          .evaluateAll(es => es.map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })))
        expect(boxes[0]!.y).toBe(boxes[1]!.y)
        if (width === 390) expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y)
        expect((await view.locator('header').boundingBox())!.height).toBeLessThan(width === 1440 ? 110 : 90)
        if (width === 1440) {
          await expect(view.getByRole('navigation', { name: 'Main', exact: true })).toBeHidden()
          await view.locator('.national-phone-menu>summary').click()
          const menu = view.getByRole('navigation', { name: 'Phone menu', exact: true })
          await menu.getByRole('link', { name: 'Ways We Help', exact: true }).focus()
          await expect(menu.getByRole('link', { name: 'Health', exact: true })).toBeVisible()
          await view.locator('.national-phone-menu>summary').click()
        }
        await view.locator('.cms-hero-slide').nth(0).getByRole('link', { name: 'Next slide', exact: true }).click()
        await expect(view.locator('.cms-hero-slide').nth(1)).toBeInViewport()
        await expect(view.locator('.cms-hero-slide').nth(1).locator('h2')).toHaveText('Nepal Needs Our Prayers Now.')
        if (width === 390) {
          await view.locator('.cms-hero-slide').nth(1).getByRole('link', { name: 'Next slide', exact: true }).click()
          await expect(view.locator('.cms-hero-slide').nth(2)).toBeInViewport()
          await expect(
            view.locator('.cms-hero-slide').nth(2).getByRole('link', { name: 'Read More', exact: true }),
          ).toHaveCSS('background-color', 'rgb(239, 62, 66)')
          await expect(
            view.locator('.cms-hero-slide').nth(2).getByRole('link', { name: 'Donate', exact: true }),
          ).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        }
        await view.screenshot({ path: resolve(folder, 'home-' + width + '.png'), fullPage: true })
        await view.goto(origin + '/ways-we-help/health')
        await expect(view.locator('.core-story-card:visible')).toHaveCount(6)
        await expect(view.getByRole('heading', { level: 1 })).toHaveText('Health')
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.screenshot({ path: resolve(folder, 'health-' + width + '.png'), fullPage: true })
      }
      await view.goto(origin + '/ways-we-help')
      await expect(view.locator('.national-photo-tile')).toHaveCount(8)
      await expect(view.getByRole('heading', { level: 1 })).toHaveText('Ways We Help')
      await view.goto(origin + '/newsroom')
      await expect(view.locator('.core-story-card')).toHaveCount(12)
      await view.getByRole('link', { name: 'By Project Sector', exact: true }).click()
      await view.locator('.core-split-sector').filter({ hasText: 'Education' }).click()
      await expect(view).toHaveURL(/story0_sector=education/)
      await expect(view.locator('.core-story-card')).toHaveCount(7)
      await view.getByRole('searchbox', { name: 'Site search' }).fill('Primary Health Care')
      await view.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(view).toHaveURL(/q=Primary/)
      await expect(view.locator('.core-story-card')).toHaveCount(1)
      await view.goto(origin + '/stories/life-in-ukraine-years-into-war')
      await expect(view.getByRole('heading', { level: 1 })).toHaveText('Life in Ukraine, Years into War')
      await expect(view.locator('.core-story-meta')).toContainText('May 29, 2026')
      await expect(view.locator('.core-story-text')).toContainText('[Story text — sample content.')
      await expect(view.locator('.core-story-chips').getByRole('link')).toHaveAttribute(
        'href',
        '/ways-we-help/disaster-relief-recovery',
      )
      await view.goto(origin + '/sawso/story/life-in-ukraine-years-into-war')
      await expect(view).toHaveURL(origin + '/stories/life-in-ukraine-years-into-war')
      await expect(view.getByRole('heading', { level: 1 })).toHaveText('Life in Ukraine, Years into War')
      await view.locator('.national-phone-menu summary').click()
      await expect(view.getByRole('navigation', { name: 'Phone menu' })).toBeVisible()
      const integrity = nationalNavigationScriptHash(),
        file = 'navigation.' + integrity.slice(7).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') + '.js'
      await expect(view.locator('script')).toHaveCount(1)
      await expect(view.locator('script')).toHaveAttribute('src', '/__cms/runtime/' + file)
      await expect(view.locator('script')).toHaveAttribute('integrity', integrity)
      expect(remote).toEqual([])
    } finally {
      await context.close()
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
