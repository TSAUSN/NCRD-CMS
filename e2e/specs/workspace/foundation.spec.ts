import { expect, test } from '@playwright/test'
import { signIn, clickOnCanvas, typeInInspector, saveDraft, publish } from '../helpers.ts'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
async function openSeededPage(page: import('@playwright/test').Page) {
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()
}
const shots = resolve('../.r8-progress/step-1')
async function capture(page: import('@playwright/test').Page, name: string) {
  await mkdir(shots, { recursive: true })
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size)
    if (await page.locator('.sidebar').count()) {
      const folded = (await page.locator('.app').getAttribute('data-rail')) === 'on'
      await expect(page.locator('.sidebar')).toHaveCSS('width', folded ? '64px' : '248px')
    }
    await page.screenshot({
      path: resolve(shots, `${name}-${size.width}.png`),
      fullPage: false,
      animations: 'disabled',
    })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true)
  }
}
test('foundation: navigation, full site names, settings spacing and safe archive confirmation', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page, 'root@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await capture(page, 'all-sites')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.waitForURL(/\/sites\/[0-9a-f-]+$/)
  const sitePath = new URL(page.url()).pathname
  await expect(page.getByRole('button', { name: 'Switch site · Demo site', exact: true })).toBeVisible()
  await capture(page, 'pages')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Archive site', exact: true })).toHaveCount(0)
  await capture(page, 'settings')
  const longSiteName =
    'A long site name that needs to stay readable for coordinators and volunteers across all their pages and lists'
  async function publishName(name: string) {
    await page.getByLabel('Site name', { exact: true }).fill(name)
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Site settings draft saved' })).toBeVisible()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const review = page.getByLabel('Selected changes review', { exact: true })
    await expect(review.getByText('Site settings', { exact: true })).toBeVisible()
    const publishSelected = review.getByRole('button', { name: 'Publish selected (1)', exact: true })
    const samples = review.getByRole('checkbox', { name: /Publish with sample content/ })
    // A site-wide settings change also checks the site's already published pages.
    if (await samples.isVisible()) {
      await expect(review.getByText(/still contains sample content/i).first()).toBeVisible()
      await expect(publishSelected).toBeDisabled()
      await samples.check()
      await expect(publishSelected).toBeEnabled()
    }
    await publishSelected.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    await page.goto(sitePath + '/settings')
  }
  await publishName(longSiteName)
  await expect(page.getByLabel(`Switch site · ${longSiteName}`, { exact: true })).toBeVisible()
  await page.getByLabel(`Switch site · ${longSiteName}`, { exact: true }).click()
  await capture(page, 'site-switcher-long')
  await page.keyboard.press('Escape')
  await publishName('Demo site')
  await expect(page.getByLabel('Switch site · Demo site', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Advanced', exact: true }).click()
  const headings = page.locator('main section h2')
  await expect(headings).toHaveText([
    'Address & domains',
    'People on this site',
    'Site scripts and files',
    'Backup',
    'Danger zone',
  ])
  await page.route('**/api/sites/*/export', route =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'The archive is temporarily unavailable. Try again.' }),
    }),
  )
  await page.getByRole('button', { name: 'Download content archive' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'The archive is temporarily unavailable. Try again.',
  )
  await capture(page, 'settings-export-error')
  await page.unroute('**/api/sites/*/export')
  const paddings = await page
    .locator('main section')
    .evaluateAll(cards => cards.map(card => getComputedStyle(card).padding))
  expect(new Set(paddings)).toEqual(new Set(['0px']))
  await page.getByRole('button', { name: 'Archive site', exact: true }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByRole('button', { name: 'Archive site', exact: true })).toBeDisabled()
  await confirm.getByLabel('Type the site name to confirm').fill('Wrong name')
  await expect(confirm.getByRole('button', { name: 'Archive site', exact: true })).toBeDisabled()
  await confirm.getByLabel('Type the site name to confirm').fill('Demo site')
  await expect(confirm.getByRole('button', { name: 'Archive site', exact: true })).toBeEnabled()
  await capture(page, 'archive-confirmation')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(sitePath + '$'))
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' })
  const appearance = await collapse.evaluate(button => {
    const css = getComputedStyle(button)
    return { width: css.width, height: css.height, color: css.color }
  })
  expect(appearance).toEqual({ width: '28px', height: '28px', color: 'rgb(15, 23, 41)' })
  await collapse.click()
  await expect(page.locator('.app')).toHaveAttribute('data-rail', 'on')
  await page.reload()
  await expect(page.locator('.app')).toHaveAttribute('data-rail', 'on')
  await expect(page.locator('.sidebar')).toHaveCSS('width', '64px')
  await capture(page, 'rail-collapsed')
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  for (const area of [
    'content',
    'media',
    'documents',
    'design',
    'global-elements',
    'navigation',
    'sections',
    'recipes',
    'publishing',
    'domains',
  ]) {
    await page.goto(sitePath + '/' + area)
    await expect(page.getByRole('complementary', { name: 'CMS navigation', exact: true })).toBeVisible()
    if (['content', 'media', 'documents', 'design', 'publishing'].includes(area)) {
      await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0)
    }
    if (area === 'design')
      await expect(page.frameLocator('iframe[title="Site look page preview"]').locator('h1')).toBeVisible()
    if (area === 'global-elements')
      await expect(page.frameLocator('iframe[title="Demo site header and footer preview"]').locator('h1')).toBeVisible()
    await capture(page, area)
  }
  for (const area of ['inbox', 'people', 'activity', 'sites/new', 'sites/import']) {
    await page.goto('/' + area)
    await expect(page.getByRole('complementary', { name: 'CMS navigation', exact: true })).toBeVisible()
    await capture(page, area.replaceAll('/', '-'))
  }
  expect(errors).toEqual([])
})
test('foundation: a saved edit stays amber until publishing on all three screens', async ({ page }) => {
  await signIn(page, 'root@example.test')
  await openSeededPage(page)
  await publish(page)
  await expect(page.locator('.editor-title').getByText('Live', { exact: true })).toBeVisible()
  await clickOnCanvas(page, 'heading')
  const original = await page.locator('#slot-0-heading').inputValue()
  await typeInInspector(page, 0, 'heading', original + ' — review change')
  await saveDraft(page)
  await expect(page.locator('.editor-title').getByText('Changes not live', { exact: true })).toBeVisible()
  const pill = page.locator('.editor-title').getByText('Changes not live', { exact: true })
  expect(
    await pill.evaluate(node => {
      const range = node.ownerDocument.createRange()
      range.selectNodeContents(node)
      return new Set([...range.getClientRects()].map(box => Math.round(box.top))).size
    }),
  ).toBe(1)
  await capture(page, 'editor-pending')
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await page.screenshot({ path: resolve(shots, 'editor-phone-390.png'), fullPage: true })
  const phone = await page.context().newPage()
  await phone.setViewportSize({ width: 390, height: 844 })
  await phone.goto(new URL((await page.locator('iframe[title="Page canvas"]').getAttribute('src'))!, page.url()).href)
  await phone.screenshot({ path: resolve(shots, 'site-phone-390.png'), fullPage: true })
  await phone.close()
  const editorUrl = page.url()
  const sitePath = await page
    .getByRole('banner')
    .getByRole('link', { name: 'Demo site', exact: true })
    .getAttribute('href')
  await page.goto(sitePath + '/pages')
  const card = page
    .locator('table[aria-label="Pages"] tbody tr')
    .filter({ has: page.getByRole('link', { name: 'A page served by cms-v2', exact: true }) })
  await expect(card.getByText('Changes not live', { exact: true })).toBeVisible()
  await page
    .getByRole('complementary', { name: 'CMS navigation', exact: true })
    .getByRole('link', { name: 'All sites', exact: true })
    .click()
  await expect(
    page.locator('.site-card').filter({ hasText: 'Demo site' }).getByText('Changes not live', { exact: true }),
  ).toBeVisible()
  await page.goto(editorUrl)
  await clickOnCanvas(page, 'heading')
  await typeInInspector(page, 0, 'heading', original)
  await saveDraft(page)
  await publish(page)
  await expect(page.locator('.editor-title').getByText('Live', { exact: true })).toBeVisible()
})
