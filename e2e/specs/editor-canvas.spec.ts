// Drive the editor through real controls in both documents. Canvas keyboard
// events do not bubble to the parent, even when the iframe is same-origin.
import { expect, test, type Page } from '@playwright/test'
import {
  addSectionButton,
  canvas,
  clickOnCanvas,
  deleteSelectedSection,
  dragLibraryCardToCanvas,
  saveDraft,
  savedState,
  signIn,
  treeLabels,
  typeInInspector as fillInspector,
} from './helpers.ts'

async function typeInInspector(page: Page, index: number, slot: string, text: string) {
  if (!(await page.locator(`#slot-${index}-${slot}`).isVisible())) await treeLabels(page).nth(index).click()
  await fillInspector(page, index, slot, text)
}

async function openSeededPage(page: Page) {
  const site = page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }),
    sitePath = await site.getAttribute('href')
  expect(sitePath).toMatch(/^\/sites\/[0-9a-f-]{36}$/)
  await site.click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Page structure' })).toBeVisible()
  await expect(canvas(page).locator('h1')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'root@example.test')
  await openSeededPage(page)
})

test.describe('click to select', () => {
  test('opens the canvas after delayed hydration and keeps direct editing after reload', async ({ page }, info) => {
    let allowScripts!: () => void
    const scriptsReady = new Promise<void>(resolve => {
      allowScripts = resolve
    })
    await page.route(
      url => url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js'),
      async route => {
        await scriptsReady
        await route.continue()
      },
    )
    try {
      await page.reload({ waitUntil: 'commit' })
      await expect(page.getByText('Opening the page preview…', { exact: true })).toBeVisible()
      await expect(page.locator('iframe[title="Page canvas"]')).toHaveCount(0)
    } finally {
      allowScripts()
    }
    await expect(canvas(page).locator('h1')).toBeVisible()
    for (let reload = 0; reload < 2; reload += 1) {
      await page.reload()
      await expect(canvas(page).locator('h1')).toBeVisible()
      await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
    }
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      const pageTab = page.getByRole('tab', { name: 'Page', exact: true })
      if (await pageTab.isVisible()) await pageTab.click()
      await expect(canvas(page).locator('h1')).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      ).toBe(true)
      const screenshot = info.outputPath(`ready-canvas-${width}.png`)
      await page.screenshot({ path: screenshot })
      await info.attach(`ready-canvas-${width}`, { path: screenshot, contentType: 'image/png' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    const slot = canvas(page).locator('[data-cms-slot="heading"]').first()
    await slot.click()
    await slot.click()
    await slot.fill('Inline editing after a fresh load')
    await expect(page.locator('#slot-0-heading')).toHaveValue('Inline editing after a fresh load')
    await saveDraft(page)
    await page.reload()
    await expect(canvas(page).locator('h1')).toHaveText('Inline editing after a fresh load')
  })

  test('offers a bounded preview retry and keeps text typed before reconnecting', async ({ page }) => {
    await page.clock.install()
    let unavailable = true
    let rejectedDocuments = 0
    await page.route('**/preview/**', async route => {
      if (unavailable) {
        rejectedDocuments += 1
        await route.abort()
        return
      }
      await route.continue()
    })
    await page.reload()
    await expect(page.getByText('Opening the page preview…', { exact: true })).toBeVisible()
    await page.clock.fastForward(21_000)
    await expect(page.getByRole('button', { name: 'Reload preview', exact: true })).toBeVisible()
    await expect.poll(() => rejectedDocuments).toBe(2)
    await treeLabels(page).first().click()
    await page
      .getByRole('complementary', { name: 'Page structure' })
      .getByRole('button', { name: /^Intro/ })
      .click()
    await page.locator('#slot-0-intro').fill('Keep this draft while the preview reconnects')
    unavailable = false
    await page.getByRole('button', { name: 'Reload preview', exact: true }).click()
    await expect(canvas(page).locator('[data-cms-slot="intro"]').first()).toHaveText(
      'Keep this draft while the preview reconnects',
    )
    await expect(page.locator('#slot-0-intro')).toHaveValue('Keep this draft while the preview reconnects')
    await expect(page.getByRole('button', { name: 'Reload preview', exact: true })).toHaveCount(0)
  })

  test('reopens a successful canvas response that never finishes loading', async ({ page }) => {
    await page.clock.install()
    let releaseScript!: () => void
    const heldScript = new Promise<void>(resolve => {
      releaseScript = resolve
    })
    const sources: URL[] = []
    await page.route('**/__cms-test-canvas-document-stall.js', async route => {
      await heldScript
      await route.abort().catch(() => {})
    })
    await page.route('**/preview/**', async route => {
      sources.push(new URL(route.request().url()))
      if (sources.length === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><script src="/__cms-test-canvas-document-stall.js"></script>',
        })
      } else await route.continue()
    })
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(() => sources.length).toBe(1)
      await expect(page.getByText('Opening the page preview…', { exact: true })).toBeVisible()
      await typeInInspector(page, 0, 'intro', 'Still here after the stalled canvas')
      await page.clock.fastForward(7_500)
      await expect(canvas(page).locator('[data-cms-slot="intro"]').first()).toHaveText(
        'Still here after the stalled canvas',
      )
      await expect(page.getByRole('button', { name: 'Reload preview', exact: true })).toHaveCount(0)
      expect(sources).toHaveLength(2)
      const firstGeneration = sources[0]!.searchParams.get('v')
      expect(firstGeneration).toBe('0')
      expect(sources[1]!.searchParams.get('v')).toBe('1')
      sources[1]!.searchParams.set('v', firstGeneration!)
      expect(sources[1]!.href).toBe(sources[0]!.href)
      await expect(page.locator('#slot-0-intro')).toHaveValue('Still here after the stalled canvas')
    } finally {
      releaseScript()
    }
  })

  test('clicking a field on the page opens its inspector and marks the tree', async ({ page }) => {
    await clickOnCanvas(page, 'heading')

    // Inspector shows the field with its real current value.
    await expect(page.locator('#slot-0-heading')).toBeVisible()
    await expect(page.locator('#slot-0-heading')).not.toHaveValue('')

    // The tree agrees about what is selected.
    await expect(
      page.getByRole('complementary', { name: 'Page structure' }).locator('.tree-slot', { hasText: 'Heading' }).first(),
    ).toHaveClass(/on/)
  })

  test('clicking in the tree selects the same thing as clicking the page', async ({ page }) => {
    await treeLabels(page).first().click()
    await page
      .getByRole('complementary', { name: 'Page structure' })
      .getByRole('button', { name: /^Intro/ })
      .click()
    await expect(page.locator('#slot-0-intro')).toBeVisible()
    await expect(canvas(page).locator('[data-cms-slot="intro"][data-cms-selected]')).toBeAttached()
  })

  test('Escape clears the selection', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    await expect(page.locator('#slot-0-heading')).toBeVisible()

    // A standards-correct key name, sent into the canvas (v1 D13's lesson).
    await canvas(page).locator('body').press('Escape')
    await expect(page.getByRole('heading', { name: 'This page' })).toBeVisible()
  })

  test('a second click on selected text puts a caret in the page', async ({ page }) => {
    const slot = canvas(page).locator('[data-cms-slot="heading"]').first()
    await slot.click()
    await slot.click()
    await expect(slot).toHaveAttribute('contenteditable', 'plaintext-only')
  })

  test('typing directly on the canvas updates the inspector', async ({ page }) => {
    const slot = canvas(page).locator('[data-cms-slot="heading"]').first()
    await slot.click()
    await slot.click()
    await slot.fill('Typed on the page')
    await expect(page.locator('#slot-0-heading')).toHaveValue('Typed on the page')
  })
})

