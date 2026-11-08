// A structured definition, edited through the editor a person actually uses
// (ADR 0007, SPEC §6.4).
//
// The structured serializer emits the same `data-cms-slot` / `data-cms-kind`
// instrumentation the interpolation one emits, and that decision is the whole
// claim being tested here: the editor was never told which model a section came
// from, so either every surface works on both or the decision was wrong.
// packages/renderer already proves the serializer produces the right bytes —
// nothing in this file re-does that. Everything below goes through a running
// admin, a real click, and, where it matters at the end, a raw socket with no
// browser involved in it at all.
import { expect, type Page } from '@playwright/test'
import { test } from './fixtures/shared-demo-home.ts'
import { SEED_SECTION_DEFS } from '@cms/seeds'
import {
  addSectionButton,
  canvas,
  clickOnCanvas,
  deleteSelectedSection,
  fetchPublic,
  openSeededPage,
  publish,
  savedState,
  signIn,
  saveDraft,
  STAGING_ORIGIN,
  typeInInspector,
} from './helpers.ts'

// The seeded page is hero, text block, call to action, in that order, and the
// seed keeps it to those three precisely so the specs that index into it do not
// have to be rewritten every time the library grows.
const HERO = 0
const PROSE = 1

/** Which seeded definitions are structured, according to the seed itself. */
const STRUCTURED = new Set(SEED_SECTION_DEFS.filter(def => def.kind === 'structured').map(def => def.slug))

function tree(page: Page) {
  return page.getByRole('complementary', { name: 'Page structure' })
}

async function openRichText(page: Page) {
  await tree(page).locator('.tree-label').nth(PROSE).click()
  await tree(page).getByRole('button', { name: /^Body/ }).click()
  const editor = page.getByRole('textbox', { name: 'Body' })
  await expect(editor).toBeVisible()
  return editor
}

async function richTextSource(page: Page) {
  await page.getByRole('button', { name: 'HTML source' }).click()
  return page.getByLabel('HTML source')
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await openSeededPage(page)
})

