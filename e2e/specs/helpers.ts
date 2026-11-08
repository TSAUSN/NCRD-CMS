import { expect, type FrameLocator, type Locator, type Page, type Response } from '@playwright/test'
import { rawRequest, type RawResponse } from './http.ts'

// Node's fetch cannot rely on the OS resolving *.localhost, so raw HTTP goes
// to the loopback address with an explicit Host header. Chromium *does* map
// *.localhost to loopback (RFC 6761), so browser navigations can use the real
// hostname — which is the only way to exercise Host-based routing in a browser.
import { SITE_ORIGIN, STAGING_ORIGIN, SITE_PORT } from '../test-ports.ts'
export { SITE_ORIGIN, STAGING_ORIGIN, SITE_PORT } from '../test-ports.ts'
export const STAGING_HOST = 'demo.staging.localhost'

/**
 * Sign in as one of the seeded people. The local auth adapter skips the mail
 * round trip; everything after that — the product-user lookup, the membership
 * scoping, the disabled check — is the real path (SPEC §6.1).
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Continue to local CMS' }).click()
  // The sign-in screen already has an h1, so waiting for "an h1" can finish
  // before the server action has set the session cookie and redirected. A fast
  // follow-up to a protected URL then intermittently becomes a signed-out 404.
  await expect(page).not.toHaveURL(/\/sign-in(?:[?#]|$)/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

export async function openSeededPage(page: Page): Promise<void> {
  const site = page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true })
  if (!(await site.count())) {
    // Home may be scoped to a different active site. Use the real directory
    // rather than depending on the fixture being the first site on Home.
    const switcher = page.getByRole('button', { name: /^Switch site · / })
    if (await switcher.count()) await switcher.click()
    await page.getByRole('link', { name: 'All sites', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'All sites', exact: true, level: 1 })).toBeVisible()
  }
  const siteHref = await site.getAttribute('href')
  expect(siteHref).toMatch(/^\/sites\/[0-9a-f-]{36}$/)
  await site.click()
  await expect(page).toHaveURL(new URL(siteHref!, page.url()).href)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  // `exact` because the row also carries a "View … on the live site" link whose
  // accessible name contains the page's title — which is the right name for a
  // screen reader and an ambiguous locator for a substring match.
  const target = page.getByRole('link', { name: 'A page served by cms-v2', exact: true }),
    pageHref = await target.getAttribute('href')
  expect(pageHref).toMatch(/^\/pages\/[0-9a-f-]{36}$/)
  await target.click()
  await expect(page).toHaveURL(new URL(pageHref!, page.url()).href)
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()
  await expect(canvas(page).locator('h1')).toBeVisible()
}

/** The editing canvas. Reachable because it is same-origin (v1 D1). */
export function canvas(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Page canvas"]')
}

/** A real caret click at the last character, relative to the target rather
 * than a cached iframe origin. Selecting a section can resize the editor's
 * toolbar; locator.click waits for that target to settle before dispatching. */
export async function clickAtTextEnd(element: Locator): Promise<void> {
  const point = await element.evaluate(async node => {
    await node.ownerDocument.fonts.ready
    const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    while (walker.nextNode()) last = walker.currentNode as Text
    if (!last) throw new Error('A caret target must contain text.')
    const range = node.ownerDocument.createRange()
    range.setStart(last, last.length)
    range.collapse(true)
    const caret = range.getBoundingClientRect(),
      target = node.getBoundingClientRect()
    return { x: Math.max(0, caret.x - target.x - 1), y: caret.y + caret.height / 2 - target.y, width: target.width }
  })
  const box = await element.boundingBox()
  if (!box || !point.width) throw new Error('The caret target must be visible.')
  const scale = box.width / point.width
  await element.click({ position: { x: point.x * scale, y: point.y * scale } })
}

/** Real pointer travel across the frame boundary. A second move over the
 * receiving document reliably lets dragover accept the drop in every engine:
 * https://playwright.dev/docs/input#dragging-manually */
export async function dragLibraryCardToCanvas(page: Page, card: Locator, target: Locator) {
  await card.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const source = await card.boundingBox(),
    destination = await target.boundingBox()
  if (!source || !destination) throw new Error('The library card and canvas section must be visible before dragging.')
  const x = destination.x + Math.min(30, destination.width / 4)
  const y = destination.y + Math.min(15, destination.height / 4)
  await page.mouse.move(source.x + 20, source.y + 20)
  await page.mouse.down()
  await page.mouse.move(source.x + 40, source.y + 35, { steps: 4 })
  await page.mouse.move(x, y, { steps: 15 })
  await page.mouse.move(x + 1, y + 1)
  await expect(canvas(page).locator('[data-cms-drop-line]')).toBeVisible()
  await page.mouse.up()
}

/** Select a slot the way a person does: by clicking it on the page. */
export async function clickOnCanvas(page: Page, slot: string): Promise<void> {
  await canvas(page).locator(`[data-cms-slot="${slot}"]`).first().click()
  await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible()
}

