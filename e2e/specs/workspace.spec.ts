import { expect, test, type Page } from '@playwright/test'
import {
  canvas,
  clickOnCanvas,
  openSeededPage,
  publish,
  saveDraft,
  signIn,
  treeLabels,
  typeInInspector,
} from './helpers.ts'

async function allSites(page: Page) {
  const switcher = page.getByRole('button', { name: 'Switch site · Demo site', exact: true })
  await switcher.click()
  await switcher.locator('..').getByRole('link', { name: 'All sites', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'All sites', exact: true, level: 1 })).toBeVisible()
}

function metric(page: Page, label: string) {
  const card = page.locator('.site-card').filter({ has: page.getByRole('link', { name: 'Demo site', exact: true }) })
  const pattern = label === 'Pages' ? /^\d+ pages?$/ : label === 'Live' ? /^\d+ published$/ : /^\d+ changes? not live$/
  const fact = card.locator('.site-card-facts > span').filter({ hasText: pattern })
  // The shared page/story wording is plain text; the count remains an exact fact.
  return label === 'Pages' ? fact : fact.locator('b')
}
async function metricNumber(page: Page, label: string) {
  const number = metric(page, label)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^(Home|All sites)$/)
  return label === 'Page changes not live' && !(await number.count())
    ? 0
    : Number.parseInt(await number.innerText(), 10)
}

function pageCard(page: Page, pageId: string) {
  return page.locator('table[aria-label="Pages"] tbody tr').filter({ has: page.locator(`a[href="/pages/${pageId}"]`) })
}

