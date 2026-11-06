import { E2E_PORTS } from '../test-ports.ts'
import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fetchPublic, publish, signIn } from './helpers.ts'

async function captureHistory(page: Page) {
  const folder = resolve('../.r8-progress/admin-history')
  await mkdir(folder, { recursive: true })
  await page.frameLocator('iframe[title^="Comparison preview"]').locator('h1').waitFor()
  await page.frameLocator('iframe[title^="Preview of version"]').locator('h1').waitFor()
  const original = page.viewportSize()
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.screenshot({ path: resolve(folder, 'comparison-' + width + '.png'), animations: 'disabled' })
  }
  if (original) await page.setViewportSize(original)
}

async function createPage(page: Page) {
  await signIn(page, 'editor@example.test')
  await page.getByRole('link', { name: 'Demo site', exact: true }).click()
  // App-router links settle asynchronously; a click completing does not mean
  // page.url() has moved off the dashboard yet. Capture only the settled route.
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  const siteUrl = page.url() + '/pages'
  await page.getByRole('button', { name: 'Add a page' }).click()
  const creator = page.getByRole('dialog', { name: 'New page', exact: true })
  const slug = `lifecycle-${Date.now()}`
  const title = `Lifecycle ${Date.now()}`
  await creator.getByLabel('Page title', { exact: true }).fill(title)
  await creator.getByRole('button', { name: 'Change', exact: true }).click()
  await creator.getByLabel('Web address', { exact: true }).fill(slug)
  // A Page header keeps this lifecycle fixture complete and focused.
  await creator.getByText('A blank page', { exact: true }).click()
  await creator.getByRole('button', { name: 'Create draft', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]+$/)
  const editorUrl = page.url()
  const id = editorUrl.split('/').pop()!
  const card = () =>
    page.locator('table[aria-label="Pages"] tbody tr').filter({ has: page.locator(`a[href="/pages/${id}"]`) })
  return { id, title, slug, siteUrl, editorUrl, card }
}