/** Type into the inspector field for a selected slot. */
export async function typeInInspector(page: Page, section: number, slot: string, value: string): Promise<void> {
  await page.locator(`#slot-${section}-${slot}`).fill(value)
}

/** The saved-state indicator, not the toast that also says "All changes saved". */
export function savedState(page: Page) {
  return page.locator('.saved-state')
}

/** Section rows in the structure tree, excluding the move buttons beside them. */
export function treeLabels(page: Page) {
  return page.getByRole('complementary', { name: 'Page structure' }).locator('.tree-label')
}

/** The persistent Add control in the structure pane, not a hidden insertion gap. */
export function addSectionButton(page: Page) {
  return page
    .getByRole('complementary', { name: 'Page structure' })
    .getByRole('button', { name: 'Add at end', exact: true })
}

export async function saveDraft(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Save draft' })
  const browser = page.context().browser()?.browserType().name()
  const acknowledgement =
    browser === 'webkit' || browser === 'firefox'
      ? page.waitForResponse(
          response =>
            response.request().method() === 'POST' && new URL(response.url()).pathname === new URL(page.url()).pathname,
        )
      : null
  await button.click()
  // A Server Action can deliver the saved result before its refreshed RSC
  // stream has finished. Reloading on the toast alone aborts that stream and
  // Safari/Firefox report an aborted input stream despite a saved checkpoint.
  // Their transports can await that stream; Chromium's request-finished signal
  // for this streamed response can remain pending after the UI acknowledges it.
  if (acknowledgement) await (await acknowledgement).finished()
  await expect(page.getByText('All changes saved. The live site is not affected.')).toBeVisible()
  await expect(button).toBeEnabled()
}

export async function publish(page: Page): Promise<void> {
  const path = new URL(page.url()).pathname,
    acknowledgements: Response[] = []
  const browser = page.context().browser()?.browserType().name()
  const observe = (response: Response) => {
    if (response.request().method() === 'POST' && new URL(response.url()).pathname === path)
      acknowledgements.push(response)
  }
  page.on('response', observe)
  try {
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Publish this page', exact: true })
    await expect(review).toBeVisible()
    await review.getByRole('button', { name: 'Publish', exact: true }).click()
    const samples = page.getByRole('dialog', { name: 'Publish with sample content?', exact: true })
    await expect
      .poll(
        async () =>
          (await samples.isVisible()) ||
          (await page.getByText('Published. The live page now shows these changes.').isVisible()),
      )
      .toBe(true)
    if (await samples.isVisible()) {
      await expect(samples.getByRole('listitem').first()).toContainText(/sample field/)
      await samples.getByRole('button', { name: 'Publish with sample content', exact: true }).click()
    }
    await expect(page.getByText('Published. The live page now shows these changes.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()
    if (browser === 'firefox' || browser === 'webkit')
      for (const response of acknowledgements) expect(await response.finished()).toBeNull()
  } finally {
    page.off('response', observe)
  }
}

/** Read what the public renderer actually serves, with no browser involved. */
export function fetchPublic(path = '/', extraHeaders?: Record<string, string>): Promise<RawResponse> {
  return rawRequest({ host: STAGING_HOST, path, port: SITE_PORT, extraHeaders })
}

/**
 * Delete the selected section, through the product's own confirmation.
 *
 * It used to be `page.on('dialog', d => d.accept())`, which is how you answer
 * `window.confirm`. The editor now raises its own `alertdialog` — for the
 * reasons in `components/confirm.tsx` — so a native-dialog handler is inert and
 * the section quietly never goes. `exact` on the first control matters: without
 * it "Delete" also matches the dialog's "Delete section".
 */
export async function deleteSelectedSection(page: Page): Promise<void> {
  const actions = page.getByRole('toolbar', { name: 'Selected section actions', exact: true })
  await actions.getByLabel('More section actions', { exact: true }).click()
  await actions.getByRole('button', { name: 'Delete section', exact: true }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete section' }).click()
  await expect(confirm).toBeHidden()
}

/** Put the seeded home page back the way the seed left it. */
export async function restoreSeededContent(page: Page): Promise<void> {
  await clickOnCanvas(page, 'heading')
  await typeInInspector(page, 0, 'heading', 'A page served by cms-v2')
  await saveDraft(page)
  await publish(page)
}

/** The preview choice moved into Preview in revision 8. */
export async function setPreviewSiteLook(page: Page, context: 'draft' | 'published') {
  const choice = page.getByLabel('Preview with saved site-look changes', { exact: true })
  if (!(await choice.isVisible())) await page.getByLabel('Preview', { exact: true }).click()
  await choice.setChecked(context === 'draft')
  await page.getByLabel('Preview', { exact: true }).click()
}
export async function openPageSettings(page: Page) {
  await page.getByLabel('More page actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Page settings', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Page settings', exact: true })).toBeVisible()
}