test.describe('the editorial dashboard', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'editor@example.test'))

  test('shows factual publishing posture from dashboard to site workspace', async ({ page }) => {
    // Earlier editor specs intentionally create and then revert immutable draft
    // versions. Publish the current snapshot so this test starts from the state
    // it is explicitly describing rather than depending on file order.
    await openSeededPage(page)
    await publish(page)
    const pageId = page.url().split('/').pop()!
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit a page', exact: true })).toBeVisible()
    await expect(page.locator('.site-card')).toHaveCount(0)
    const attention = page.locator('[data-attention-site]')
    const ids = await attention.evaluateAll(rows => rows.map(row => row.getAttribute('data-attention-site')))
    expect(new Set(ids).size).toBe(ids.length)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: `../.r8-progress/polish-home-${width}.png` })
    }
    await allSites(page)
    const pages = await metricNumber(page, 'Pages')
    const published = await metricNumber(page, 'Live')
    const changed = await metricNumber(page, 'Page changes not live')
    expect(pages).toBeGreaterThanOrEqual(1)
    expect(published).toBeGreaterThanOrEqual(1)

    // The site's own facts sit under its name rather than in a second row of
    // figures; every page card agrees with them.
    await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: `../.r8-progress/polish-overview-${width}.png` })
    }
    const facts = page.getByRole('main').getByRole('heading', { level: 1 }).locator('..').locator('..')
    await expect(facts).toContainText(`${pages} ${pages === 1 ? 'page' : 'pages'}`)
    await expect(
      page.locator('table[aria-label="Pages"] tbody tr :is([data-status="live"],[data-status="pending"])'),
    ).toHaveCount(published)
    await expect(page.locator('table[aria-label="Pages"] tbody tr')).toHaveCount(pages)
    // Never-published pages say Draft; live pages say whether saved work is live.
    await expect(page.locator('table[aria-label="Pages"] tbody tr [data-status="pending"]')).toHaveCount(
      changed - (pages - published),
    )
    await expect(pageCard(page, pageId).getByText('Live', { exact: true })).toBeVisible()
    await pageCard(page, pageId)
      .getByRole('button', { name: /^More actions for / })
      .click()
    await expect(pageCard(page, pageId).getByRole('link', { name: /^Edit / })).toBeVisible()
    await page.keyboard.press('Escape')

    for (const size of [
      { width: 1440, height: 900 },
      { width: 1024, height: 900 },
    ]) {
      await page.setViewportSize(size)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      ).toBe(true)
      await expect(page.locator('table[aria-label="Pages"] tbody tr').first()).toBeVisible()
    }
  })

  test('counts a never-published page as work that is not live', async ({ page }) => {
    await page.goto('/sites')
    const before = await metricNumber(page, 'Page changes not live')
    await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
    await page.waitForURL(/\/sites\/[0-9a-f-]+$/)
    const workspaceUrl = page.url()
    const title = `Draft page ${Date.now()}`

    await page.getByRole('button', { name: 'Add a page' }).click()
    await page
      .getByRole('dialog', { name: 'New page', exact: true })
      .getByLabel('Page title', { exact: true })
      .fill(title)
    await page
      .getByRole('dialog', { name: 'New page', exact: true })
      .getByRole('button', { name: 'Create draft', exact: true })
      .click()
    await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()

    await page.goto(workspaceUrl)
    const draftCard = page.locator('table[aria-label="Pages"] tbody tr').filter({ hasText: title })
    await expect(draftCard.getByText('Draft', { exact: true })).toBeVisible()
    await expect(draftCard.locator('[data-status="pending"]')).toHaveCount(0)

    await allSites(page)
    expect(await metricNumber(page, 'Page changes not live')).toBe(before + 1)
  })

  test('chooses a shared starting design and lets an admin arrange it in the editor', async ({ page }) => {
    await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
    await page.getByRole('button', { name: 'Add a page', exact: true }).click()
    const creator = page.getByRole('dialog', { name: 'New page', exact: true })
    await expect(creator.getByRole('radio', { name: /A blank page/ })).toBeChecked()
    const title = `Community support ${Date.now()}`
    await creator.getByLabel('Page title', { exact: true }).fill(title)
    await expect(creator).toContainText('Web address: /community-support-')
    await creator.getByText('A page design', { exact: true }).click()
    await creator.getByLabel('Page design', { exact: true }).selectOption('landing')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath('new-page-' + width + '.png') })
    }
    await creator.getByRole('button', { name: 'Create draft', exact: true }).click()
    await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await expect(treeLabels(page)).toHaveCount(5)
    const names = ['Split hero', 'Icon cards', 'Text + image', 'Stats', 'Call-to-action band']
    for (const [index, name] of names.entries())
      await expect(treeLabels(page).nth(index)).toHaveText(
        new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      )
    await expect(canvas(page).getByRole('heading', { name: title, exact: true })).toBeVisible()
    const editorUrl = page.url(),
      before = await treeLabels(page).allTextContents()
    // The Editor chooses content; an admin changes section structure.
    await expect(page.getByRole('button', { name: 'Move section down', exact: true })).toHaveCount(0)
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto(editorUrl)
    await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await treeLabels(page).first().click()
    await page.getByRole('button', { name: 'Move section down', exact: true }).click()
    await saveDraft(page)
    await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    expect(await treeLabels(page).allTextContents()).toEqual([before[1], before[0], ...before.slice(2)])
    await expect(canvas(page).getByRole('heading', { name: title, exact: true })).toBeVisible()
  })

  test('follows a saved change until publishing makes it live', async ({ page }) => {
    await openSeededPage(page)
    const pageId = page.url().split('/').pop()!
    await clickOnCanvas(page, 'heading')
    const heading = page.locator('#slot-0-heading')
    const original = await heading.inputValue()
    await typeInInspector(page, 0, 'heading', `${original} — draft ${Date.now()}`)
    await saveDraft(page)

    await page.getByRole('banner').getByRole('link', { name: 'Demo site', exact: true }).click()
    await expect(pageCard(page, pageId).getByText('Changes not live', { exact: true })).toBeVisible()

    await allSites(page)
    const changedBeforePublish = await metricNumber(page, 'Page changes not live')
    expect(changedBeforePublish).toBeGreaterThanOrEqual(1)
    await expect(
      page
        .locator('.site-card')
        .filter({ has: page.getByRole('link', { name: 'Demo site', exact: true }) })
        .getByText(/changes? not live/),
    ).toBeVisible()

    // Restore the fixture and publish it. The same immutable-id comparison now
    // clears on the editor, the workspace card and the summary metric.
    await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
    await pageCard(page, pageId)
      .getByRole('button', { name: /^More actions for / })
      .click()
    await pageCard(page, pageId)
      .getByRole('link', { name: /^Edit / })
      .click()
    await canvas(page).locator('[data-cms-slot="heading"]').first().click()
    await page.locator('#slot-0-heading').fill(original)
    await publish(page)
    await page.getByRole('banner').getByRole('link', { name: 'Demo site', exact: true }).click()
    await expect(pageCard(page, pageId).getByText('Live', { exact: true })).toBeVisible()
    await allSites(page)
    expect(await metricNumber(page, 'Page changes not live')).toBe(changedBeforePublish - 1)
  })
})