test.describe('editing a structured section', () => {
  test('the sections this file edits really are structured, and their fields are marked', async ({ page }) => {
    // Asserted against the seed rather than assumed. If `hero` ever moved back
    // to the interpolation path every test below would still pass, and would be
    // re-proving the model that was already covered — the most expensive kind
    // of green.
    expect(STRUCTURED.has('hero')).toBe(true)
    expect(STRUCTURED.has('prose')).toBe(true)
    expect(STRUCTURED.has('cta')).toBe(false)

    await expect(canvas(page).locator(`[data-cms-section="${HERO}"]`)).toHaveClass(/cms-section--hero/)
    // The two attributes every editor surface keys on, on a field the
    // structured serializer emitted, carrying the field's declared type.
    await expect(canvas(page).locator(`[data-cms-section="${HERO}"] [data-cms-slot="heading"]`)).toHaveAttribute(
      'data-cms-kind',
      'text',
    )
    await expect(canvas(page).locator(`[data-cms-section="${PROSE}"] [data-cms-slot="body"]`)).toHaveAttribute(
      'data-cms-kind',
      'richtext',
    )
  })

  test('clicking a structured field on the page opens the inspector for that field', async ({ page }) => {
    await clickOnCanvas(page, 'heading')

    // The inspector builds this control from the definition's declared slots,
    // which for a structured definition are its declared fields.
    await expect(page.locator(`#slot-${HERO}-heading`)).toHaveValue(/\S/)
    await expect(tree(page).locator('.tree-slot', { hasText: 'Heading' }).first()).toHaveClass(/on/)
  })

  test('typing in the inspector changes the structured field on the page as you type', async ({ page }) => {
    const heading = `Structured, live ${Date.now()}`
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, HERO, 'heading', heading)

    // No save and no reload: the canvas is the real page, and the node that
    // changed is the span the structured serializer wrapped the field in.
    await expect(canvas(page).locator(`[data-cms-section="${HERO}"] [data-cms-slot="heading"]`)).toHaveText(heading)
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(heading)
  })

  test('a changed structured field grows a dot, and reverting it clears the dot', async ({ page }) => {
    await expect(tree(page).locator('.dot')).toHaveCount(0)

    await clickOnCanvas(page, 'heading')
    const original = await page.locator(`#slot-${HERO}-heading`).inputValue()
    await typeInInspector(page, HERO, 'heading', 'Changed on a structured section')

    // One dot on the section and one on the field; the other two sections stay
    // clean, which is what makes the dot worth looking at (D15).
    await expect(tree(page).locator('.dot')).toHaveCount(2)

    await page.getByRole('button', { name: 'Revert Title to the version when you opened this page' }).click()
    await expect(page.locator(`#slot-${HERO}-heading`)).toHaveValue(original)
    await expect(tree(page).locator('.dot')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Revert Title to the version when you opened this page' }),
    ).toHaveCount(0)

    // And the page goes back at the same moment. Revert used to change the
    // editor's state without telling the canvas, so the inspector showed the
    // original while the page still showed the words it had just been told to
    // throw away, and neither of them was wrong about anything except the other.
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(original)
  })

  test('reverting a field puts the page, the draft and a reload back to the original', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    const original = await page.locator(`#slot-${HERO}-heading`).inputValue()
    const typed = `Reverted away ${Date.now()}`

    // Saved first, so what is being reverted is something the server really has
    // — a revert that only tidies the screen leaves the server holding the
    // words nobody wanted, and the next reload brings them back.
    await typeInInspector(page, HERO, 'heading', typed)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

    await page.getByRole('button', { name: 'Revert Title to the version when you opened this page' }).click()
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(original)
    await expect(savedState(page)).toHaveText('Unsaved changes')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

    await page.reload()
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(original)
    await clickOnCanvas(page, 'heading')
    await expect(page.locator(`#slot-${HERO}-heading`)).toHaveValue(original)
  })

  test('undo and redo move the page as well as the inspector', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    const original = await page.locator(`#slot-${HERO}-heading`).inputValue()
    const typed = `Undone on the page ${Date.now()}`
    await typeInInspector(page, HERO, 'heading', typed)
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(typed)

    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.locator(`#slot-${HERO}-heading`)).toHaveValue(original)
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(original)

    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(page.locator(`#slot-${HERO}-heading`)).toHaveValue(typed)
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(typed)

    // Reverting is an ordinary step in that stack rather than an escape from
    // it, so undoing a revert brings the change back — on the page too.
    await page.getByRole('button', { name: 'Revert Title to the version when you opened this page' }).click()
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(original)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.locator(`#slot-${HERO}-heading`)).toHaveValue(typed)
    await expect(canvas(page).locator('.cms-section--hero h1')).toHaveText(typed)
  })

  test('an autosaved structured edit survives a reload, and the preview serves it', async ({ page }) => {
    // Selected from the tree this time rather than the canvas — the second of
    // the two ways in, and the one that never touches the rendered page.
    await tree(page).locator('.tree-label').nth(HERO).click()
    await tree(page)
      .getByRole('button', { name: /^Intro/ })
      .click()

    const intro = `Autosaved through the structured path ${Date.now()}`
    await typeInInspector(page, HERO, 'intro', intro)
    await expect(savedState(page)).toHaveText('Unsaved changes')

    // Nothing here presses Save and nothing here sleeps: autosave arrives on
    // its own, and the indicator reflects an acknowledged write.
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

    await page.reload()
    await expect(canvas(page).locator('.cms-section--hero p.lede')).toHaveText(intro)
    await tree(page).locator('.tree-label').nth(HERO).click()
    await tree(page)
      .getByRole('button', { name: /^Intro/ })
      .click()
    await expect(page.locator(`#slot-${HERO}-intro`)).toHaveValue(intro)

    // The preview document itself, rather than whatever the iframe painted.
    // Fetched from inside the editor because that is what makes it carry the
    // editor's own session — a preview is a draft surface and is behind it.
    const src = await page.locator('iframe[title="Page canvas"]').getAttribute('src')
    const preview = await page.evaluate(async url => {
      const response = await fetch(url)
      return { status: response.status, html: await response.text() }
    }, src!)
    expect(preview.status).toBe(200)
    expect(preview.html).toContain(intro)
    expect(preview.html).toContain('data-cms-kind="text"')
  })

  test('publishing a structured field puts it on the live page with none of the editor’s markup', async ({ page }) => {
    const heading = `Structured and published ${Date.now()}`
    await clickOnCanvas(page, 'heading')
    await typeInInspector(page, HERO, 'heading', heading)
    await publish(page)

    // What the internet actually receives. The browser said it published; a
    // raw socket says what came back.
    const live = await fetchPublic()
    expect(live.status).toBe(200)
    // A `text` field is element text, and on the public path nothing wraps
    // it — the span the canvas selects by exists only in preview.
    expect(live.body).toContain(`<h1>${heading}</h1>`)
    expect(live.body).not.toMatch(/<script/i)

    // Every marker the editor puts on the page, including the two the canvas
    // adds while somebody is working: the outline follows the selection and
    // the caret needs an editable node, and neither is a fact about the page.
    for (const attribute of [
      'data-cms-slot',
      'data-cms-kind',
      'data-cms-section',
      'data-cms-def',
      'data-cms-label',
      'data-cms-selected',
      'contenteditable',
    ]) {
      expect(live.body, attribute).not.toContain(attribute)
    }
  })
})

