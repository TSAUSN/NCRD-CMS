import { expect } from '@playwright/test'
import { test } from '../fixtures/shared-demo-home.ts'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { signIn, openSeededPage, addSectionButton, saveDraft, treeLabels, deleteSelectedSection } from '../helpers.ts'
const shots = resolve('../.r8-progress/step-5/library-height')
async function capture(page: import('@playwright/test').Page, name: string) {
  await mkdir(shots, { recursive: true })
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size)
    await expect
      .poll(() =>
        page.locator('.canvas-viewport').evaluate(viewport => {
          const frame = viewport.querySelector('iframe')
          if (!frame || viewport.getAttribute('data-zoom') !== 'fit') return true
          return (
            Math.abs(
              frame.getBoundingClientRect().width -
                Math.min(
                  viewport.clientWidth - Number.parseFloat(getComputedStyle(viewport).paddingInlineStart || '0'),
                  Number.parseFloat(getComputedStyle(frame).width),
                ),
            ) < 2
          )
        }),
      )
      .toBe(true)
    await page.screenshot({ path: resolve(shots, `${name}-${size.width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
test('core library: remembered panels, section-only preview, sample fields and publish confirmation', async ({
  page,
}) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'root@example.test')
  await openSeededPage(page)
  const originalSections = await treeLabels(page).count()
  await page.getByRole('button', { name: 'Focus on page', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Show editing panels', exact: true })).toBeVisible()
  await capture(page, 'focus-mode')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Focus on page', exact: true }).click()
  await page.getByRole('button', { name: 'Show editing panels', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Focus on page', exact: true }).click()
  await page.frameLocator('iframe[title="Page canvas"]').locator('body').press('Escape')
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible()
  await addSectionButton(page).click()
  const shelf = page.getByRole('dialog', { name: 'Add a section', exact: true })
  await expect(shelf).toContainText('Adding')
  await shelf.getByRole('button', { name: 'Change spot', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Choose section spot', exact: true })).toBeVisible()
  await capture(page, 'insertion-destination')
  await page.getByRole('button', { name: 'At the end of the page', exact: true }).click()
  const resize = page.getByRole('separator', { name: 'Resize library', exact: true })
  await expect(resize).toHaveAttribute('aria-valuenow', '400')
  await resize.focus()
  await page.keyboard.press('End')
  await expect(resize).toHaveAttribute('aria-valuenow', '900')
  expect(await page.evaluate(() => localStorage.getItem('cms-r8-library-width'))).toBe('900')
  await capture(page, 'library-wide')
  await resize.dblclick()
  await expect(resize).toHaveAttribute('aria-valuenow', '400')
  await page.getByLabel('Search sections', { exact: true }).fill('No such section example')
  await expect(page.getByRole('heading', { name: 'No sections match', exact: true })).toBeVisible()
  await capture(page, 'library-empty-search')
  await page.getByLabel('Search sections', { exact: true }).fill('Text block')
  const card = page.getByTestId('library-card-core-text-block')
  await expect(card).toBeVisible()
  await capture(page, 'library-filtered')
  const previewApi = '**/preview/*?*insert=*'
  await page.route(previewApi, route => route.fulfill({ status: 503, body: 'Preview temporarily unavailable' }))
  await card.getByRole('button', { name: /^Add Text block / }).click()
  await expect(shelf.getByRole('alert')).toContainText('This section preview could not be loaded')
  await expect(shelf.getByRole('button', { name: 'Add this section', exact: true })).toBeDisabled()
  await capture(page, 'section-preview-error')
  await page.unroute(previewApi)
  let allowPreview: () => void = () => {}
  const held = new Promise<void>(resolve => {
    allowPreview = resolve
  })
  await page.route(previewApi, async route => {
    await held
    await route.continue()
  })
  await shelf.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(shelf.getByRole('status')).toBeVisible()
  await capture(page, 'section-preview-loading')
  allowPreview()
  await expect(shelf.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
  const frame = page.frameLocator('iframe[title="Page canvas"]')
  await expect(frame.locator('.cms-section--core-text-block')).toBeVisible()
  await page.unroute(previewApi)
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect(page.locator('iframe[title="Page canvas"]')).toHaveCSS('width', '390px')
  await capture(page, 'section-preview-phone')
  await shelf.getByRole('button', { name: 'Add this section', exact: true }).click()
  await expect(page.getByRole('separator', { name: 'Resize inspector' })).toHaveAttribute('aria-valuenow', '360')
  await expect(page.locator('.inspector .chip').filter({ hasText: 'Sample' }).first()).toBeVisible()
  await expect(page.frameLocator('iframe[title="Page canvas"]').locator('.cms-section--core-text-block')).toBeVisible()
  await capture(page, 'inserted-samples')
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await capture(page, 'inserted-phone-preview')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  const heading = page.locator('.inspector').getByLabel('Heading', { exact: true })
  await expect(heading).toBeVisible()
  await heading.fill('Our shared story')
  await expect(heading.locator('..').getByText('Sample', { exact: true })).toHaveCount(0)
  await saveDraft(page)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Publish this page', exact: true })
    .getByRole('button', { name: 'Publish', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Publish with sample content?' })).toBeVisible()
  await capture(page, 'sample-confirmation')
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await addSectionButton(page).click()
  await expect(shelf).toBeVisible()
  await capture(page, 'browse-all')
  await shelf.getByRole('button', { name: 'Back', exact: true }).click()
  await deleteSelectedSection(page)
  await saveDraft(page)
  await expect(treeLabels(page)).toHaveCount(originalSections)
  expect(errors).toEqual([])
})
