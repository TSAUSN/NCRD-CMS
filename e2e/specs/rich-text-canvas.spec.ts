import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addSectionButton, canvas, saveDraft, savedState, signIn } from './helpers.ts'

const proseSection = (page: Page) => canvas(page).locator('[data-cms-section].cms-section--prose')
const proseBody = (page: Page) => proseSection(page).locator('[data-cms-slot="body"][data-cms-kind="richtext"]')

// Every case owns a new page, so rich-text edits cannot contaminate the seeded
// page used by unrelated editor and publication tests.
async function prepare(page: Page) {
  await signIn(page, 'root@example.test')
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.getByRole('button', { name: 'Add a page' }).click()
  const creator = page.getByRole('dialog', { name: 'New page', exact: true })
  await creator.getByLabel('Page title', { exact: true }).fill('Canvas rich text review')
  await creator.getByRole('button', { name: 'Change', exact: true }).click()
  await creator
    .getByLabel('Web address', { exact: true })
    .fill(`rich-canvas-${Date.now()}-${Math.floor(Math.random() * 1000)}`)
  await creator.getByRole('button', { name: 'Create draft', exact: true }).click()
  await page.waitForURL(/\/pages\/[0-9a-f-]{36}$/)
  await addSectionButton(page).click()
  const addText = page
    .getByTestId('library-card-prose')
    .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
  const folder = resolve('../.r8-progress/step-5/isolated-canvas')
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.evaluate(() =>
      document.fonts.ready.then(
        () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      ),
    )
    await page.mouse.move(0, 0)
    const card = page.getByTestId('library-card-prose')
    await card.scrollIntoViewIfNeeded()
    const bounds = await card.boundingBox(),
      shelf = await page.getByRole('dialog', { name: /^Add a section/ }).boundingBox()
    expect(bounds).not.toBeNull()
    expect(shelf).not.toBeNull()
    expect(bounds!.y).toBeGreaterThanOrEqual(shelf!.y)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(shelf!.y + shelf!.height + 1)
    const before = await addText.evaluate(node => node.getBoundingClientRect().top)
    await addText.hover()
    const after = await addText.evaluate(
      node =>
        new Promise<number>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(node.getBoundingClientRect().top))),
        ),
    )
    expect(Math.abs(after - before)).toBeLessThan(1)
    await page.screenshot({
      path: resolve(folder, `${page.context().browser()!.browserType().name()}-library-hover-${width}.png`),
      animations: 'disabled',
      scale: 'css',
    })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await addText.click()
  await page
    .getByRole('dialog', { name: 'Add a section', exact: true })
    .getByRole('button', { name: 'Add this section', exact: true })
    .click()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await inspector.getByRole('button', { name: 'HTML source', exact: true }).click()
  const original =
    '<h2>Shared content</h2><p>Keep <strong>bold</strong>, <em>italic</em> and <a href="/about?x=1&amp;y=2">safe links</a>.</p><ul><li><p>First item</p></li></ul><blockquote><p>Quoted words</p></blockquote>'
  await inspector.getByLabel('HTML source', { exact: true }).fill(original)
  await saveDraft(page)
  const editorPath = new URL(page.url()).pathname
  await expect(proseSection(page)).toHaveCount(1)
  const section = Number(await proseSection(page).getAttribute('data-cms-section'))
  await page.context().clearCookies()
  await signIn(page, 'editor@example.test')
  await page.goto(editorPath + '?section=' + section)
  await expect(addSectionButton(page)).toHaveCount(0)
  const body = proseBody(page)
  await expect(body.locator('h2')).toHaveText('Shared content')
  return { body, inspector, section }
}

async function editOnPage(page: Page) {
  const body = proseBody(page)
  await body.click()
  await body.click()
  await expect(body).toHaveAttribute('contenteditable', 'true')
  await expect(page.getByRole('toolbar', { name: 'Canvas rich text formatting' })).toBeVisible()
  return body
}

