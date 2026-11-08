// The M1 acceptance loop, driven through a real browser (SPEC §6.3, §6.4, §9).
//
// Input goes through the same path a person's does — real clicks, real typing,
// standard key names — because v1's D1 and D13 were both cases of a synthesized
// input path producing a convincing false result. Consequential findings are
// confirmed through a second path: the browser says the page published, and a
// raw socket with no browser confirms what the internet actually receives.
import { expect } from '@playwright/test'
import { test } from './fixtures/shared-demo-home.ts'
import {
  canvas,
  clickOnCanvas,
  deleteSelectedSection,
  fetchPublic,
  publish,
  saveDraft,
  savedState,
  signIn,
  treeLabels,
  typeInInspector,
} from './helpers.ts'

async function openSeededPage(page: import('@playwright/test').Page) {
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(canvas(page).locator('h1')).toBeVisible()
}

test.describe('edit → save → publish', () => {
  test('a draft save changes nothing on the live site until it is published', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await openSeededPage(page)

    const heading = `Draft only ${Date.now()}`
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', heading)
    await expect(page.getByText('Unsaved changes')).toBeVisible()

    await saveDraft(page)

    // The claim the UI just made, verified independently.
    expect((await fetchPublic()).body).not.toContain(heading)
  })

  test('publishing puts the content on the live page, JavaScript disabled', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await openSeededPage(page)

    const heading = `Published ${Date.now()}`
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', heading)
    await expect(page.getByText('Changes not live', { exact: true })).toBeVisible()
    await saveDraft(page)
    // Saving a draft is not publishing it; the toolbar must keep those states
    // separate even though both operations succeeded.
    await expect(page.getByText('Changes not live', { exact: true })).toBeVisible()
    await publish(page)
    await expect(page.getByText('Changes not live', { exact: true })).toHaveCount(0)

    const live = await fetchPublic()
    expect(live.status).toBe(200)
    expect(live.body).toContain(`<h1>${heading}</h1>`)
    // No browser ran to produce that: the content is in the response itself.
    expect(live.body).not.toMatch(/<script/i)
  })

  test('the saved-state indicator is truthful, not a timer', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await openSeededPage(page)

    await expect(savedState(page)).toHaveText('All changes saved')
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', `Dirty ${Date.now()}`)
    await expect(savedState(page)).toHaveText('Unsaved changes')

    // Autosave gets there on its own, without anyone pressing anything.
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
  })

  test('a section deleted and left to autosave leaves the page showing what was saved', async ({ page }) => {
    await signIn(page, 'root@example.test')
    await openSeededPage(page)

    /** Which stored version the canvas is showing, without the cache-busting suffix. */
    const rendering = async () => (await page.locator('iframe[title="Page canvas"]').getAttribute('src'))!.split('?')[0]
    const before = await rendering()
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(3)

    await treeLabels(page).first().click()
    await deleteSelectedSection(page)
    await expect(treeLabels(page)).toHaveCount(2)

    // Nobody presses Save here. The canvas is a render of a stored version, so
    // it can only catch up once the autosave has stored one — and it has to be
    // *that* version: re-rendering the one this page was served with put the
    // deleted section straight back on screen, which reads as a delete that
    // did not work rather than as a canvas a save behind.
    await expect(savedState(page)).toHaveText('Unsaved changes')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(2)
    await expect(canvas(page).locator('.cms-section--hero')).toHaveCount(0)
    expect(await rendering()).not.toBe(before)

    // And undo restores it everywhere, including the one place somebody is
    // looking — the same round trip in the other direction.
    await page.keyboard.press('ControlOrMeta+z')
    await expect(treeLabels(page)).toHaveCount(3)
    await expect(savedState(page)).toHaveText('Unsaved changes')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(3)
    await expect(canvas(page).locator('.cms-section--hero h1')).not.toBeEmpty()
  })

  test('opening a page and leaving it never claims unsaved changes (v1 D2)', async ({ page }) => {
    await signIn(page, 'editor@example.test')
    await openSeededPage(page)
    await expect(savedState(page)).toHaveText('All changes saved')

    await page.reload()
    await expect(savedState(page)).toHaveText('All changes saved')
  })

  test('a hidden section survives save and reload, is omitted publicly, and can be restored', async ({ page }) => {
    await signIn(page, 'root@example.test')
    await openSeededPage(page)

    await treeLabels(page).first().click()
    await page
      .getByRole('toolbar', { name: 'Selected section actions', exact: true })
      .getByRole('button', { name: 'Hide until ready', exact: true })
      .click()
    await saveDraft(page)
    await page.reload()

    await expect(
      page.getByRole('complementary', { name: 'Page structure' }).locator('.tree-section.is-hidden'),
    ).toHaveCount(1)
    await expect(canvas(page).locator('.cms-section--hero')).toBeVisible()
    await expect(page.locator('.canvas-visibility-note')).toContainText(
      '1 section is hidden from visitors. Shown here for editing.',
    )
    const hiddenHeading = `Not announced ${Date.now()}`
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', hiddenHeading)
    await saveDraft(page)
    await expect(canvas(page).locator('h1')).toHaveText(hiddenHeading)

    // Preview controls do not change the saved visibility or history evidence.
    const previewSrc = (await page.locator('iframe[title="Page canvas"]').getAttribute('src'))!
    const history = await page.evaluate(async url => {
      const response = await fetch(url, { credentials: 'same-origin' })
      return { status: response.status, body: await response.text() }
    }, `${previewSrc}&readonly=1`)
    expect(history.status).toBe(200)
    expect(history.body).not.toContain(hiddenHeading)
    await page.getByRole('button', { name: 'Preview without hidden', exact: true }).click()
    await expect(canvas(page).locator('.cms-section--hero')).toHaveCount(0)
    await page.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect(canvas(page).locator('h1')).toHaveText(hiddenHeading)
    await expect(
      page.getByRole('complementary', { name: 'Page structure' }).locator('.tree-section.is-hidden'),
    ).toHaveCount(1)

    // Draft-only hiding does not change what is already live.
    const liveMain = (html: string) => html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? ''
    expect(liveMain((await fetchPublic()).body)).toContain('cms-section--hero')

    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Publish this page', exact: true })
      .getByRole('button', { name: 'Publish', exact: true })
      .click()
    await expect(page.getByText('This page is not ready to publish yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Publish anyway…' }).click()
    const exception = page.getByRole('dialog', { name: 'Publish despite the readiness warning?' })
    await exception.getByLabel('Reason for publishing').fill('Verify that a hidden section is omitted publicly.')
    await exception.getByRole('button', { name: 'Publish and record reason' }).click()
    await expect(page.getByText('Published. The live page now shows these changes.')).toBeVisible()
    expect(liveMain((await fetchPublic()).body)).not.toContain('cms-section--hero')
    expect((await fetchPublic()).body).not.toContain(hiddenHeading)

    // The dimmed structure row remains the recovery path after reload.
    const heroName = (await treeLabels(page).first().getAttribute('aria-label'))!
    await page.getByRole('button', { name: 'Actions for ' + heroName, exact: true }).click()
    await page.getByRole('button', { name: 'Show ' + heroName, exact: true }).click()
    await saveDraft(page)
    await publish(page)
    expect(liveMain((await fetchPublic()).body)).toContain('cms-section--hero')
  })
})

