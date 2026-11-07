import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, canvas } from '../helpers.ts'

test('native editor keeps one clear decision bar and fits the real canvas beside both desktop panels', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/editor-scaffold/' + info.project.name)
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
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/pages/' + home.id)
      const bar = page.locator('header.editor-bar'),
        rail = page.getByRole('complementary', { name: 'Page structure', exact: true }),
        inspector = page.getByRole('complementary', { name: 'Inspector', exact: true }),
        frame = page.locator('iframe[title="Page canvas"]')
      await expect(canvas(page).getByRole('heading', { name: 'What We Do', exact: true })).toBeVisible()
      if (width === 1440) await expect(rail).toBeVisible()
      else {
        await expect(rail).toBeHidden()
        await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
        await expect(rail).toBeVisible()
        await page.getByRole('button', { name: 'Close Structure', exact: true }).click()
        await expect(rail).toBeHidden()
        expect((await frame.boundingBox())!.width).toBeGreaterThanOrEqual(480)
      }
      await expect(inspector).toBeVisible()
      await expect(page.getByRole('tablist', { name: 'Editor panes', exact: true })).toBeHidden()
      await expect(bar.getByRole('button', { name: 'Desktop', exact: true })).toHaveCount(0)
      await expect(bar.getByRole('link', { name: 'All sites', exact: true })).toHaveCount(0)
      const controls = await Promise.all(
        ['Save draft', 'Schedule', 'Publish'].map(name => bar.getByRole('button', { name, exact: true }).boundingBox()),
      )
      for (const box of controls) expect(Math.abs(box!.y - controls[0]!.y)).toBeLessThan(2)
      expect(controls[0]!.x).toBeLessThan(controls[1]!.x)
      expect(controls[1]!.x).toBeLessThan(controls[2]!.x)
      const back = await bar.getByRole('link', { name: 'Back', exact: true }).boundingBox()
      expect(Math.abs(back!.y + back!.height / 2 - controls[0]!.y - controls[0]!.height / 2)).toBeLessThan(3)
      await expect(inspector.getByRole('list', { name: 'Page outline', exact: true }).getByRole('button')).toHaveCount(
        9,
      )
      await page.screenshot({ path: resolve(folder, 'page-' + width + '.png'), animations: 'disabled' })
      await inspector.getByRole('button', { name: 'Open section: What We Do', exact: true }).click()
      await expect(inspector.getByRole('button', { name: 'Add a card', exact: true })).toBeVisible()
      await expect(canvas(page).locator('.national-tiles').first().locator(':scope>article')).toHaveCount(5)
      await page.screenshot({ path: resolve(folder, 'section-' + width + '.png'), animations: 'disabled' })
      await page.getByRole('button', { name: 'Phone', exact: true }).click()
      await expect(frame).toHaveCSS('width', '390px')
      await expect(canvas(page).getByRole('heading', { name: 'What We Do', exact: true })).toBeVisible()
      await page.screenshot({ path: resolve(folder, 'phone-' + width + '.png'), animations: 'disabled' })
      await page.getByRole('button', { name: 'Desktop', exact: true }).click()
      await expect(frame).toHaveCSS('width', '1280px')
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await bar.getByRole('button', { name: 'More page actions', exact: true }).click()
      await expect(bar.getByRole('link', { name: 'All sites', exact: true })).toHaveAttribute('href', '/sites')
      await page.keyboard.press('Escape')
    }
    expect(
      (await f.pool.query('SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE id=$1', [home.id]))
        .rows[0],
    ).toEqual(before)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