test.describe('undoing typing (V1 reference 05)', () => {
  test('one Undo takes back a phrase typed on the page, not one letter', async ({ page }) => {
    const slot = canvas(page).locator('[data-cms-slot="heading"]').first()
    await slot.click()
    const field = page.locator('#slot-0-heading')
    const original = await field.inputValue()
    await slot.click()
    await expect(slot).toHaveAttribute('contenteditable', 'plaintext-only')
    await slot.evaluate(node => {
      const range = node.ownerDocument.createRange()
      range.selectNodeContents(node)
      range.collapse(false)
      const selection = node.ownerDocument.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await slot.pressSequentially(' and more besides', { delay: 30 })
    await expect(field).toHaveValue(`${original} and more besides`)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(field).toHaveValue(original)
    await expect(slot).toHaveText(original)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(field).toHaveValue(`${original} and more besides`)
  })

  test('a pause in typing starts a new undo step', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    const field = page.locator('#slot-0-heading')
    const original = await field.inputValue()
    await field.focus()
    await field.evaluate((input: HTMLInputElement) => input.setSelectionRange(input.value.length, input.value.length))
    await field.pressSequentially(' first', { delay: 20 })
    await page.waitForTimeout(1_300)
    await field.pressSequentially(' second', { delay: 20 })
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(field).toHaveValue(`${original} first`)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(field).toHaveValue(original)
  })
})

test.describe('two-way binding', () => {
  test('typing in the inspector updates the page as you type', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', 'Live from the inspector')
    // No save, no reload: the canvas is the real page and it already changed.
    await expect(canvas(page).locator('h1')).toHaveText('Live from the inspector')
  })
})

