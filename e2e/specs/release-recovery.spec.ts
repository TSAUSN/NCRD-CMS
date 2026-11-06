import { expect, test, type Page } from '@playwright/test'
import {
  canvas,
  clickOnCanvas,
  fetchPublic,
  publish,
  saveDraft,
  savedState,
  signIn,
  typeInInspector,
} from './helpers.ts'
import { rawRequest } from './http.ts'

async function execute(page: Page) {
  await expect(page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })).toBeVisible()
  const samples = page.getByRole('checkbox', { name: /Publish with sample content/ })
  if (await samples.count()) {
    await expect(page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })).toBeDisabled()
    await samples.check()
  }
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
}
async function openLastApplied(page: Page) {
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await page
    .getByRole('tabpanel')
    .getByRole('listitem')
    .filter({ has: page.getByText('Went live', { exact: true }) })
    .first()
    .getByRole('button', { name: 'View details', exact: true })
    .click()
  await page.getByRole('button', { name: 'Review recovery', exact: true }).click()
  await expect(page.locator('.recovery-items')).toBeVisible()
}
async function prepare(page: Page) {
  await page.getByRole('button', { name: 'Prepare recovery drafts', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Prepare recovery drafts', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Recovery drafts are ready' })).toBeVisible()
}

test('first-release recovery is reviewed, cancelable, resumable after reload and returns the site to private', async ({
  page,
}) => {
  test.setTimeout(90_000)
  page.setDefaultTimeout(10_000)
  await signIn(page, 'root@example.test')
  await page.getByRole('link', { name: 'Create a site', exact: true }).click()
  const slug = `recover-first-${Date.now()}`
  await page.getByLabel('Site name', { exact: true }).fill('Release recovery example')
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  await page.getByLabel(/Event site/).check()
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await page.getByRole('main').getByRole('link', { name: 'Publish', exact: true }).click()
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await execute(page)
  const host = `${slug}.staging.localhost`
  expect((await rawRequest({ host, path: '/' })).status).toBe(200)
  await openLastApplied(page)
  await expect(page.locator('.recovery-items')).toContainText('Become unpublished')
  await page.getByRole('button', { name: 'Prepare recovery drafts', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await rawRequest({ host, path: '/' })).status).toBe(200)
  await prepare(page)
  expect((await rawRequest({ host, path: '/' })).status).toBe(200)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page
    .getByRole('tabpanel')
    .getByRole('listitem')
    .filter({ has: page.getByText('Went live', { exact: true }) })
    .first()
    .getByRole('button', { name: 'View details', exact: true })
    .click()
  await page.getByRole('button', { name: 'Review recovery', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Recovery drafts are ready' })).toBeVisible()
  await page.getByRole('button', { name: 'Review recovery release', exact: true }).click()
  await expect(page.getByLabel('Selected changes review')).toContainText('will leave the live site')
  await page.screenshot({ path: test.info().outputPath('first-release-recovery-review.png'), fullPage: true })
  expect((await rawRequest({ host, path: '/' })).status).toBe(200)
  await execute(page)
  expect((await rawRequest({ host, path: '/' })).status).toBe(404)
  expect((await rawRequest({ host, path: '/speakers' })).status).toBe(404)
  await page.getByRole('tab', { name: 'Changes ready to publish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Publish your site for the first time', exact: true })).toBeVisible()
})

test('coordinated recovery restores earlier live content and preserves a later draft checkpoint', async ({ page }) => {
  test.setTimeout(90_000)
  page.setDefaultTimeout(10_000)
  await signIn(page, 'editor@example.test')
  await page.getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  const siteUrl = page.url(),
    slug = `recover-page-${Date.now()}`,
    title = `Recovery page ${Date.now()}`
  await page.getByRole('button', { name: 'Add a page' }).click()
  const creator = page.getByRole('dialog', { name: 'New page', exact: true })
  await creator.getByLabel('Page title', { exact: true }).fill(title)
  await creator.getByRole('button', { name: 'Change', exact: true }).click()
  await creator.getByLabel('Web address', { exact: true }).fill(slug)
  await expect(creator.getByRole('radio', { name: /A blank page/ })).toBeChecked()
  await creator.getByRole('button', { name: 'Create draft', exact: true }).click()
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]+$/)
  const editorUrl = page.url(),
    pageId = editorUrl.split('/').pop()!
  await clickOnCanvas(page, 'heading')
  await typeInInspector(page, 0, 'heading', 'Earlier live heading')
  await saveDraft(page)
  await publish(page)
  await typeInInspector(page, 0, 'heading', 'Heading in selected release')
  await saveDraft(page)
  await page.goto(`${siteUrl}/publishing`)
  for (const checkbox of await page.getByRole('tabpanel').getByRole('checkbox').all())
    if (await checkbox.isEnabled()) await checkbox.uncheck()
  await page.getByRole('checkbox', { name: new RegExp(title) }).check()
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await execute(page)
  expect((await fetchPublic(`/${slug}`)).body).toContain('Heading in selected release')
  await page.goto(editorUrl)
  await clickOnCanvas(page, 'heading')
  await typeInInspector(page, 0, 'heading', 'Later unpublished work to keep')
  await saveDraft(page)
  await expect(savedState(page)).toHaveText('All changes saved')
  await page.goto(`${siteUrl}/publishing`)
  await openLastApplied(page)
  await expect(page.locator('.recovery-items')).toContainText('A later draft exists')
  await prepare(page)
  await page.getByText(/Preserved drafts \(\d+\)/).click()
  const preservedHref = await page.getByRole('link', { name: 'View preserved draft', exact: true }).getAttribute('href')
  expect(preservedHref).toContain(`/pages/${pageId}/history?version=`)
  expect((await fetchPublic(`/${slug}`)).body).toContain('Heading in selected release')
  await page.getByRole('button', { name: 'Review recovery release', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  await execute(page)
  const live = await fetchPublic(`/${slug}`)
  expect(live.body).toContain('Earlier live heading')
  expect(live.body).not.toContain('Later unpublished work to keep')
  await page.goto(editorUrl)
  await expect(canvas(page).locator('h1')).toHaveText('Earlier live heading')
  await page.goto(preservedHref!)
  await expect(page.getByText(/Draft preserved before coordinated release recovery/i)).toBeVisible()
  await expect(page.frameLocator('iframe[title^="Preview of version"]').locator('h1')).toHaveText(
    'Later unpublished work to keep',
  )
  await page.screenshot({ path: test.info().outputPath('release-recovery-preserved-history.png'), fullPage: true })
})
