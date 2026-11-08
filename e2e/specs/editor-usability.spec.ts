import { expect, test } from '@playwright/test'
import { openPageSettings, canvas, openSeededPage, signIn } from './helpers.ts'

test('long page structure can be collapsed, searched, and reopened by canvas selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'editor@example.test')
  await openSeededPage(page)
  const tree = page.getByRole('complementary', { name: 'Page structure' })
  await expect(tree.locator('.tree-slots:visible')).toHaveCount(0)
  await tree
    .getByRole('button', { name: /^Expand / })
    .first()
    .click()
  await expect(tree.locator('.tree-slots:visible')).toHaveCount(1)
  await tree.getByRole('button', { name: 'Page structure options', exact: true }).click()
  await tree.getByRole('button', { name: 'Collapse all', exact: true }).click()
  await expect(tree.locator('.tree-slots:visible')).toHaveCount(0)
  await tree.getByRole('searchbox').fill('Heading')
  await expect(tree.getByRole('button', { name: 'Heading', exact: true }).first()).toBeVisible()
  await tree.getByRole('searchbox').fill('')
  await expect(tree.locator('.tree-slots:visible')).toHaveCount(0)
  await canvas(page).locator('[data-cms-slot="heading"]').first().click()
  await expect(tree.locator('.tree-slots:visible')).toHaveCount(1)
  await expect(page.locator('[data-inspector-slot="heading"][data-selected="true"]')).toBeVisible()
  await openPageSettings(page)
  await expect(page.getByRole('textbox', { name: 'Search title', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close Page settings', exact: true }).click()
  await tree
    .getByRole('button', { name: /^Expand / })
    .first()
    .click()
  await expect(tree.locator('.tree-slots:visible')).toHaveCount(1)
})

test('actual-size and focus views keep the preview width and editing state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page, 'editor@example.test')
  await openSeededPage(page)
  const frame = page.locator('iframe[title="Page canvas"]')
  // The editor opens on the visitor's desktop viewport scaled to fit, so the
  // desktop design is not reflowed to the column's width (SPEC §6.4).
  await expect(page.getByRole('button', { name: 'Fit', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Desktop', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() =>
      canvas(page)
        .locator('html')
        .evaluate(node => node.clientWidth),
    )
    .toBe(1280)
  // Resizing keeps the actual 1280px document and adjusts only its displayed scale.
  const widthBefore = await frame.boundingBox()
  expect(widthBefore!.width).toBeLessThan(1280)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(widthBefore!.width)
  await expect
    .poll(() =>
      canvas(page)
        .locator('html')
        .evaluate(node => node.clientWidth),
    )
    .toBe(1280)
  await page.getByRole('button', { name: 'Focus on page' }).click()
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeHidden()
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(widthBefore!.width)
  await page.getByRole('button', { name: 'Zoom to actual size', exact: true }).click()
  await expect.poll(() => frame.evaluate(node => node.getBoundingClientRect().width)).toBe(1280)
  await page.getByRole('button', { name: 'Show editing panels' }).click()
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()
  await expect(page.locator('.canvas-viewport')).toHaveCSS('overflow-x', 'auto')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await canvas(page).locator('[data-cms-slot="heading"]').first().click()
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible()
})

test('only the bound canvas can change editor content through preview messages', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await openSeededPage(page)
  await canvas(page).locator('[data-cms-slot="heading"]').first().click()
  const input = page.getByRole('textbox', { name: 'Title', exact: true })
  const before = await input.inputValue()
  await page.evaluate(() => {
    window.postMessage(
      { type: 'cms:edit', section: 0, slot: 'heading', value: 'Unrelated window edit' },
      location.origin,
    )
  })
  // A UI action crosses the event loop without relying on an arbitrary sleep.
  await openPageSettings(page)
  await page.getByRole('button', { name: 'Close Page settings', exact: true }).click()
  await canvas(page).locator('[data-cms-slot="heading"]').first().click()
  await expect(input).toHaveValue(before)
})

test('workspace errors preserve percent characters without crashing the page', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  const workspace = new URL(page.url())
  workspace.searchParams.set('error', 'Upload is 100% complete; retry %2F if needed.')
  await page.goto(workspace.toString())
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Upload is 100% complete; retry %2F if needed.')
  await expect(page.getByRole('heading', { name: /^Demo site/, level: 1 })).toBeVisible()
})
