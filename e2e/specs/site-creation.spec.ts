import { E2E_PORTS } from '../test-ports.ts'
import { setPreviewSiteLook } from './helpers.ts'
import { expect, test } from '@playwright/test'
import { signIn, publish, canvas, treeLabels, saveDraft } from './helpers.ts'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { rawRequest } from './http.ts'

async function captureR8(page: import('@playwright/test').Page, name: string) {
  const folder = resolve('../.r8-progress/step-2/templates')
  await mkdir(folder, { recursive: true })
  const previous = page.viewportSize()
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size)
    await page.screenshot({ path: resolve(folder, `${name}-${size.width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  if (previous) await page.setViewportSize(previous)
}

test('creates a private event, previews saved appearance, publishes its first release and archives it', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signIn(page, 'root@example.test')
  await page.getByRole('link', { name: 'Create a site', exact: true }).click()
  const slug = `wizard-event-${Date.now()}`
  await page.getByLabel('Site name', { exact: true }).fill('An event created in the wizard')
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  await page.getByLabel(/Event site/).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Look', exact: true })).toBeVisible()
  await page.getByLabel('Forest', { exact: true }).check()
  await captureR8(page, 'wizard-look')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible()
  const speaker = page.locator('.wizard-page').filter({ has: page.locator('summary').filter({ hasText: 'Speakers' }) })
  await speaker.locator('summary').click()
  await speaker.getByRole('button', { name: 'Move up', exact: true }).click()
  await captureR8(page, 'wizard-page-templates')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Footer introduction').fill('Visitor information and community connections.')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
  // SPEC §9.3: a new site's authorized preview within 60s, timed from Create site to its branded canvas.
  const creating = Date.now()
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await expect(page.getByText('Your new site is private until you publish it.', { exact: false })).toBeVisible()
  await expect(page.locator('table[aria-label="Pages"] tbody tr td:first-child a').first()).toHaveText('Speakers')
  const host = `${slug}.staging.localhost`
  expect((await rawRequest({ host, path: '/' })).status).toBe(404)
  expect((await rawRequest({ host, path: '/speakers' })).status).toBe(404)
  const workspace = page.url()
  await page.locator('table[aria-label="Pages"] tbody tr td:first-child a').first().click()
  await expect(page.getByLabel('Preview with saved site-look changes', { exact: true })).toBeChecked()
  const canvas = page.frameLocator('iframe[title="Page canvas"]')
  await expect(canvas.getByText('An event created in the wizard', { exact: true }).first()).toBeVisible()
  await expect(canvas.getByText('Visitor information and community connections.', { exact: true })).toBeVisible()
  await expect(canvas.getByText('Speaker 1 (sample)', { exact: true }).first()).toBeVisible()
  await expect(canvas.locator('.core-people .core-card')).toHaveCount(3)
  const previewMs = Date.now() - creating
  console.log(`BUDGET new-site-preview ${JSON.stringify({ createToPreviewMs: previewMs })}`)
  expect(previewMs).toBeLessThanOrEqual(60_000)
  const savedPageUrl = page.url()
  const staleCanvasUrl = new URL((await page.locator('iframe[title="Page canvas"]').getAttribute('src'))!, savedPageUrl)
    .href
  await page.goto(workspace)
  await page.getByRole('main').getByRole('link', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Publish your site for the first time', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await expect(page.getByRole('heading', { name: 'Check selected changes', exact: true })).toBeVisible()
  expect((await rawRequest({ host, path: '/' })).status).toBe(404)
  await expect(page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })).toBeDisabled()
  await captureR8(page, 'release-samples-unconfirmed')
  await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
  await captureR8(page, 'release-samples-confirmed')
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
  const home = await rawRequest({ host, path: '/' })
  expect(home.status).toBe(200)
  expect(home.body).toContain('An event created in the wizard')
  expect(home.body).toContain('noindex')
  const speakers = await rawRequest({ host, path: '/speakers' })
  expect(speakers.status).toBe(200)
  expect(speakers.body).toContain('Speaker 1 (sample)')
  expect(speakers.body).toContain('Speaker 2 (sample)')
  expect(speakers.body).toContain('Speaker 3 (sample)')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('link', { name: 'Advanced', exact: true }).click()
  await page.getByRole('button', { name: 'Archive site', exact: true }).click()
  await page.getByRole('alertdialog').getByLabel('Type the site name to confirm').fill('An event created in the wizard')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive site', exact: true }).click()
  await expect(page.getByText('This site is archived.', { exact: false })).toBeVisible()
  await captureR8(page, 'archived-native-settings')
  expect((await rawRequest({ host, path: '/' })).status).toBe(404)
  // A bookmark or previously-open editor must now lead to a reference view,
  // and omitting readonly from its old preview URL cannot restore the bridge.
  await page.goto(savedPageUrl)
  await expect(page.getByRole('status')).toContainText('Read-only saved page')
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
  await expect(page.locator('iframe[title="Page canvas"]')).toHaveCount(0)
  await expect(page.locator('iframe[title="Read-only saved page"]')).toHaveAttribute('sandbox', 'allow-same-origin')
  await expect(
    page
      .frameLocator('iframe[title="Read-only saved page"]')
      .getByText('Visitor information and community connections.', { exact: true }),
  ).toBeVisible()
  const stalePreview = await page.evaluate(async url => {
    const response = await fetch(url)
    return {
      status: response.status,
      csp: response.headers.get('content-security-policy'),
      html: await response.text(),
    }
  }, staleCanvasUrl)
  expect(stalePreview.status).toBe(200)
  expect(stalePreview.csp).toContain("script-src 'none'")
  expect(stalePreview.html).not.toContain('cms:edit-richtext')
  await page.getByRole('link', { name: 'View page history', exact: true }).click()
  await expect(page.getByText('Saved versions and comparisons are read-only', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /Restore/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Back to saved page', exact: true })).toBeVisible()
})

test('does not offer site creation to an ordinary editor', async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await expect(page.getByRole('link', { name: 'Create a site', exact: true })).toHaveCount(0)
  const response = await page.goto('/sites/new')
  expect(response?.status()).toBe(404)
})

test('creates a chapter from shared sections, keeps board and photos optional, and publishes readable content', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000)
  const fixture = await siteLookFixture(),
    folder = resolve('../.r8-progress/echelon/chapter-template')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(folder, { recursive: true })
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + fixture.site)
    await page.getByRole('button', { name: 'Add a page', exact: true }).click()
    const creator = page.getByRole('dialog', { name: 'New page', exact: true })
    await creator.getByLabel('Page title', { exact: true }).fill('[Chapter name]')
    await creator.getByText('A page design', { exact: true }).click()
    await creator.getByLabel('Page design', { exact: true }).selectOption('chapter')
    await capture('choose-template')
    await creator.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(treeLabels(page)).toHaveCount(5)
    const pageId = page.url().split('/').pop()!
    const initial = (
      await fixture.pool.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!.content
    expect(initial.map((section: { label: string; hidden: boolean }) => [section.label, section.hidden])).toEqual([
      ['Page header', false],
      ['About this chapter', false],
      ['Board', true],
      ['Photos', true],
      ['Join us', false],
    ])
    await treeLabels(page).filter({ hasText: 'Board' }).click()
    await page.getByRole('button', { name: 'Move section down', exact: true }).click()
    await saveDraft(page)
    const stored = (
      await fixture.pool.query(
        'SELECT p.slug,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [pageId],
      )
    ).rows[0]!
    expect(
      stored.content.map((section: { label: string; hidden: boolean }) => [section.label, section.hidden]),
    ).toEqual([
      ['Page header', false],
      ['About this chapter', false],
      ['Photos', true],
      ['Board', true],
      ['Join us', false],
    ])
    await expect(canvas(page).getByRole('heading', { name: 'About this chapter', exact: true })).toBeVisible()
    await capture('editor')
    await publish(page)
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    expect(
      await canvas(page)
        .locator('html')
        .evaluate(node => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    await capture('phone-preview')
    const visitor = await browser.newContext({ javaScriptEnabled: false })
    try {
      for (const width of [1440, 1024, 390]) {
        const live = await visitor.newPage()
        await live.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
        await live.goto('http://' + fixture.host + `:${E2E_PORTS.site}/` + stored.slug)
        await expect(live.getByRole('heading', { name: '[Chapter name]', exact: true })).toBeVisible()
        await expect(live.getByRole('heading', { name: 'About this chapter', exact: true })).toBeVisible()
        await expect(live.getByRole('heading', { name: 'Board', exact: true })).toHaveCount(0)
        await expect(live.getByText('[Board member 1] (sample)', { exact: true })).toHaveCount(0)
        await expect(live.getByRole('heading', { name: 'Photos', exact: true })).toHaveCount(0)
        expect(await live.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await live.screenshot({
          path: resolve(folder, 'public-' + width + '.png'),
          fullPage: true,
          animations: 'disabled',
        })
        await live.close()
      }
    } finally {
      await visitor.close()
    }
    expect(errors).toEqual([])
  } finally {
    await fixture.pool.end()
  }
})
