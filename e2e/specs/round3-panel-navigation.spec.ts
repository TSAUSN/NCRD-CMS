import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn, canvas } from './helpers.ts'
test('section and card controls share one fixed header, nested Escape cancels one new card, and the icon picker has Cancel', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/panel-navigation/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!.id
    await signIn(page, 'root@example.test')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/pages/' + home + '?section=1')
      const inspector = page.getByRole('complementary', { name: 'Inspector' }),
        navigation = inspector.locator('[data-editor-panel-navigation]'),
        cards = canvas(page).locator('.national-tiles').first().locator(':scope > article')
      await expect(cards).toHaveCount(5)
      await expect(navigation.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
      await expect(inspector.getByRole('button', { name: 'Done', exact: true })).toHaveCount(1)
      const before = await navigation.boundingBox()
      await page.screenshot({ path: resolve(folder, 'section-' + width + '.png') })
      await inspector.getByRole('tab', { name: 'Style', exact: true }).click()
      for (const [name, count, firstRow] of [
        ['Spacing', 4, 2],
        ['Width', 5, 3],
      ] as const) {
        const group = inspector.getByRole('group', { name, exact: true }),
          buttons = group.getByRole('button')
        await expect(buttons).toHaveCount(count)
        const tops = await buttons.evaluateAll(ns => ns.map(n => Math.round(n.getBoundingClientRect().top)))
        expect(new Set(tops).size).toBe(2)
        expect(tops.slice(0, firstRow).every(y => y === tops[0])).toBe(true)
        expect(tops.slice(firstRow).every(y => y === tops[firstRow])).toBe(true)
      }
      await page.screenshot({ path: resolve(folder, 'style-' + width + '.png') })
      await inspector.getByRole('tab', { name: 'Content', exact: true }).click()
      await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
      await expect(inspector.getByRole('heading', { name: 'New card', exact: true })).toBeVisible()
      await expect(inspector.getByRole('button', { name: 'Done', exact: true })).toHaveCount(1)
      await expect(navigation.getByRole('button', { name: 'Done', exact: true })).toBeDisabled()
      const nested = await navigation.boundingBox()
      expect(Math.round(nested!.y)).toBe(Math.round(before!.y))
      await inspector.getByLabel('Title', { exact: true }).fill('[Private card]')
      await expect(cards).toHaveCount(6)
      await page.screenshot({ path: resolve(folder, 'card-' + width + '.png') })
      await inspector.getByRole('button', { name: 'Choose icon', exact: true }).click()
      const picker = page.getByRole('dialog', { name: 'Choose an icon', exact: true })
      await picker.getByLabel('Search icons', { exact: true }).fill('no-icon-matches-this')
      await expect(picker.getByRole('status')).toContainText('No icons match')
      await page.screenshot({ path: resolve(folder, 'icon-empty-' + width + '.png') })
      await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(picker).toBeHidden()
      await expect(inspector.getByLabel('Title', { exact: true })).toHaveValue('[Private card]')
      await inspector.getByLabel('Title', { exact: true }).press('Escape')
      await expect(cards).toHaveCount(5)
      await expect(inspector.getByRole('button', { name: 'Add a card', exact: true })).toBeVisible()
      await expect(navigation.getByRole('button', { name: 'Done', exact: true })).toBeEnabled()
      await navigation.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(canvas(page).locator('[data-cms-selected]')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
