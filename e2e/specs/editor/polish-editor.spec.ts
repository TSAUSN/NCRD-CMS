import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, canvas } from '../helpers.ts'

test.use({ actionTimeout: 15000 })
test('editor chrome matches the reference controls, leaves resting fields quiet and reserves tools outside page content', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/polish-editor/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const home = (
        await f.pool.query(
          "SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=$1 AND slug=''",
          [f.siteId],
        )
      ).rows[0]!,
      before = structuredClone(home)
    await signIn(page, 'root@example.test')
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true }),
      rail = page.getByRole('complementary', { name: 'Page structure', exact: true }),
      bar = page.locator('header.editor-bar'),
      capture = async (name: string, width: number) => {
        await page.evaluate(() => document.fonts.ready)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/pages/' + home.id)
      await expect(canvas(page).getByRole('heading', { name: 'What We Do', exact: true })).toBeVisible()
      await canvas(page)
        .locator('body')
        .evaluate(() => document.fonts.ready)
      if (width === 1024) {
        await expect(rail).toBeHidden()
        await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
      }
      await expect(rail.getByRole('button', { name: 'Hero slider', exact: true })).toBeVisible()
      expect(
        (await rail.getByRole('heading', { name: 'Page structure', exact: true }).boundingBox())!.height,
      ).toBeLessThan(25)
      await expect(inspector.getByRole('button', { name: 'Open section: Hero slider', exact: true })).toBeVisible()
      if (width === 1024) {
        await page.getByRole('button', { name: 'Close Structure', exact: true }).click()
        await expect(rail).toBeHidden()
        expect((await page.locator('.canvas-viewport').boundingBox())!.width).toBeGreaterThan(550)
        expect(
          parseInt(
            (await page.getByRole('button', { name: 'Zoom to actual size', exact: true }).innerText()).replace('%', ''),
          ),
        ).toBeGreaterThanOrEqual(40)
      }
      const controls = [
        bar.getByRole('link', { name: 'Back', exact: true }),
        bar.getByRole('link', { name: 'Page history', exact: true }),
        bar.getByRole('button', { name: 'Preview', exact: true }),
        ...['Save draft', 'Schedule', 'Publish'].map(name => bar.getByRole('button', { name, exact: true })),
      ]
      for (const control of controls) expect((await control.boundingBox())!.height).toBe(32)
      expect(
        await bar
          .getByRole('button', { name: 'Preview', exact: true })
          .evaluate(node => getComputedStyle(node).backgroundColor),
      ).toBe(
        await bar
          .getByRole('link', { name: 'Page history', exact: true })
          .evaluate(node => getComputedStyle(node).backgroundColor),
      )
      const add = await inspector.getByRole('button', { name: 'Add a section', exact: true }).boundingBox(),
        outline = await inspector.getByRole('list', { name: 'Page outline', exact: true }).boundingBox()
      expect(Math.abs(add!.x - outline!.x)).toBeLessThan(1)
      expect(Math.abs(add!.width - outline!.width)).toBeLessThan(1)
      const checks = inspector.locator('summary').filter({ hasText: 'Page checks' })
      expect(await checks.evaluate(node => getComputedStyle(node).listStyleType)).toBe('none')
      expect(
        await inspector
          .getByRole('link', { name: 'Header & menu', exact: true })
          .evaluate(node => getComputedStyle(node).textDecorationLine),
      ).toBe('none')
      const field = canvas(page).locator('[data-cms-section="1"] [data-cms-slot="heading"]').first()
      await page.mouse.move(1, 1)
      await expect.poll(() => field.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('none')
      await expect
        .poll(() =>
          canvas(page)
            .locator('[data-cms-frame="header"]')
            .evaluate(node => getComputedStyle(node).outlineStyle),
        )
        .toBe('none')
      const zoom = await page.getByRole('group', { name: 'Canvas zoom', exact: true }).boundingBox(),
        viewport = await page.locator('.canvas-viewport').boundingBox()
      expect(zoom!.y).toBeGreaterThanOrEqual(viewport!.y + viewport!.height)
      await capture('page', width)
      await field.hover()
      await expect.poll(() => field.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid')
      await page.mouse.move(1, 1)
      await inspector.getByRole('button', { name: 'Open section: What We Do', exact: true }).click()
      await expect(inspector.getByRole('button', { name: 'Add a card', exact: true })).toBeVisible()
      const selectedViewport = await page.locator('.canvas-viewport').boundingBox()
      expect(Math.abs(selectedViewport!.y - viewport!.y)).toBeLessThan(1)
      await capture('section', width)
      if (width === 1024) await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
      await rail.getByRole('button', { name: 'Page structure options', exact: true }).click()
      await expect(rail.getByRole('button', { name: 'Changed only', exact: true })).toBeVisible()
      await expect(rail.getByRole('button', { name: 'Collapse all', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await rail.getByRole('button', { name: 'Actions for What We Do', exact: true }).click()
      await expect(rail.getByRole('button', { name: 'Hide What We Do', exact: true })).toBeVisible()
      await expect(rail.getByRole('button', { name: 'Move What We Do up', exact: true })).toBeVisible()
      await capture('structure-menu', width)
      await page.keyboard.press('Escape')
      if (width === 1024) await page.getByRole('button', { name: 'Close Structure', exact: true }).click()
      await inspector.getByRole('button', { name: 'Done', exact: true }).click()
      await inspector.getByRole('button', { name: 'Open section: Hero slider', exact: true }).click()
      await expect(inspector.getByRole('switch', { name: 'Show slide 1', exact: true })).toBeVisible()
      await expect(inspector.getByRole('button', { name: 'Add section below', exact: true })).toHaveAttribute(
        'data-variant',
        'secondary',
      )
      await expect(inspector.locator('button[data-variant=primary]')).toHaveCount(1)
      await capture('hero', width)
      await page.getByRole('button', { name: 'Phone', exact: true }).click()
      await expect(page.locator('iframe[title="Page canvas"]')).toHaveCSS('width', '390px')
      await capture('phone', width)
      await page.getByRole('button', { name: 'More page actions', exact: true }).click()
      await page.getByRole('button', { name: 'Page settings', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Page settings', exact: true }),
        sharing = settings.locator('summary').filter({ hasText: 'Search visibility & sharing' })
      await expect(sharing.locator('svg')).toHaveCount(1)
      expect(
        await sharing.evaluate(node => ({
          display: getComputedStyle(node).display,
          list: getComputedStyle(node).listStyleType,
          before: getComputedStyle(node, '::before').content,
          marker: getComputedStyle(node, '::marker').content,
        })),
      ).toEqual({ display: 'flex', list: 'none', before: 'none', marker: '\"\"' })
      await sharing.click()
      await expect(settings.getByLabel('Ask search engines not to index this page', { exact: true })).toBeVisible()
      await capture('page-settings-disclosure', width)
      await settings.getByRole('button', { name: 'Close Page settings', exact: true }).click()
    }
    expect(
      (await f.pool.query('SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE id=$1', [home.id]))
        .rows[0],
    ).toEqual(before)
  } finally {
    f.client.release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    await f.pool.end()
  }
})