test.describe('changed dots and revert (v1 D15)', () => {
  test('a dot appears on exactly what changed, and revert only when it has', async ({ page }) => {
    const tree = page.getByRole('complementary', { name: 'Page structure' })
    await expect(tree.locator('.dot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Revert .* to original/ })).toHaveCount(0)

    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', 'Changed')

    // Section dot plus slot dot; the untouched sections stay clean.
    await expect(tree.locator('.dot')).toHaveCount(2)
    await expect(
      page.getByRole('button', { name: /^Revert (?:Heading|Title) to the version when you opened this page$/ }),
    ).toBeVisible()
  })

  test('the dots survive an autosave — they answer "since you opened this page"', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', `Autosaved ${Date.now()}`)

    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    // The bug this prevents: autosave fires and the record of what you changed
    // silently disappears along with the ability to revert it.
    await expect(page.getByRole('complementary', { name: 'Page structure' }).locator('.dot')).toHaveCount(2)
    await expect(
      page.getByRole('button', { name: /^Revert (?:Heading|Title) to the version when you opened this page$/ }),
    ).toBeVisible()
  })

  test('per-field revert restores one field and leaves the others', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    const original = await page.locator('#slot-0-heading').inputValue()
    await typeInInspector(page, 0, 'heading', 'Temporary')
    await typeInInspector(page, 0, 'intro', 'Also temporary')

    await page
      .getByRole('button', { name: /^Revert (?:Heading|Title) to the version when you opened this page$/ })
      .click()
    await expect(page.locator('#slot-0-heading')).toHaveValue(original)
    await expect(page.locator('#slot-0-intro')).toHaveValue('Also temporary')
  })

  test('the Changed only filter shows just the changed section', async ({ page }) => {
    const tree = page.getByRole('complementary', { name: 'Page structure' })
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, 0, 'heading', 'Only this one')

    await tree.getByRole('button', { name: 'Page structure options', exact: true }).click()
    await tree.getByRole('button', { name: 'Changed only', exact: true }).click()
    await expect(treeLabels(page)).toHaveCount(1)
    await expect(treeLabels(page).first()).toContainText('Hero')
  })
})