test.describe('a structured rich-text field', () => {
  test('opens visually without changing or autosaving the existing document', async ({ page }) => {
    const editor = await openRichText(page)
    const before = await editor.innerHTML()
    await expect(savedState(page)).toHaveText('All changes saved')
    await page.waitForTimeout(1_800)
    await expect(savedState(page)).toHaveText('All changes saved')
    await expect(tree(page).locator('.dot')).toHaveCount(0)
    expect(await editor.innerHTML()).toBe(before)
  })

  test('offers the governed visual formatting language instead of an HTML box', async ({ page }) => {
    const editor = await openRichText(page)
    await editor.fill('Formatting sample')
    await editor.press('ControlOrMeta+a')

    await page.getByLabel('Text style').selectOption('heading-2')
    await expect(editor.locator('h2').first()).toHaveText('Formatting sample')
    await page.getByLabel('Text style').selectOption('heading-3')
    await expect(editor.locator('h3').first()).toHaveText('Formatting sample')
    await page.getByLabel('Text style').selectOption('heading-4')
    await expect(editor.locator('h4').first()).toHaveText('Formatting sample')
    await page.getByLabel('Text style').selectOption('paragraph')

    for (const [button, selector] of [
      ['Bold', 'strong'],
      ['Italic', 'em'],
      ['Bulleted list', 'ul'],
      ['Numbered list', 'ol'],
      ['Block quote', 'blockquote'],
    ] as const) {
      await editor.press('ControlOrMeta+a')
      await page.getByRole('button', { name: button, exact: true }).click()
      await expect(editor.locator(selector)).toBeVisible()
      await page.getByRole('button', { name: button, exact: true }).click()
    }

    await editor.press('ControlOrMeta+a')
    await page.getByRole('button', { name: 'Add or edit link' }).click()
    const href = page.getByLabel('Where the link goes')
    await href.fill('javascript:alert(1)')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page.getByText(/Enter a safe site path/)).toBeVisible()
    await expect(editor.locator('a')).toHaveCount(0)

    await href.fill('/about')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(editor.locator('a')).toHaveAttribute('href', '/about')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('.cms-section--prose a')).toHaveAttribute('href', '/about')

    // One page-owned revert restores the visual editor and the canonical
    // canvas together; TipTap does not maintain a competing undo history.
    await page.getByRole('button', { name: 'Revert Body to the version when you opened this page' }).click()
    await expect(editor.locator('strong')).toHaveText('immutable definition version')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('.cms-section--prose strong')).toHaveText('immutable definition version')
  })

  test('preserves ordinary entities and visual formatting through reload, preview and publish', async ({
    page,
    context,
  }) => {
    const editorUrl = page.url()
    await openRichText(page)
    await expect(page.getByRole('button', { name: 'HTML source', exact: true })).toHaveCount(0)
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto(editorUrl)
    let editor = await openRichText(page)
    await page.getByRole('button', { name: 'Visual' }).click()

    const exactText = 'Family & Services < >\u00a0 entity-like &amp;'
    await editor.fill(exactText)
    await editor.press('ControlOrMeta+a')
    await page.getByRole('button', { name: 'Bold', exact: true }).click()
    await expect(editor.locator('strong')).toHaveText(exactText)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

    const canonicalSource = await (await richTextSource(page)).inputValue()
    expect(canonicalSource).toContain('Family &amp; Services &lt; &gt;')
    expect(canonicalSource).not.toContain('Family &amp;amp; Services')

    await page.reload()
    editor = await openRichText(page)
    await expect(editor.locator('strong')).toHaveText(exactText)
    await expect(canvas(page).locator('.cms-section--prose strong')).toHaveText(exactText)
    expect(await (await richTextSource(page)).inputValue()).toBe(canonicalSource)

    await publish(page)
    const raw = await fetchPublic()
    expect(raw.body).toContain(canonicalSource)

    const live = await context.newPage()
    await live.goto(STAGING_ORIGIN)
    await expect(live.locator('.cms-section--prose strong')).toHaveText(exactText)
    await live.close()
  })

  test('goes through the same loop, and reaches the live page as the sanitizer leaves it', async ({
    page,
    sharedDemoHome,
  }) => {
    const editorUrl = page.url()
    await openRichText(page)
    await expect(page.getByRole('button', { name: 'HTML source', exact: true })).toHaveCount(0)
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto(editorUrl)
    await openRichText(page)
    const source = await richTextSource(page)

    const stamp = Date.now()
    // `em` is on the rich-text allowlist and carries no attributes, so an
    // author who pastes a handler in along with their markup keeps the emphasis
    // and loses the handler. Typed into the editor rather than handed to the
    // sanitizer directly, because the claim being made is about the path an
    // author's keystrokes take, not about the function at the end of it.
    await source.fill(
      `<p>Rewritten ${stamp} with <strong>real emphasis</strong> and ` + '<em onclick="alert(1)">some more</em>.</p>',
    )

    // Rich text is stored as authored and sanitized on the way out, so the
    // handler is still in the box the author typed it into.
    await expect(source).toHaveValue(/onclick/)
    await expect(tree(page).locator('.dot')).toHaveCount(2)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

    // Only plain text can be patched into the canvas as it is typed; rich text
    // is whatever the sanitizer makes of it, so the editor renders the canvas
    // again from the draft the save just wrote. Nothing here reloads the page.
    await expect(canvas(page).locator('.cms-section--prose strong')).toHaveText('real emphasis')
    await expect(canvas(page).locator('.cms-section--prose .body')).toContainText(`Rewritten ${stamp}`)
    // The render is the real one, so the handler is gone from the page for the
    // same reason it will be gone from the published one.
    await expect(canvas(page).locator('.cms-section--prose em')).not.toHaveAttribute('onclick')

    await publish(page)
    const live = await fetchPublic()
    expect(live.status).toBe(200)
    expect(live.body).toContain('<strong>real emphasis</strong>')
    expect(live.body).toContain('<em>some more</em>')
    expect(live.body).not.toContain('onclick')
    expect(live.body).not.toContain('data-cms-slot')
    sharedDemoHome.afterRestore(async () => {
      expect((await fetchPublic()).body).toContain('<strong>immutable definition version</strong>')
    })
  })

  test('is rendered again where the author is looking, without taking the selection away', async ({ page }) => {
    const editorUrl = page.url()
    await openRichText(page)
    await expect(page.getByRole('button', { name: 'HTML source', exact: true })).toHaveCount(0)
    await page.context().clearCookies()
    await signIn(page, 'root@example.test')
    await page.goto(editorUrl)
    await openRichText(page)
    const source = await richTextSource(page)
    const seeded = await source.inputValue()
    const stamp = `Rendered without a reload ${Date.now()}`

    await source.fill(`<p>${stamp} with <strong>real emphasis</strong>.</p>`)
    await expect(savedState(page)).toHaveText('Unsaved changes')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('.cms-section--prose .body')).toContainText(stamp)

    // A rendered canvas is a new document, and it has to come back with the
    // outline where the author left it: re-rendering the page somebody is
    // editing and dropping their place in it is a fix that costs more than the
    // problem.
    await expect(
      canvas(page).locator(`[data-cms-section="${PROSE}"] [data-cms-slot="body"][data-cms-selected]`),
    ).toBeAttached()

    // Undo reaches a rich-text edit the same way it reaches typing, and the
    // page follows it — which is also how the shared fixture goes back.
    await page.keyboard.press('ControlOrMeta+z')
    await expect(source).toHaveValue(seeded)
    await expect(savedState(page)).toHaveText('Unsaved changes')
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    await expect(canvas(page).locator('.cms-section--prose strong')).toHaveText('immutable definition version')
  })
})

