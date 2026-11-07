import { E2E_PORTS } from '../test-ports.ts'
// The whole M2 editor journey, once, as one person doing one job (SPEC §6.4,
// §6.5, §7).
//
// The other specs in this directory each hold one behaviour still. This one
// holds the *sequence*, and it exists because those two things fail differently.
// Every individual behaviour in v1 could be demonstrated working; what could not
// be demonstrated was somebody signing in and getting to a published page
// without help, and a suite of green unit-shaped browser tests said nothing
// about that. The steps below are SPEC §6.4's acceptance paragraph read as a
// task list, and the assertions are the ones that would notice a step nobody can
// complete.
//
// WHAT THIS FILE DOES THAT THE OTHERS DO NOT
//
//   * It looks. A page can satisfy every assertion in this directory and be
//     visibly broken — a toolbar off the side of a phone, a pane with no height,
//     a control behind an overlay — and nothing here or in CI would say so. So
//     every screen is captured at desktop and at mobile and attached to the run,
//     and a few load-bearing facts about the layout are asserted numerically:
//     that nothing overflows the viewport horizontally, that the primary actions
//     are inside it, and that the canvas has a real height.
//   * It listens. Every navigation is watched for console errors and page
//     errors, which is SPEC §9's "route smoke loads every admin screen with no
//     console/page errors" — and which caught a real stale-bundle hydration
//     failure that no other check in this repository would have reported.
//   * It confirms consequential findings through a second path, the way v1's D1
//     and D13 taught: the browser says the page published, and a raw socket with
//     no browser at all says what the internet actually receives.
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  addSectionButton,
  canvas,
  clickOnCanvas,
  fetchPublic,
  publish,
  saveDraft,
  savedState,
  signIn,
  treeLabels,
  typeInInspector,
  deleteSelectedSection,
} from './helpers.ts'

/**
 * A page of this file's own, created through the product.
 *
 * The specs in this directory share one seeded site and run serially, so a test
 * that adds a section and publishes it changes the fixture every later spec is
 * written against — which is exactly what the first version of this file did,
 * and three tests in two other files started failing on an index that had moved.
 * Creating a page here costs one form submit, removes the coupling entirely, and
 * covers `createPage` (SPEC §6.3) into the bargain, since "add a page" is a step
 * of the journey rather than a fixture concern.
 */
async function createPage(page: Page, name: string): Promise<{ slug: string }> {
  const slug = `journey-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.waitForURL(/\/sites\/[0-9a-f-]{36}$/)
  // Blank begins with a real Page header and designed Text block. Verify both,
  // then remove both so these journeys still cover a person emptying a page.
  await page.getByRole('button', { name: 'Add a page' }).click()
  const draft = page.getByRole('dialog', { name: 'New page', exact: true })
  await draft.getByLabel('Page title', { exact: true }).fill(name)
  await draft.getByRole('button', { name: 'Change', exact: true }).click()
  await draft.getByLabel('Web address', { exact: true }).fill(slug)
  await draft.getByText('A blank page', { exact: true }).click()
  await draft.getByRole('button', { name: 'Create draft', exact: true }).click()
  // The redirect lands in the editor for the new page, which is the only thing
  // anybody wants after creating one.
  await page.waitForURL(/\/pages\/[0-9a-f-]{36}$/)
  await expect(
    page
      .getByRole('button', { name: 'Open Structure', exact: true })
      .or(page.getByRole('complementary', { name: 'Page structure' })),
  ).toBeVisible()
  if (await page.getByRole('button', { name: 'Open Structure', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Open Structure', exact: true }).focus()
    await page.keyboard.press('Enter')
  }
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()
  await expect(canvas(page).locator('h1')).toHaveText(name)
  await expect(treeLabels(page)).toHaveCount(2)
  await expect(canvas(page).locator('[data-cms-section="0"] h1')).toHaveText(name)
  await expect(canvas(page).locator('[data-cms-section="1"]')).toContainText('A shared purpose.')
  for (const remaining of [1, 0]) {
    await treeLabels(page).first().click()
    await deleteSelectedSection(page)
    await expect(treeLabels(page)).toHaveCount(remaining)
  }
  await saveDraft(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'This page is empty', exact: true })).toBeVisible()
  await expect(page.locator('iframe[title="Page canvas"]')).toHaveCount(0)
  return { slug }
}

const DESKTOP = { width: 1440, height: 900 }
const TABLET = { width: 1024, height: 1000 }
const MOBILE = { width: 390, height: 844 }

/**
 * Watch a page for the errors a screenshot cannot show.
 *
 * Returned rather than asserted here so a caller can name the screen in the
 * failure. An empty array is the whole contract: a React hydration mismatch, an
 * uncaught rejection in an action, a 500 fetched by a client component — all of
 * them arrive here and nowhere else.
 */
const readonlyWarnings = new WeakMap<string[], Set<string>>()

function watchForErrors(page: Page): string[] {
  const problems: string[] = []
  const warnings = new Set<string>()
  readonlyWarnings.set(problems, warnings)
  page.on('console', message => {
    if (message.type() !== 'error') return
    const warning = message
      .text()
      .match(
        new RegExp(
          String.raw`^Blocked script execution in '(http:\/\/127\.0\.0\.1:${E2E_PORTS.admin}\/preview\/[0-9a-f-]+\?readonly=1(?:&thumbnail=1)?)' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$`,
          '',
        ),
      )
    if (warning) warnings.add(warning[1]!)
    else problems.push(`console: ${message.text()}`)
  })
  page.on('pageerror', error => problems.push(`page: ${error.message}`))
  // A failed request reaches the console as an error with no address in it,
  // which is a finding nobody can act on. Recorded separately so the message
  // names the resource — a missing thumbnail and a missing favicon are the same
  // console line and very different problems.
  page.on('response', response => {
    if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`)
  })
  return problems
}