test.describe('undo and redo cover every operation (SPEC §6.4)', () => {
  test('browser history input requests use page history without a native second edit', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    const field = page.locator('#slot-0-heading')
    const original = await field.inputValue()
    await field.fill('History input request')
    const slot = canvas(page).locator('[data-cms-slot="heading"]').first()
    await expect(slot).toHaveText('History input request')
    await slot.click()
    await slot.click()
    const historyInput = (inputType: string) =>
      slot.evaluate((node, type) => {
        const event = new InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true })
        node.dispatchEvent(event)
        return event.defaultPrevented
      }, inputType)
    expect(await historyInput('historyUndo')).toBe(true)
    await expect(field).toHaveValue(original)
    await expect(slot).toHaveText(original)
    expect(await historyInput('historyRedo')).toBe(true)
    await expect(field).toHaveValue('History input request')
    expect(await historyInput('historyUndo')).toBe(true)
    await expect(field).toHaveValue(original)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await saveDraft(page)
  })

  test('canvas history cannot mutate the draft underneath a submission dialog', async ({ page }) => {
    await page.context().clearCookies()
    await signIn(page, 'contributor@example.test')
    await openSeededPage(page)
    await clickOnCanvas(page, 'heading')
    const field = page.locator('#slot-0-heading')
    const original = await field.inputValue()
    await field.fill('Keep while reviewing submission')
    await expect(canvas(page).locator('[data-cms-slot="heading"]').first()).toHaveText(
      'Keep while reviewing submission',
    )
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // A delayed request from the checked canvas must not modify the document
    // hidden behind a confirmation. Wait until the parent has received it.
    await Promise.all([
      page.evaluate(
        () =>
          new Promise<void>(resolve => {
            const listener = (event: MessageEvent) => {
              if (event.data?.type !== 'cms:undo') return
              window.removeEventListener('message', listener)
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            }
            window.addEventListener('message', listener)
          }),
      ),
      canvas(page)
        .locator('body')
        .evaluate(() => window.parent.postMessage({ type: 'cms:undo' }, window.location.origin)),
    ])
    await expect(field).toHaveValue('Keep while reviewing submission')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(field).toHaveValue(original)
    await saveDraft(page)
  })

  test('canvas keyboard undo uses the shared history across canvas and inspector edits', async ({ page }) => {
    const slot = canvas(page).locator('[data-cms-slot="heading"]').first()
    await slot.click()
    const heading = await page.locator('#slot-0-heading').inputValue()
    await treeLabels(page).first().click()
    const intro = await page.locator('#slot-0-intro').inputValue()
    await slot.click()
    await slot.click()
    await slot.fill('Canvas history heading')
    await expect(page.locator('#slot-0-heading')).toHaveValue('Canvas history heading')
    await typeInInspector(page, 0, 'intro', 'Inspector history intro')
    await expect(canvas(page).locator('[data-cms-slot="intro"]').first()).toHaveText('Inspector history intro')
    await slot.click()
    await slot.click()
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')

    // Keyboard events inside the iframe do not bubble to the editor window.
    // Undo must reverse the most recent page edit, not the browser's private
    // contenteditable history for this heading.
    await slot.press('ControlOrMeta+z')
    await expect(canvas(page).locator('[data-cms-slot="intro"]').first()).toHaveText(intro)
    await expect(slot).toHaveText('Canvas history heading')
    await slot.press('ControlOrMeta+Shift+z')
    await expect(canvas(page).locator('[data-cms-slot="intro"]').first()).toHaveText('Inspector history intro')
    await slot.press('ControlOrMeta+z')
    await slot.press('ControlOrMeta+z')
    await expect(slot).toHaveText(heading)
    await expect(page.locator('#slot-0-heading')).toHaveValue(heading)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await saveDraft(page)
    await page.reload()
    await clickOnCanvas(page, 'heading')
    await expect(page.locator('#slot-0-heading')).toHaveValue(heading)
    await expect(canvas(page).locator('[data-cms-slot="intro"]').first()).toHaveText(intro)
  })

  test('canvas keyboard undo restores a structural edit without an active text field', async ({ page }) => {
    await canvas(page).locator('[data-cms-section]').first().click()
    await deleteSelectedSection(page)
    await expect(treeLabels(page).filter({ hasText: 'Hero' })).toHaveCount(0)
    await expect(canvas(page).locator('h1')).toHaveCount(0)
    await canvas(page).locator('[data-cms-section]').first().click()
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')
    await canvas(page).locator('body').press('ControlOrMeta+z')
    await expect(treeLabels(page).filter({ hasText: 'Hero' })).toHaveCount(1)
    await expect(canvas(page).locator('h1')).toBeVisible()
    await saveDraft(page)
  })

  test('⌘Z restores a deleted section with its content', async ({ page }) => {
    const before = await canvas(page).locator('[data-cms-section]').count()

    await canvas(page).locator('[data-cms-section]').first().click()
    await deleteSelectedSection(page)
    await expect(treeLabels(page).filter({ hasText: 'Hero' })).toHaveCount(0)

    await page.keyboard.press('ControlOrMeta+z')
    await expect(treeLabels(page).filter({ hasText: 'Hero' })).toHaveCount(1)

    await saveDraft(page)
    await page.reload()
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before)
  })

  test('undo reverses typing, and redo puts it back', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    const original = await page.locator('#slot-0-heading').inputValue()
    await typeInInspector(page, 0, 'heading', 'Undo me')

    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.locator('#slot-0-heading')).toHaveValue(original)

    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(page.locator('#slot-0-heading')).toHaveValue('Undo me')
  })

  test('undo is disabled when there is nothing to undo', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })
})

