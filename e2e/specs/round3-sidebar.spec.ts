import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
test('site-first navigation groups administration, preserves advanced access and guarded switching, and hides native site-wide controls from content roles', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/sidebar/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/pages')
    const sidebar = page.getByRole('complementary', { name: 'CMS navigation', exact: true }),
      nav = page.getByRole('navigation', { name: 'Sections of the CMS', exact: true }),
      switcher = sidebar.getByRole('button', { name: 'Switch site · Shared site look', exact: true }),
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 950 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      }
    await expect(nav.getByRole('heading', { name: 'Site-wide', exact: true })).toBeVisible()
    await expect(nav.getByRole('heading', { name: 'Publishing', exact: true })).toBeVisible()
    await expect(nav.getByRole('heading', { name: 'Workspace', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Pages', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: 'Sections', exact: true })).toHaveCount(0)
    const boxes = await Promise.all([
      switcher.boundingBox(),
      sidebar.getByRole('button', { name: 'Search or jump to… ⌘K', exact: true }).boundingBox(),
      nav.getByRole('link', { name: 'Overview', exact: true }).boundingBox(),
    ])
    expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y)
    expect(boxes[1]!.y + boxes[1]!.height).toBeLessThanOrEqual(boxes[2]!.y)
    await capture('site-admin-pages')
    await nav.locator('summary').filter({ hasText: 'Advanced' }).click()
    await expect(nav.getByRole('link', { name: 'Sections', exact: true })).toBeVisible()
    await nav.getByRole('link', { name: 'Sections', exact: true }).click()
    await expect(page).toHaveURL('/sites/' + f.site + '/sections')
    await page.reload()
    await expect(nav.getByRole('link', { name: 'Sections', exact: true })).toBeVisible()
    await nav.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByLabel('Contact phone', { exact: true }).fill('[Unsaved phone]')
    await switcher.click()
    const popup = switcher.locator('..')
    await expect(popup.getByRole('link', { name: 'All sites', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(switcher).toBeFocused()
    await switcher.click()
    await popup.getByRole('link', { name: 'All sites', exact: true }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Contact phone', { exact: true })).toHaveValue('[Unsaved phone]')
    await switcher.click()
    await popup.getByRole('link', { name: 'All sites', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/sites')
    for (const email of ['editor@example.test', 'contributor@example.test']) {
      const context = await browser.newContext()
      try {
        const other = await context.newPage()
        await signIn(other, email)
        await other.goto('/sites/' + f.site + '/pages')
        const menu = other.getByRole('navigation', { name: 'Sections of the CMS', exact: true })
        for (const name of ['Site look', 'Settings', 'Header & menu', 'Footer', 'Sections', 'Template'])
          await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0)
        await expect(menu.locator('summary').filter({ hasText: 'Advanced' })).toHaveCount(0)
        await expect(menu.getByRole('link', { name: 'Pages', exact: true })).toBeVisible()
        for (const width of [1440, 1024]) {
          await other.setViewportSize({ width, height: 950 })
          expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await other.screenshot({ path: resolve(folder, email.split('@')[0] + '-pages-' + width + '.png') })
        }
      } finally {
        await context.close()
      }
    }
    await page.route('**/api/sites', route =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
    )
    await page.goto('/sites/' + f.site + '/pages')
    await switcher.click()
    await expect(sidebar.getByRole('status')).toContainText('Couldn’t load sites. Open All sites to try again.')
    await capture('site-switcher-error')
    await popup.getByRole('link', { name: 'All sites', exact: true }).click()
    await expect(page).toHaveURL('/sites')
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