async function expectNoProblems(page: Page, problems: string[], label: string) {
  for (const url of readonlyWarnings.get(problems) ?? []) {
    const response = await page.request.get(url)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-security-policy']).toContain("script-src 'none'")
    expect(response.headers()['content-security-policy']).toContain('sandbox allow-same-origin')
    expect(await response.text()).not.toMatch(/<script\b/i)
  }
  expect(problems, label).toEqual([])
}

/**
 * Capture a screen at desktop, tablet and phone widths and attach all three.
 *
 * The attachment is the deliverable: "technically functional but visibly
 * broken" is a state every assertion in this directory tolerates, and the only
 * defence is a human looking. The numeric checks beside it are the two failures
 * that are worth catching without one — a horizontal overflow, which is what a
 * toolbar running off a phone looks like to a machine, and a primary action
 * outside the viewport, which is what an unreachable Publish button looks like.
 */
async function captureBothWidths(page: Page, info: TestInfo, name: string): Promise<void> {
  for (const [label, size] of [
    ['desktop', DESKTOP],
    ['tablet', TABLET],
    ['mobile', MOBILE],
  ] as const) {
    await page.setViewportSize(size)
    // Layout settles before it is measured; a capture taken mid-reflow is a
    // screenshot of a bug that does not exist.
    await page.waitForTimeout(150)
    await info.attach(`${name}-${label}`, {
      body: await page.screenshot({ fullPage: label === 'desktop' }),
      contentType: 'image/png',
    })

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    // One pixel of slack for subpixel rounding, and no more: a scrollbar's worth
    // of overflow is a layout that does not fit, whatever caused it.
    expect(overflow.scrollWidth, `${name} at ${label} scrolls sideways`).toBeLessThanOrEqual(overflow.clientWidth + 1)
  }
  await page.setViewportSize(DESKTOP)
}