test('opening rich text stays clean; canvas formatting, inspector typing and page history stay synchronized through save/reload', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { body, inspector } = await prepare(page)
  const before = await body.innerHTML()
  const frameSource = await page.locator('iframe[title="Page canvas"]').getAttribute('src')
  await expect(page.getByRole('complementary', { name: 'Page structure' }).locator('.dot')).toHaveCount(0)
  await editOnPage(page)
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect(page.getByRole('complementary', { name: 'Page structure' }).locator('.dot')).toHaveCount(0)
  await expect(body.locator('strong')).toHaveText('bold')
  await expect(body.locator('em')).toHaveText('italic')
  await expect(body.locator('a')).toHaveAttribute('href', '/about?x=1&y=2')
  await expect(body.locator('ul li')).toHaveText('First item')
  await expect(body.locator('blockquote')).toHaveText('Quoted words')
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    const pagePane = page.getByRole('tab', { name: 'Page', exact: true })
    if (await pagePane.isVisible()) await pagePane.click()
    await page.evaluate(() => document.fonts.ready)
    await body.evaluate(async node => {
      await node.ownerDocument.fonts.ready
    })
    await expect(page.getByRole('toolbar', { name: 'Canvas rich text formatting' })).toBeVisible()
    await expect(body).toBeVisible()
    const path = testInfo.outputPath(`rich-text-canvas-${width}.png`)
    await page.screenshot({ path, animations: 'disabled' })
    await testInfo.attach(`Rich text canvas ${width}`, { path, contentType: 'image/png' })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  // Clicking Done without typing must not store TipTap's parsing as an edit.
  await page.getByRole('button', { name: 'Done editing text' }).click()
  await expect(body).not.toHaveAttribute('contenteditable')
  expect(await body.innerHTML()).toBe(before)
  await editOnPage(page)
  await body.press('ControlOrMeta+A')
  await page.keyboard.insertText('One shared paragraph')
  await expect(body).toHaveText('One shared paragraph')
  const toolbar = page.getByRole('toolbar', { name: 'Canvas rich text formatting' })
  await body.press('ControlOrMeta+A')
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(body.locator('strong')).toHaveText('One shared paragraph')
  const visual = inspector.getByRole('textbox', { name: /^Body(?: Changed)?$/ })
  await expect(visual.locator('strong')).toHaveText('One shared paragraph')
  await body.press('ControlOrMeta+z')
  await expect(body.locator('strong')).toHaveCount(0)
  await expect(visual.locator('strong')).toHaveCount(0)
  await body.press('ControlOrMeta+Shift+z')
  await expect(body.locator('strong')).toHaveText('One shared paragraph')
  await visual.press('ControlOrMeta+A')
  await page.keyboard.insertText('Edited in the inspector')
  await expect(body).toHaveText('Edited in the inspector')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(body.locator('strong')).toHaveText('One shared paragraph')
  await saveDraft(page)
  await expect(body).toHaveAttribute('data-cms-inline-editing', '')
  expect(await page.locator('iframe[title="Page canvas"]').getAttribute('src')).toBe(frameSource)
  await page.reload()
  await expect(body.locator('strong')).toHaveText('One shared paragraph')
  await expect(savedState(page)).toHaveText('All changes saved')
  expect(errors).toEqual([])
})