test.describe('a structured link and image', () => {
  // The seeded page does not use this definition, so the section arrives the
  // way a person's does: out of the library, with marked sample values.
  test('are filled in through the inspector’s own controls and reach the page as markup', async ({ page, browser }) => {
    expect(STRUCTURED.has('feature')).toBe(true)
    // Appended after whatever the shared page holds, rather than assuming an
    // earlier spec left exactly the seeded three behind.
    await expect(tree(page).locator('.tree-label').first()).toBeVisible()
    const FEATURE = await tree(page).locator('.tree-label').count()

    // Adding structure belongs to an admin; the Editor still fills the fields.
    await expect(addSectionButton(page)).toHaveCount(0)
    const editorUrl = page.url()
    const adminContext = await browser.newContext({ baseURL: new URL(editorUrl).origin })
    try {
      const admin = await adminContext.newPage()
      await signIn(admin, 'root@example.test')
      await admin.goto(editorUrl, { waitUntil: 'domcontentloaded' })
      await addSectionButton(admin).click()
      const dialog = admin.getByRole('dialog', { name: 'Add a section' })
      await dialog
        .getByTestId('library-card-feature')
        .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
        .click()
      await dialog.getByRole('button', { name: 'Add this section', exact: true }).click()
      await saveDraft(admin)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await tree(page).locator('.tree-label').nth(FEATURE).click()
      await expect(
        page.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { name: 'Feature card' }),
      ).toBeVisible()

      // A link is a label and a destination and an image is a source and a
      // description, so neither is a string the canvas could be handed: both are
      // two boxes in the inspector and the renderer's own policy on the page.
      const stamp = Date.now()
      // A picture from another address is behind its own disclosure; the media
      // library is the ordinary way to choose one.
      await page.locator(`#slot-${FEATURE}-picture-src`).locator('xpath=ancestor::details[1]/summary').click()
      await page.locator(`#slot-${FEATURE}-picture-src`).fill('/pictures/harbour.png')
      await page.locator(`#slot-${FEATURE}-picture-alt`).fill(`Boats in a harbour ${stamp}`)
      await page.locator(`[data-inspector-slot="more"]`).getByRole('button', { name: 'Change', exact: true }).click()
      await page.locator(`#slot-${FEATURE}-more-label`).fill(`Read more ${stamp}`)
      await page
        .getByRole('dialog', { name: 'Change link', exact: true })
        .getByRole('button', { name: 'Website', exact: true })
        .click()
      await page.locator(`#slot-${FEATURE}-more-url`).fill('/about')
      await page
        .getByRole('dialog', { name: 'Change link', exact: true })
        .getByRole('button', { name: 'Done', exact: true })
        .click()
      await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })

      // What the renderer made of them, on the page, with no reload. The image
      // address names nothing this app serves on purpose: what is being checked
      // is the markup the author's two boxes produced, not a picture.
      const feature = canvas(page).locator(`[data-cms-section="${FEATURE}"]`)
      await expect(feature.locator('img')).toHaveAttribute('src', '/pictures/harbour.png')
      await expect(feature.locator('img')).toHaveAttribute('alt', `Boats in a harbour ${stamp}`)
      await expect(feature.locator('a')).toHaveText(`Read more ${stamp}`)
      await expect(feature.locator('a')).toHaveAttribute('href', '/about')

      // Both fields are marked with the type they were declared as, which is what
      // every editor surface reads to decide what to offer for them.
      await expect(feature.locator('[data-cms-slot="picture"]')).toHaveAttribute('data-cms-kind', 'image')
      await expect(feature.locator('[data-cms-slot="more"]')).toHaveAttribute('data-cms-kind', 'link')
      await expect(tree(page).locator('.tree-slot', { hasText: 'Picture' })).toHaveCount(1)

      // Verify the admin can remove the unpublished section after the Editor’s save.
      await admin.reload({ waitUntil: 'domcontentloaded' })
      await tree(admin).locator('.tree-label').nth(FEATURE).click()
      await deleteSelectedSection(admin)
      await expect(tree(admin).locator('.tree-label')).toHaveCount(FEATURE)
      await expect(savedState(admin)).toHaveText('All changes saved', { timeout: 10_000 })
      await expect(canvas(admin).locator('[data-cms-section]')).toHaveCount(FEATURE)
      expect((await fetchPublic()).body).not.toContain('/pictures/harbour.png')
    } finally {
      await adminContext.close()
    }
  })
})