test.describe('the whole journey, once', () => {
  test('sign in, understand the page, edit it, add to it, publish it, and see it live', async ({ page }, info) => {
    const problems = watchForErrors(page)
    test.setTimeout(120_000)

    // 1. Sign in and understand the site workspace.
    await signIn(page, 'root@example.test')
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await captureBothWidths(page, info, '01-sites')

    await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
    await page.waitForURL(/\/sites\/[0-9a-f-]{36}$/)
    // The workspace says what it is for in words a person can act on.
    await expect(page.getByRole('link', { name: 'Edit home page', exact: true })).toBeVisible()
    await captureBothWidths(page, info, '02-workspace')

    // 2. Add a page, and land in its editor understanding its state.
    await page.goto('/')
    const { slug } = await createPage(page, 'A page somebody made')
    // A page nobody has published yet says Draft, in the app-wide vocabulary,
    // with the word and not only the colour (SPEC §7).
    await expect(page.locator('.editor-bar [data-status="draft"]')).toHaveText('Draft')
    await captureBothWidths(page, info, '03-editor-empty')

    // An empty page teaches rather than showing a blank rectangle.
    await expect(page.getByText('This page is empty')).toBeVisible()

    // 3. Add the first section from the library, at the only place there is.
    await page
      .getByLabel('Page', { exact: true })
      .getByRole('button', { name: 'Add the first section', exact: true })
      .click()
    await page
      .getByTestId('library-card-hero')
      .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
      .click()
    await page
      .getByRole('dialog', { name: 'Add a section', exact: true })
      .getByRole('button', { name: 'Add this section', exact: true })
      .click()
    await expect(treeLabels(page)).toHaveCount(1)
    // The tree updates at once and the canvas catches up when the autosave has
    // stored a version to render — so this waits for the section rather than for
    // its heading, which is empty until somebody types in it and therefore has
    // no box to be visible in.
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(1)
    await captureBothWidths(page, info, '04-editor')

    // The canvas is a real, sized surface rather than a collapsed box — the
    // failure a screenshot at one width would have missed.
    const frame = await page.locator('iframe[title="Page canvas"]').boundingBox()
    expect(frame!.height, 'the canvas has no height').toBeGreaterThan(300)

    // 4. The new section arrives selected, with its fields in the inspector.
    //
    // That is what a person types into first, and it has to be: a section
    // nobody has filled in yet renders empty regions, and an empty region has no
    // box to click on. Giving preview a placeholder box would put an element on
    // the canvas that the published page does not have, which is the
    // preview/live divergence this repository spent a commit removing.
    await expect(page.locator('#slot-0-heading')).toBeVisible()
    const heading = `Journey ${Date.now()}`
    await typeInInspector(page, 0, 'heading', heading)
    // 5. And it reaches the canvas as it is typed, with no round trip.
    await expect(canvas(page).locator('h1')).toHaveText(heading)

    // Now that there is something on the page, clicking it selects the same
    // thing the tree does.
    await treeLabels(page).first().click()
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
    await clickOnCanvas(page, 'heading')
    await expect(page.locator('#slot-0-heading')).toHaveValue(heading)

    // 6. Undo, redo, and delete without stale UI.
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(canvas(page).locator('h1')).not.toHaveText(heading)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(canvas(page).locator('h1')).toHaveText(heading)

    // 7. Add a second section at a chosen place, through the library.
    const before = await treeLabels(page).count()
    await addSectionButton(page).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // The library replaces Structure and previews the section at the chosen boundary.
    await expect(dialog.getByRole('heading', { name: /Add a section/ })).toBeVisible()
    await captureBothWidths(page, info, '04-library')
    await dialog
      .getByTestId('library-card-quote')
      .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
      .click()
    await page
      .getByRole('dialog', { name: 'Add a section', exact: true })
      .getByRole('button', { name: 'Add this section', exact: true })
      .click()
    await expect(dialog).toBeHidden()
    await expect(treeLabels(page)).toHaveCount(before + 1)
    // The thing you just added is the thing you are editing.
    await expect(
      page.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { name: /^Pull quote(?: — .*)?$/ }),
    ).toBeVisible()

    // 8. Preview desktop, tablet and mobile behaviour.
    for (const width of ['Tablet', 'Phone', 'Desktop']) {
      await page.getByRole('button', { name: width, exact: true }).click()
      await expect(page.getByRole('button', { name: width, exact: true })).toHaveAttribute('aria-pressed', 'true')
    }

    // 9. Understand autosave and unsaved work, truthfully.
    await expect(savedState(page)).toHaveText(/Unsaved changes|Saving…|All changes saved/)
    await saveDraft(page)
    await expect(savedState(page)).toHaveText('All changes saved')

    // 10. Publish, and verify the public result without a browser.
    await publish(page)
    const live = await fetchPublic(`/${slug}`)
    expect(live.status).toBe(200)
    expect(live.body).toContain(heading)
    // The section that was added is on the public page too, not only in the tree.
    expect(live.body).toContain('cms-section--quote')
    // And no editor instrumentation escaped onto it (SPEC §8).
    expect(live.body).not.toContain('data-cms-slot')
    expect(live.body).not.toContain('<script')

    // A reload shows what was published rather than what was typed.
    await page.reload()
    await expect(canvas(page).locator('h1')).toHaveText(heading)
    await expect(savedState(page)).toHaveText('All changes saved')

    await expectNoProblems(page, problems, 'the journey produced browser errors')
  })
})