test('canvas paste uses the allowed structured language, supports block controls and refuses unsafe links', async ({
  page,
}) => {
  await prepare(page)
  const body = await editOnPage(page)
  await body.press('ControlOrMeta+A')
  await body.evaluate(node => {
    // Firefox puts a constructed DataTransfer in protected mode, returning
    // empty data outside a trusted clipboard event. Exercise the real paste
    // handler with explicit untrusted contents, then test native paste below.
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    const contents: Record<string, string> = {
      'text/html':
        '<h1>Unsafe heading level</h1><p onclick="alert(1)">Pasted <strong>bold</strong><img src=x onerror="alert(1)"></p><p><a href="javascript:alert(1)">unsafe URL</a></p>',
      'text/plain': 'Unsafe heading level Pasted bold unsafe URL',
    }
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => contents[type] ?? '' } })
    node.dispatchEvent(event)
  })
  await expect(body).toContainText('Pasted bold')
  await expect(body.locator('h1,img,script,[onclick],[onerror]')).toHaveCount(0)
  await expect(body.locator('a')).toHaveAttribute('href', '#')
  await expect(body.locator('strong')).toHaveText('bold')
  const toolbar = page.getByRole('toolbar', { name: 'Canvas rich text formatting' })
  await body.press('ControlOrMeta+A')
  await toolbar.getByLabel('Text style', { exact: true }).selectOption('heading-3')
  await expect(body.locator('h3')).not.toHaveCount(0)
  await toolbar.getByLabel('Text style', { exact: true }).selectOption('paragraph')
  await toolbar.getByRole('button', { name: 'Bulleted list', exact: true }).click()
  await expect(body.locator('ul')).toHaveCount(1)
  await toolbar.getByRole('button', { name: 'Bulleted list', exact: true }).click()
  await toolbar.getByRole('button', { name: 'Block quote', exact: true }).click()
  await expect(body.locator('blockquote')).toHaveCount(1)
  await body.press('Escape')
  await expect(body).not.toHaveAttribute('contenteditable')
  await expect(page.getByRole('toolbar', { name: 'Canvas rich text formatting' })).toBeHidden()
  await saveDraft(page)
  await page.reload()
  await expect(body.locator('blockquote')).toHaveCount(1)
  await expect(body.locator('h1,img,script,[onclick],[onerror]')).toHaveCount(0)
})

test('native keyboard copy and paste preserves allowed canvas formatting through save and reload', async ({ page }) => {
  await prepare(page)
  const body = await editOnPage(page)
  await body.press('ControlOrMeta+A')
  await body.press('ControlOrMeta+c')
  await page.keyboard.insertText('Replace before pasting')
  await expect(body).toHaveText('Replace before pasting')
  await body.press('ControlOrMeta+A')
  await body.press('ControlOrMeta+v')
  await expect(body.locator('strong')).toHaveText('bold')
  await expect(body.locator('em')).toHaveText('italic')
  await expect(body.locator('ul li')).toHaveText('First item')
  await page.getByRole('button', { name: 'Done editing text' }).click()
  await saveDraft(page)
  await page.reload()
  await expect(body.locator('strong')).toHaveText('bold')
  await expect(body.locator('em')).toHaveText('italic')
})

test('keyboard activation works; foreign and wrong-kind bridge edits cannot flatten formatted content', async ({
  page,
}) => {
  const { body, section } = await prepare(page)
  const original = await body.innerHTML()
  await page.evaluate(section => {
    window.postMessage({ type: 'cms:edit-richtext', section, slot: 'body' }, location.origin)
    window.postMessage({ type: 'cms:edit', section, slot: 'body', value: 'Foreign flattened body' }, location.origin)
  }, section)
  await body.evaluate((_, section) => {
    parent.postMessage({ type: 'cms:edit', section, slot: 'body', value: 'Wrong-kind flattened body' }, location.origin)
  }, section)
  await expect(body).toHaveJSProperty('innerHTML', original)
  await expect(body).not.toHaveAttribute('contenteditable')
  await body.focus()
  await body.press('Enter')
  await expect(body).toHaveAttribute('contenteditable', 'true')
  await expect(page.getByRole('toolbar', { name: 'Canvas rich text formatting' })).toBeVisible()
  await body.evaluate(node =>
    node.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }),
    ),
  )
  await expect(body.locator('strong')).toHaveText('bold')
  await body.press('Escape')
  await expect(body).not.toHaveAttribute('contenteditable')
  await expect(savedState(page)).toHaveText('All changes saved')
})