test.describe('concurrent editing', () => {
  test('a stale save is refused and the local draft is kept', async ({ browser }) => {
    const first = await browser.newPage()
    const second = await browser.newPage()

    await signIn(first, 'editor@example.test')
    await openSeededPage(first)
    await signIn(second, 'editor@example.test')
    await openSeededPage(second)

    // The second tab saves, moving the head past what the first tab loaded.
    await clickOnCanvas(second, 'heading')
    await typeInInspector(second, 0, 'heading', `Winner ${Date.now()}`)
    await saveDraft(second)

    const losing = `Loser ${Date.now()}`
    await clickOnCanvas(first, 'heading')
    await typeInInspector(first, 0, 'heading', losing)
    await first.getByRole('button', { name: 'Save draft' }).click()

    await expect(first.getByText(/Someone else saved this page while you were editing/)).toBeVisible()
    // The whole point of the conflict copy: the work is still on screen.
    await expect(first.locator('#slot-0-heading')).toHaveValue(losing)
    await expect(canvas(first).locator('h1')).toHaveText(losing)

    await first.close()
    await second.close()
  })
})

test.describe('readiness', () => {
  test('removing the last custom-code escape hatch removes the approval requirement', async ({ page }) => {
    await signIn(page, 'root@example.test')
    await openSeededPage(page)

    await treeLabels(page).filter({ hasText: 'Call to action' }).click()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await page.getByText('Custom CSS for this section').click()
    const css = page.getByLabel('Custom CSS')
    await css.fill('.cta { outline: 1px solid red; }')
    await saveDraft(page)

    // Reload so the database's trusted-code flag is true at initialization —
    // this is the state that previously stayed sticky after the code was gone.
    await page.reload()
    await treeLabels(page).filter({ hasText: 'Call to action' }).click()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await page.getByText('Custom CSS for this section').click()
    await expect(page.getByText(/super admin has to look at it/).first()).toBeVisible()
    await page.getByLabel('Custom CSS').fill('')
    await saveDraft(page)

    await expect(page.getByText(/super admin has to look at it/)).toHaveCount(0)
    await publish(page)
  })

  test('blocks a publish with nothing to show, in plain language', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await signIn(page, 'root@example.test')
    await openSeededPage(page)

    // Delete every section: nothing to render, so nothing to publish.
    for (let i = 0; i < 3; i += 1) {
      await treeLabels(page).first().click()
      await deleteSelectedSection(page)
      await expect(page.getByText('Updating page preview…', { exact: true })).toHaveCount(0)
      await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
    }

    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Publish this page', exact: true })
      .getByRole('button', { name: 'Publish', exact: true })
      .click()
    await expect(page.getByText('This page is not ready to publish yet.')).toBeVisible()

    // Editor-facing copy never uses the internal vocabulary (SPEC §7).
    const notices = await page.locator('.notice').allInnerTexts()
    expect(notices.join(' ')).not.toMatch(/renderer|revision|CAS|projection|manifest/i)
    await expect(page.getByRole('button', { name: 'Publish anyway…' })).toBeVisible()

    const exception = page.getByRole('dialog', { name: 'Publish despite the readiness warning?' })
    await page.getByRole('button', { name: 'Publish anyway…' }).click()
    await expect(exception.getByLabel('Reason for publishing')).toBeFocused()
    // The disabled confirm button is not part of the focus loop: Shift+Tab
    // reaches Cancel, and Tab returns to the field while the reason is blank.
    await page.keyboard.press('Shift+Tab')
    await expect(exception.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(exception.getByLabel('Reason for publishing')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(exception).toHaveCount(0)

    // Put the shared fixture back with the undo stack, which is already proved
    // to restore deleted sections with their content. The canvas re-renders
    // once the save lands, because the document's shape changed.
    expect(errors).toEqual([])
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ControlOrMeta+z')
    await expect(treeLabels(page)).toHaveCount(3)
    await saveDraft(page)
    await expect(canvas(page).locator('h1')).toBeVisible()
    await publish(page)
  })
})