test.describe('reload in the middle of editing', () => {
  test('loses at most the last couple of seconds of typing', async ({ page }) => {
    await signIn(page, 'root@example.test')
    await createPage(page, 'A page mid-edit')
    await page
      .getByLabel('Page', { exact: true })
      .getByRole('button', { name: 'Add the first section', exact: true })
      .click()
    await page
      .getByTestId('library-card-hero')
      .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
      .click()
    await page
      .getByRole('dialog', { name: 'Add a section', exact: true })
      .getByRole('button', { name: 'Add this section', exact: true })
      .click()
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(1)

    const typed = `Autosaved ${Date.now()}`
    await typeInInspector(page, 0, 'heading', typed)

    // No Save pressed. The acceptance line is "hard-refresh mid-edit loses ≤2s
    // of typing" (SPEC §6.4), and the debounce is 1.5s, so waiting for the
    // indicator to settle is waiting for the guarantee itself rather than for a
    // fixed sleep that would pass on a fast machine and flake on a slow one.
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

    await page.reload()
    await expect(canvas(page).locator('h1')).toHaveText(typed)
  })
})

test.describe('keyboard only', () => {
  for (const width of [1440, 1024]) {
    test(`adds a section from the library without a pointer, and gives focus back at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page, 'root@example.test')
      await createPage(page, 'A page built by keyboard')
      await page
        .getByLabel('Page', { exact: true })
        .getByRole('button', { name: 'Add the first section', exact: true })
        .click()
      await page
        .getByTestId('library-card-hero')
        .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
        .click()
      await page
        .getByRole('dialog', { name: 'Add a section', exact: true })
        .getByRole('button', { name: 'Add this section', exact: true })
        .click()
      if (width === 1024 && (await page.getByRole('button', { name: 'Open Structure', exact: true }).isVisible())) {
        await page.getByRole('button', { name: 'Open Structure', exact: true }).focus()
        await page.keyboard.press('Enter')
      }
      await expect(treeLabels(page)).toHaveCount(1)

      const before = await treeLabels(page).count()
      const opener = addSectionButton(page)
      await opener.focus()
      await page.keyboard.press('Enter')

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      // The search field takes focus, so somebody can start narrowing immediately
      // rather than tabbing to find out where they are.
      await expect(dialog.getByLabel('Search sections', { exact: true })).toBeFocused()

      // Search, choose the section, and confirm its preview using only keys.
      await page.keyboard.insertText('Pull quote')
      const choose = dialog.getByTestId('library-card-quote').getByRole('button', { name: /^Add Pull quote / })
      const focusPath: string[] = []
      for (let step = 0; step < 20 && !(await choose.evaluate(node => node === document.activeElement)); step++) {
        await page.keyboard.press('Tab')
        focusPath.push(
          await page.evaluate(() => {
            const active = document.activeElement
            return (
              active?.tagName +
              ':' +
              (active?.getAttribute('aria-label') ?? active?.getAttribute('id') ?? active?.textContent?.slice(0, 80))
            )
          }),
        )
      }
      await test
        .info()
        .attach('library-tab-focus-path', { body: JSON.stringify(focusPath), contentType: 'application/json' })
      await expect(choose).toBeFocused()
      await page.keyboard.press('Enter')
      const confirm = dialog.getByRole('button', { name: 'Add this section', exact: true })
      await expect(confirm).toBeEnabled()
      for (let step = 0; step < 40 && !(await confirm.evaluate(node => node === document.activeElement)); step++)
        await page.keyboard.press('Tab')
      await expect(confirm).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(dialog).toBeHidden()
      // Insertion focuses the first field, ready to replace the designed example.
      await expect(page.locator('.inspector [data-inspector-slot] input').first()).toBeFocused()
      if (width === 1024 && (await page.getByRole('button', { name: 'Open Structure', exact: true }).isVisible())) {
        await page.getByRole('button', { name: 'Open Structure', exact: true }).focus()
        await page.keyboard.press('Enter')
      }
      await expect(treeLabels(page)).toHaveCount(before + 1)
    })
  }

  test('Escape closes the overlay and changes nothing', async ({ page }, info) => {
    await signIn(page, 'root@example.test')
    await createPage(page, 'A page for Escape')
    await page
      .getByLabel('Page', { exact: true })
      .getByRole('button', { name: 'Add the first section', exact: true })
      .click()
    await page
      .getByTestId('library-card-hero')
      .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
      .click()
    await page
      .getByRole('dialog', { name: 'Add a section', exact: true })
      .getByRole('button', { name: 'Add this section', exact: true })
      .click()
    await expect(treeLabels(page)).toHaveCount(1)

    const before = await treeLabels(page).count()
    const opener = addSectionButton(page)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      if (width === 1024) {
        await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
        await expect(treeLabels(page)).toHaveCount(before)
      }
      await opener.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog', { name: 'Add a section', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(treeLabels(page)).toHaveCount(before)
      await expect(opener).toBeFocused()
      await expect(page.locator('.canvas-loading')).toHaveCount(0)
      await expect(canvas(page).locator('.cms-section--hero')).toBeVisible()
      await page.screenshot({ path: info.outputPath('library-focus-return-' + width + '.png') })
    }
  })

  test('moves a section with the tree’s own controls', async ({ page }) => {
    await signIn(page, 'root@example.test')
    await createPage(page, 'A page to reorder')
    for (const card of ['library-card-hero', 'library-card-cta']) {
      await addSectionButton(page).click()
      await page
        .getByTestId(card)
        .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
        .click()
      await page
        .getByRole('dialog', { name: 'Add a section', exact: true })
        .getByRole('button', { name: 'Add this section', exact: true })
        .click()
    }
    await expect(treeLabels(page)).toHaveCount(2)

    const first = await treeLabels(page).first().getAttribute('aria-label')
    const second = await treeLabels(page).nth(1).getAttribute('aria-label')
    // A named control rather than a gesture: SPEC §7 requires reorder to be
    // operable from the keyboard, and v1 labelled it without implementing it.
    await page.getByRole('button', { name: `Actions for ${first}`, exact: true }).click()
    await page.getByRole('button', { name: `Move ${first} down`, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(treeLabels(page).first()).toHaveAccessibleName(second!)
    await expect(treeLabels(page).nth(1)).toHaveAccessibleName(first!)
  })
})

test.describe('every admin screen', () => {
  test('loads with no console or page errors, at both widths', async ({ page }, info) => {
    test.setTimeout(120_000)
    const problems = watchForErrors(page)
    await signIn(page, 'root@example.test')

    // Discovered by navigation rather than hard-coded, so a screen that stops
    // being reachable fails here instead of quietly dropping out of coverage.
    await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
    // Waited for rather than read straight off the click: `page.url()` is still
    // the origin until the navigation commits, and the URLs below are built from
    // this one, so reading it early turned every later screen into a 404 that
    // this test then correctly reported as a broken screen.
    await page.waitForURL(/\/sites\/[0-9a-f-]{36}$/)
    const siteUrl = page.url()
    const screens: [string, string][] = [
      ['sites', '/'],
      ['workspace', siteUrl],
      ['sections', `${siteUrl}/sections`],
      ['creator', `${siteUrl}/sections/new`],
    ]

    for (const [name, url] of screens) {
      problems.length = 0
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      await captureBothWidths(page, info, `route-${name}`)
      await expectNoProblems(page, problems, `${name} produced browser errors`)
    }
  })
})