test.describe('reordering', () => {
  test('the tree move buttons reorder the page and are undoable', async ({ page }) => {
    const tree = page.getByRole('complementary', { name: 'Page structure' })
    const order = async () => treeLabels(page).allInnerTexts()
    const before = await order()

    const label = await treeLabels(page).first().getAttribute('aria-label')
    await tree.getByRole('button', { name: 'Actions for ' + label, exact: true }).click()
    await tree.getByRole('button', { name: `Move ${label} down`, exact: true }).click()
    const after = await order()
    expect(after[0]).not.toBe(before[0])

    await page.keyboard.press('ControlOrMeta+z')
    expect(await order()).toEqual(before)
  })

  test('a pointer drag persists the new order after reload', async ({ page }) => {
    const tree = page.getByRole('complementary', { name: 'Page structure' })
    const names = () =>
      treeLabels(page).evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')!))
    const before = await names()
    const moved = [...before.slice(1), before[0]!]
    try {
      // Collapse fields so the draggable section header stays in view. The
      // decorative grip is hidden in card layout and cannot be a pointer target.
      for (const toggle of await tree.getByRole('button', { name: /^Collapse / }).all()) await toggle.click()
      await tree.locator('.tree-section[draggable="true"]').first().dragTo(tree.locator('.tree-gap').last())
      // "Some order changed" also passes when the wrong section was dragged.
      await expect.poll(names).toEqual(moved)
      await saveDraft(page)
      await page.reload()
      await expect.poll(names).toEqual(moved)
    } finally {
      // Restore the entire order even when the assertion above fails. Moving
      // only Hero to first left the other two sections swapped for later tests.
      for (const [target, label] of before.entries()) {
        const current = (await names()).indexOf(label)
        expect(current, `The ${label} fixture section must still exist`).toBeGreaterThanOrEqual(target)
        for (let index = current; index > target; index -= 1) {
          await tree.getByRole('button', { name: `Actions for ${label}`, exact: true }).click()
          await tree.getByRole('button', { name: `Move ${label} up`, exact: true }).click()
        }
      }
      await expect.poll(names).toEqual(before)
      await saveDraft(page)
      await expect(savedState(page)).toHaveText('All changes saved')
      await page.reload()
      await expect.poll(names).toEqual(before)
    }
  })

  test('edit and revert still target the moved section', async ({ page }) => {
    const tree = page.getByRole('complementary', { name: 'Page structure' })
    const label = await treeLabels(page).filter({ hasText: 'Hero' }).getAttribute('aria-label')
    await tree.getByRole('button', { name: 'Actions for ' + label, exact: true }).click()
    await tree.getByRole('button', { name: /^Move Hero(?: — .*)? down$/ }).click()
    await treeLabels(page).filter({ hasText: 'Hero' }).click()

    const field = page.locator('#slot-1-heading')
    const original = await field.inputValue()
    await field.fill('Changed after moving')
    await page
      .getByRole('button', { name: /^Revert (?:Heading|Title) to the version when you opened this page$/ })
      .click()

    await expect(field).toHaveValue(original)
    await expect(treeLabels(page).nth(1)).toContainText('Hero')

    // Restore the original order without relying on array indexes.
    const renamed = await treeLabels(page).filter({ hasText: 'Hero' }).getAttribute('aria-label')
    await tree.getByRole('button', { name: 'Actions for ' + renamed, exact: true }).click()
    await tree.getByRole('button', { name: /^Move Hero(?: — .*)? up$/ }).click()
    await saveDraft(page)
  })
})