test('renames, compares, unpublishes, archives and restores a page through the workspace', async ({ page }) => {
  test.setTimeout(90_000)
  const p = await createPage(page)
  await publish(page)
  expect((await fetchPublic(`/${p.slug}`)).status).toBe(200)
  await page.goto(p.siteUrl)
  await p
    .card()
    .getByRole('button', { name: /^More actions for / })
    .click()
  await p.card().getByRole('button', { name: 'Rename', exact: true }).click()
  const rename = page.getByRole('dialog', { name: 'Page name and address' })
  const newTitle = `${p.title} renamed`
  await rename.getByLabel('Page title', { exact: true }).fill(newTitle)
  await rename.getByLabel('Page address', { exact: true }).fill(`${p.slug}-renamed`)
  await rename.getByRole('button', { name: 'Save page details' }).click()
  await expect(rename.getByRole('status')).toContainText('saved')
  await rename.getByRole('button', { name: 'Close Page name and address', exact: true }).click()
  await expect(rename).toBeHidden()
  await expect(p.card().getByRole('link', { name: newTitle, exact: true })).toBeVisible()
  await p
    .card()
    .getByRole('button', { name: /^More actions for / })
    .click()
  await expect(p.card().getByRole('link', { name: `View ${newTitle} on the live site` })).toHaveAttribute(
    'href',
    `http://demo.staging.localhost:${E2E_PORTS.site}/${p.slug}`,
  )
  await page.keyboard.press('Escape')
  expect((await fetchPublic(`/${p.slug}`)).status).toBe(200)
  expect((await fetchPublic(`/${p.slug}-renamed`)).status).toBe(404)

  await page.goto(`${p.editorUrl}/history`)
  await page.getByText('Compare with another version', { exact: true }).click()
  await page.getByLabel('Compare this version with').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Compare versions' }).click()
  await expect(page.getByRole('rowheader', { name: 'Page name', exact: true })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Address', exact: true })).toBeVisible()
  await expect(page.locator('iframe[title^="Comparison preview"]')).toHaveAttribute('sandbox', 'allow-same-origin')
  await captureHistory(page)
  await page.goto(p.editorUrl)
  await publish(page)
  expect((await fetchPublic(`/${p.slug}`)).status).toBe(404)
  expect((await fetchPublic(`/${p.slug}-renamed`)).status).toBe(200)

  await page.goto(p.siteUrl)
  await p
    .card()
    .getByRole('button', { name: /^More actions for / })
    .click()
  await p.card().getByRole('button', { name: 'Unpublish', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Unpublish page' }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
  expect((await fetchPublic(`/${p.slug}-renamed`)).status).toBe(404)
  await p
    .card()
    .getByRole('button', { name: /^More actions for / })
    .click()
  await p.card().getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive page' }).click()
  await expect(p.card()).toHaveCount(0)
  await page
    .locator('summary')
    .filter({ hasText: /^Archived pages \(\d+\)$/ })
    .click()
  const archived = page.locator('.archived-row').filter({ hasText: newTitle })
  await expect(archived).toBeVisible()
  await archived.getByRole('button', { name: 'Restore page' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore page' }).click()
  await expect(p.card()).toBeVisible()
  expect((await fetchPublic(`/${p.slug}-renamed`)).status).toBe(404)

  // Leave only a recoverable archived fixture behind for the other suites.
  await p
    .card()
    .getByRole('button', { name: /^More actions for / })
    .click()
  await p.card().getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive page' }).click()
  await expect(p.card()).toHaveCount(0)
})

test('shows a stale-edit error inside the rename dialog and keeps the typed details', async ({
  page,
  context,
}, info) => {
  const p = await createPage(page)
  await page.goto(p.siteUrl)
  await p
    .card()
    .getByRole('button', { name: /^More actions for / })
    .click()
  await p.card().getByRole('button', { name: 'Rename', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Page name and address' })
  await dialog.getByLabel('Page title', { exact: true }).fill('Unsaved title from first tab')
  const other = await context.newPage()
  await other.goto(p.siteUrl)
  const otherCard = other
    .locator('table[aria-label="Pages"] tbody tr')
    .filter({ has: other.locator(`a[href="/pages/${p.id}"]`) })
  await otherCard.getByRole('button', { name: /^More actions for / }).click()
  await otherCard.getByRole('button', { name: 'Rename', exact: true }).click()
  const otherDialog = other.getByRole('dialog', { name: 'Page name and address' })
  await otherDialog.getByLabel('Page title', { exact: true }).fill('Saved title from second tab')
  await otherDialog.getByRole('button', { name: 'Save page details' }).click()
  await expect(otherDialog.getByRole('status')).toContainText('saved')
  await otherDialog.getByRole('button', { name: 'Close Page name and address', exact: true }).click()
  await expect(otherDialog).toBeHidden()
  await dialog.getByRole('button', { name: 'Save page details' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Page title', { exact: true })).toHaveValue('Unsaved title from first tab')
  await dialog.getByRole('button', { name: 'Close Page name and address', exact: true }).click()
  await expect(p.card().getByRole('button', { name: /^More actions for / })).toBeFocused()
  await otherCard.getByRole('button', { name: /^More actions for / }).click()
  // A refreshed long table can move its trigger. The top-layer actions must
  // remain reachable even after that trigger scrolls outside the viewport.
  const actions = otherCard.locator('[popover]:popover-open')
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await other.setViewportSize(size)
    await other.evaluate(() => window.scrollTo(0, 0))
    await expect
      .poll(() =>
        actions.evaluate(node => {
          const box = node.getBoundingClientRect()
          return box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth
        }),
      )
      .toBe(true)
    const { mkdir } = await import('node:fs/promises'),
      { resolve } = await import('node:path')
    const folder = resolve('../.r8-progress/step-5/menu-boundary/' + info.project.name)
    await mkdir(folder, { recursive: true })
    await other.screenshot({ path: resolve(folder, 'page-actions-' + size.width + '.png') })
  }
  await otherCard.getByRole('button', { name: 'Archive', exact: true }).click()
  await other.getByRole('alertdialog').getByRole('button', { name: 'Archive page' }).click()
  await expect(otherCard).toHaveCount(0)
  await other.close()
})
