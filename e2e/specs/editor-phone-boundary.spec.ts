import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { canvas, signIn } from './helpers.ts'

test.use({ actionTimeout: 15000 })

test('phone-sized page editors keep save and status without exposing editing or losing a desktop change', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true)
  const folder = resolve('../.r8-progress/round3/editor-phone-boundary', info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const native = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!.id
    const standard = (
      await f.pool.query("SELECT p.id FROM pages p JOIN sites s ON s.id=p.site_id WHERE s.slug='demo' AND p.slug=''")
    ).rows[0]!.id
    await signIn(page, 'root@example.test')
    for (const [kind, id, selector, label] of [
      ['native', native, '[data-cms-section="1"] [data-cms-slot="heading"]', 'Title'],
      ['standard', standard, '[data-cms-slot="heading"]', 'Title'],
    ]) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto('/pages/' + id)
      await canvas(page).locator(selector!).first().click()
      const field = page.locator('.inspector').getByLabel(label!, { exact: true })
      await field.fill('[Private resize check]')
      const live = (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!
        .published_version_id
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect(field).toBeVisible()
        await page.screenshot({ path: resolve(folder, kind + '-' + width + '.png') })
      }
      await page.setViewportSize({ width: 390, height: 900 })
      await expect(page.getByText('Use a larger screen to edit.', { exact: true })).toBeVisible()
      await expect(field).toBeHidden()
      await expect(page.locator('iframe[title="Page canvas"]')).toBeHidden()
      for (const name of ['Publish', 'Preview', 'Schedule', 'More page actions']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeHidden()
      }
      await expect(page.getByRole('link', { name: 'Page history', exact: true })).toBeHidden()
      await expect(page.locator('.saved-state .saved-words')).toBeVisible()
      await page.getByRole('button', { name: 'Save draft', exact: true }).click()
      await expect(page.getByText('All changes saved. The live site is not affected.', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, kind + '-390.png') })
      expect(
        (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [id])).rows[0]!.published_version_id,
      ).toBe(live)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await expect(field).toHaveValue('[Private resize check]')
      await expect(field).toBeVisible()
      await page.reload()
      await canvas(page).locator(selector!).first().click()
      await expect(field).toHaveValue('[Private resize check]')
      await page.screenshot({ path: resolve(folder, kind + '-restored-1440.png') })
      if (kind === 'native') {
        await canvas(page).locator('[data-cms-section="1"] [data-cms-slot="cards__i1__icon"]').click()
        await page.getByRole('button', { name: 'Change icon: Partnership', exact: true }).click()
        const picker = page.getByRole('dialog', { name: 'Choose an icon', exact: true })
        await picker.getByRole('searchbox', { name: 'Search icons', exact: true }).fill('heart')
        await page.screenshot({ path: resolve(folder, 'pending-choice-1440.png') })
        await page.setViewportSize({ width: 390, height: 900 })
        await expect(picker).toBeHidden()
        await page.getByRole('button', { name: 'Save draft', exact: true }).click()
        await expect(page.getByText('All changes saved. The live site is not affected.', { exact: true })).toBeVisible()
        await page.screenshot({ path: resolve(folder, 'pending-choice-390.png') })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await expect(picker).toBeVisible()
        await expect(picker.getByRole('searchbox', { name: 'Search icons', exact: true })).toHaveValue('heart')
        await page.screenshot({ path: resolve(folder, 'pending-choice-resumed-1440.png') })
        await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
      if (kind === 'standard') {
        await page.getByRole('button', { name: 'Publish', exact: true }).click()
        const review = page.getByRole('dialog', { name: 'Publish this page', exact: true })
        await expect(review).toBeVisible()
        await page.setViewportSize({ width: 390, height: 900 })
        await expect(review).toBeHidden()
        await page.getByRole('button', { name: 'Save draft', exact: true }).click()
        await expect(page.getByText('All changes saved. The live site is not affected.', { exact: true })).toBeVisible()
        await page.screenshot({ path: resolve(folder, 'pending-review-390.png') })
        await page.setViewportSize({ width: 1440, height: 1000 })
        await expect(review).toBeVisible()
        await page.screenshot({ path: resolve(folder, 'pending-review-resumed-1440.png') })
        await review.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