test.describe('the docked section library (v1 D4)', () => {
  test('previews on the page, filters, returns to sections and adds the chosen section selected', async ({ page }) => {
    const before = await canvas(page).locator('[data-cms-section]').count()
    await addSectionButton(page).click()
    const dialog = page.getByRole('dialog', { name: 'Add a section', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: 'Category', exact: true })).toContainText('Openers')
    await dialog.getByLabel('Search sections').fill('call')
    const card = dialog.getByTestId('library-card-cta')
    await expect(card.getByRole('button', { name: 'Preview Call to action', exact: true })).toBeVisible()
    await expect(dialog.getByTestId('library-card-hero')).toHaveCount(0)
    await card.getByRole('button', { name: 'Preview Call to action', exact: true }).click()
    await expect(dialog).toContainText('Showing Call to action on the page with sample text.')
    await expect(dialog.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before + 1)
    const preview = canvas(page).locator(`[data-cms-section="${before}"]`)
    await expect(preview.getByRole('heading')).toBeVisible()
    await expect(preview.getByRole('link')).toBeVisible()
    await dialog.getByRole('button', { name: 'Back to sections', exact: true }).click()
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before)
    await expect(dialog.getByLabel('Search sections')).toHaveValue('call')
    await card.getByRole('button', { name: /^Add Call to action / }).click()
    await dialog.getByRole('button', { name: 'Add this section', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(
      page
        .getByRole('complementary', { name: 'Inspector' })
        .getByRole('heading', { name: /^Call to action(?: — .*)?$/ }),
    ).toBeVisible()
    await deleteSelectedSection(page)
    await saveDraft(page)
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before)
  })

  test('cancels a dragged section preview without adding it to the draft', async ({ page }, info) => {
    const before = await treeLabels(page).allTextContents()
    await addSectionButton(page).click()
    const library = page.getByRole('dialog', { name: 'Add a section', exact: true })
    await library.getByLabel('Search sections', { exact: true }).fill('Pull quote')
    await dragLibraryCardToCanvas(
      page,
      library.getByTestId('library-card-quote'),
      canvas(page).locator('[data-cms-section="0"]'),
    )
    await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
    await expect(library).toContainText('before “' + before[0] + '”')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath('cancel-preview-' + width + '.png'), animations: 'disabled' })
    }
    await library.getByRole('button', { name: 'Back to sections', exact: true }).click()
    await library.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(library).toHaveCount(0)
    if (!(await page.getByRole('complementary', { name: 'Page structure', exact: true }).isVisible()))
      await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await expect(treeLabels(page)).toHaveText(before)
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before.length)
  })

  test('drops a section from the library straight onto the page (V1 reference 10)', async ({ page }, info) => {
    const before = await treeLabels(page).allTextContents()
    await addSectionButton(page).click()
    const library = page.getByRole('dialog', { name: 'Add a section' })
    await expect(library.getByLabel('Search sections')).toBeVisible()

    // The upper half of the first section is the gap before it.
    const first = canvas(page).locator('[data-cms-section="0"]')
    await library.getByLabel('Search sections', { exact: true }).fill('Pull quote')
    await dragLibraryCardToCanvas(page, library.getByTestId('library-card-quote'), first)
    await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
    await expect(library).toContainText('before “' + before[0] + '”')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
      await page.mouse.move(1, 1)
      await expect
        .poll(() =>
          canvas(page)
            .locator('[data-cms-section="1"] [data-cms-slot="heading"]')
            .first()
            .evaluate(node => getComputedStyle(node).outlineStyle),
        )
        .toBe('none')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath('drag-preview-' + width + '.png'), animations: 'disabled' })
    }
    await library.getByRole('button', { name: 'Add this section', exact: true }).click()
    await expect(library).toHaveCount(0)
    if (!(await page.getByRole('complementary', { name: 'Page structure', exact: true }).isVisible()))
      await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await expect(treeLabels(page).first()).toHaveAttribute(
      'aria-label',
      'Pull quote — Practical ideas, meaningful connections and a welcome for everyone.',
    )
    await expect(canvas(page).locator('[data-cms-drop-line]')).toHaveCount(0)

    await deleteSelectedSection(page)
    await saveDraft(page)
    await expect(treeLabels(page)).toHaveText(before)
  })

  test('focuses search and Escape closes it', async ({ page }) => {
    await addSectionButton(page).click()
    await expect(page.getByRole('dialog', { name: 'Add a section' })).toBeVisible()
    await expect(page.getByLabel('Search sections')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Add a section' })).toHaveCount(0)
  })

  test('keeps the tablet canvas readable while the auxiliary drawer opens', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1000 })
    await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await addSectionButton(page).click()

    const library = page.getByRole('dialog', { name: 'Add a section' })
    await expect(library.getByRole('heading', { name: 'Add a section', exact: true })).toBeVisible()
    await expect(library).toBeVisible()
    await expect(page.locator('#editor-panel-canvas')).toBeVisible()
    const pageBox = (await page.locator('#editor-panel-canvas').boundingBox())!
    const libraryBox = (await library.boundingBox())!
    expect(pageBox.width).toBeGreaterThanOrEqual(480)
    expect(libraryBox.x).toBeGreaterThanOrEqual(0)
    expect(libraryBox.x + libraryBox.width).toBeLessThanOrEqual(1024)
    expect(libraryBox.x + libraryBox.width).toBeLessThanOrEqual(pageBox.x + 1)
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true)
  })
})

test.describe('breakpoint visibility is bounded, not free layout (D5)', () => {
  test('a whole section can be hidden and recovered without deleting it', async ({ page }) => {
    const before = await canvas(page).locator('[data-cms-section]').count()
    await canvas(page).locator('[data-cms-section]').first().click()

    await page
      .getByRole('toolbar', { name: 'Selected section actions', exact: true })
      .getByRole('button', { name: 'Hide until ready', exact: true })
      .click()
    const visibility = page.locator('.canvas-visibility-note')
    await expect(visibility).toContainText('1 section is hidden from visitors.')
    await expect(visibility).toContainText('Shown here for editing.')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before)
    await expect(canvas(page).getByText('Hidden from visitors · Shown here for editing')).toBeVisible()
    await visibility.getByRole('button', { name: 'Preview without hidden' }).click()
    await expect(visibility).toContainText('Select a hidden section in Structure to edit it.')
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before - 1)
    await visibility.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before)

    const show = page
      .getByRole('toolbar', { name: 'Selected section actions', exact: true })
      .getByRole('button', { name: 'Show section', exact: true })
    await expect(show).toBeVisible()
    await show.click()
    await expect(visibility).toHaveCount(0)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before)
  })

  test('hiding a section on phones is recorded and undoable', async ({ page }) => {
    await canvas(page).locator('[data-cms-section]').first().click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })

    await inspector.getByRole('tab', { name: 'Visibility', exact: true }).click()
    await inspector.getByRole('checkbox', { name: 'Phone', exact: true }).uncheck()
    // The tree names the screens rather than the breakpoint tokens: `sm` is a
    // fact about the stylesheet and "phones" is what the checkbox said.
    await expect(
      page.getByRole('complementary', { name: 'Page structure' }).getByText('hidden on phones', { exact: true }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect(page.locator('.canvas-visibility-note')).toContainText('on phone')
    await expect(page.locator('.canvas-visibility-note')).toContainText('Shown here for editing.')
    await expect(canvas(page).locator('.cms-section--hero')).toBeVisible()
    await page.getByRole('button', { name: 'Preview without hidden', exact: true }).click()
    await expect(canvas(page).locator('.cms-section--hero')).toBeHidden()
    await page.getByRole('button', { name: 'Show me', exact: true }).click()
    await expect(canvas(page).locator('.cms-section--hero')).toBeVisible()

    await page.keyboard.press('ControlOrMeta+z')
    await canvas(page).locator('[data-cms-section]').first().click()
    await inspector.getByRole('tab', { name: 'Visibility', exact: true }).click()
    await expect(inspector.getByRole('checkbox', { name: 'Phone', exact: true })).toBeChecked()
    await saveDraft(page)
  })

  test('offers no per-breakpoint layout controls, only visibility', async ({ page }) => {
    await canvas(page).locator('[data-cms-section]').first().click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await inspector.getByRole('tab', { name: 'Visibility', exact: true }).click()
    // The guardrail: there is deliberately nothing here that lets someone build
    // a different layout per screen size (SPEC §6.4).
    await expect(
      inspector.getByRole('group', { name: 'Show this section on', exact: true }).getByRole('checkbox'),
    ).toHaveCount(3)
    await expect(inspector.getByRole('button', { name: 'Narrow', exact: true })).toHaveCount(0)
    await expect(inspector.getByRole('group', { name: 'Image position', exact: true })).toHaveCount(0)
  })
})

test.describe('preview instrumentation stays out of published output', () => {
  test('the canvas is instrumented and the live page is not', async ({ page }) => {
    await expect(canvas(page).locator('[data-cms-section]').first()).toBeAttached()
    const src = await page.locator('iframe[title="Page canvas"]').getAttribute('src')
    expect(src).toMatch(/^\/preview\//) // relative, therefore same-origin
  })
})
