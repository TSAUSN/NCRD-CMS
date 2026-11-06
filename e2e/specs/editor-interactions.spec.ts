import { E2E_PORTS } from '../test-ports.ts'
import { expect, test, type Page } from '@playwright/test'
import { addSectionButton, canvas, dragLibraryCardToCanvas, saveDraft, signIn, treeLabels } from './helpers.ts'
import { rawRequest } from './http.ts'

// Each journey owns a private site. Pointer edits never disturb the shared
// fixture, the retained demo, or any public website.
async function privateEventPage(page: Page, kind: 'event' | 'resource' = 'event') {
  await signIn(page, 'root@example.test')
  await page.getByRole('link', { name: 'Create a site', exact: true }).click()
  const slug = `interaction-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  await page.getByLabel('Site name', { exact: true }).fill('Private interaction checks')
  await page.getByLabel('Short address', { exact: true }).fill(slug)
  await page.getByLabel(kind === 'event' ? /Event site/ : /Resource site/).check()
  for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Create site', exact: true }).click()
  await page.getByRole('button', { name: 'Add a page', exact: true }).click()
  const draft = page.getByRole('dialog', { name: 'New page', exact: true })
  await draft.getByLabel('Page title', { exact: true }).fill('Private interaction draft')
  await draft.getByRole('button', { name: 'Change', exact: true }).click()
  await draft.getByLabel('Web address', { exact: true }).fill('interaction-draft')
  await draft.getByText('A page design', { exact: true }).click()
  await draft.getByRole('button', { name: 'Create draft', exact: true }).click()
  await expect(canvas(page).locator('h1')).toHaveText('Private interaction draft')
  return { host: `${slug}.staging.localhost`, path: '/interaction-draft' }
}

const readonlyWarnings = new WeakMap<string[], Set<string>>()

function listenForErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const warnings = new Set<string>()
  readonlyWarnings.set(errors, warnings)
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
    else errors.push(message.text())
  })
  page.on('response', response => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  return errors
}

async function expectNoErrors(page: Page, errors: string[]) {
  for (const url of readonlyWarnings.get(errors) ?? []) {
    const response = await page.request.get(url)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-security-policy']).toContain("script-src 'none'")
    expect(response.headers()['content-security-policy']).toContain('sandbox allow-same-origin')
    expect(await response.text()).not.toMatch(/<script\b/i)
  }
  expect(errors).toEqual([])
}

async function layout(page: Page) {
  return canvas(page)
    .locator('body')
    .evaluate(body => {
      const win = body.ownerDocument.defaultView!
      return [...body.querySelectorAll('main h1, main h2, main p, main img, main a')].map(element => {
        const box = element.getBoundingClientRect(),
          style = win.getComputedStyle(element)
        return {
          tag: element.tagName,
          text: element.textContent,
          x: box.x + win.scrollX,
          y: box.y + win.scrollY,
          width: box.width,
          height: box.height,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
        }
      })
    })
}

for (const width of [1440, 1024])
  test(`section colour changes preserve formatting and geometry at ${width}px through undo and reload`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 1000 })
    const errors = listenForErrors(page)
    const address = await privateEventPage(page)
    await canvas(page).locator('h1').click()
    if (!(await page.getByRole('complementary', { name: 'Page structure', exact: true }).isVisible()))
      await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await treeLabels(page).first().click()
    await page.getByRole('tab', { name: 'Style', exact: true }).click()
    const before = await layout(page)
    const heading = canvas(page).locator('h1')
    const markup = await heading.innerHTML()
    const originalColour = await heading.evaluate(element => getComputedStyle(element).color)
    await page
      .getByRole('group', { name: 'Background', exact: true })
      .getByRole('button', { name: 'Dark', exact: true })
      .click()
    await expect(heading).toHaveCSS('color', 'rgb(255, 255, 255)')
    const after = await layout(page)
    expect(after).toHaveLength(before.length)
    for (const [index, measured] of after.entries()) {
      const original = before[index]!
      expect([measured.tag, measured.text, measured.fontSize, measured.lineHeight, measured.fontWeight]).toEqual([
        original.tag,
        original.text,
        original.fontSize,
        original.lineHeight,
        original.fontWeight,
      ])
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(
          Math.abs(measured[key] - original[key]),
          `${measured.tag} ${key} shifted after a colour-only change`,
        ).toBeLessThan(1)
      }
    }
    expect(await heading.innerHTML()).toBe(markup)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(heading).toHaveCSS('color', originalColour)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect(heading).toHaveCSS('color', 'rgb(255, 255, 255)')
    await saveDraft(page)
    await page.reload()
    await expect(canvas(page).locator('h1')).toHaveCSS('color', 'rgb(255, 255, 255)')
    expect((await rawRequest(address)).status).toBe(404)
    await expectNoErrors(page, errors)
  })

test('pointer reordering ignores adjacent and outside drops, preserves exact order and survives undo and reload', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const errors = listenForErrors(page)
  await privateEventPage(page)
  const tree = page.getByRole('complementary', { name: 'Page structure' })
  const names = () =>
    treeLabels(page).evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')!))
  const before = await names()
  expect(before.length).toBeGreaterThan(1)
  for (const toggle of await tree.getByRole('button', { name: /^Collapse / }).all()) await toggle.click()
  for (const gap of [0, 1]) {
    await tree.locator('.tree-section[draggable="true"]').first().dragTo(tree.locator('.tree-gap').nth(gap))
    expect(await names()).toEqual(before)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  }
  await tree.locator('.tree-section[draggable="true"]').first().dragTo(page.locator('.saved-state'))
  expect(await names()).toEqual(before)
  await expect(tree.locator('.drop-active')).toHaveCount(0)
  // Start the native drag before scrolling its offscreen destination into view.
  await page.evaluate(() => {
    const entries: unknown[] = []
    ;(window as unknown as { dragProof: unknown[] }).dragProof = entries
    for (const type of ['dragstart', 'dragover', 'drop', 'dragend'])
      document.addEventListener(
        type,
        event => {
          const drag = event as DragEvent,
            target = event.target instanceof Element ? event.target : null
          entries.push({
            type,
            x: drag.clientX,
            y: drag.clientY,
            target: target?.className,
            section: target?.closest('.tree-section')?.querySelector('.tree-label')?.getAttribute('aria-label'),
            gap: target?.closest('.tree-gap')?.textContent,
            types: [...(drag.dataTransfer?.types ?? [])],
          })
          if (entries.length > 200) entries.shift()
        },
        true,
      )
  })
  const source = tree.locator('.tree-section[draggable="true"]').first()
  await source.scrollIntoViewIfNeeded()
  const sourceBox = (await source.locator('.tree-label').boundingBox())!
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 12, sourceBox.y + sourceBox.height / 2 + 8, { steps: 4 })
  const destination = tree.locator('.tree-gap').last()
  await destination.scrollIntoViewIfNeeded()
  const destinationBox = (await destination.boundingBox())!
  await page.mouse.move(destinationBox.x + destinationBox.width / 2, destinationBox.y + destinationBox.height / 2, {
    steps: 15,
  })
  // WebKit can coalesce the final move while the tree scrolls. Resolve the
  // current gap and give native dragover another move before releasing it.
  await destination.hover()
  await destination.hover()
  await page.mouse.up()
  const moved = [...before.slice(1), before[0]!]
  try {
    await expect.poll(names).toEqual(moved)
  } catch (error) {
    await testInfo.attach('Native reorder events', {
      body: Buffer.from(
        JSON.stringify(await page.evaluate(() => (window as unknown as { dragProof: unknown[] }).dragProof), null, 2),
      ),
      contentType: 'application/json',
    })
    throw error
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(names).toEqual(before)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(names).toEqual(moved)
  await saveDraft(page)
  await page.reload()
  await expect.poll(names).toEqual(moved)
  await tree.getByLabel('Search this page', { exact: true }).fill('Hero')
  await expect(tree.locator('.tree-section[draggable="true"]')).toHaveCount(0)
  await expect(tree.locator('.tree-gap')).toHaveCount(0)
  await tree.getByLabel('Search this page', { exact: true }).fill('')
  await expect(tree.locator('.tree-section[draggable="true"]')).toHaveCount(before.length)
  await expectNoErrors(page, errors)
})

test('cancelling a native library drag clears its page indicator and the next drop inserts exactly one section', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors = listenForErrors(page)
  await privateEventPage(page)
  const names = () =>
    treeLabels(page).evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')!))
  const before = await names()
  await addSectionButton(page).click()
  const library = page.getByRole('dialog', { name: /^Add a section/ })
  const card = library.getByTestId('library-card-core-event-hero')
  const name =
    (await card.getByRole('heading', { name: 'Event hero', exact: true }).textContent())!.trim() +
    ' — A shared purpose. A stronger community.'
  await card.scrollIntoViewIfNeeded()
  const target = canvas(page).locator('[data-cms-section="0"]')
  await target.scrollIntoViewIfNeeded()
  const source = (await card.boundingBox())!
  const box = (await target.boundingBox())!
  await page.mouse.move(source.x + 20, source.y + 20)
  await page.mouse.down()
  await page.mouse.move(source.x + 40, source.y + 35, { steps: 4 })
  await page.mouse.move(box.x + 30, box.y + 15, { steps: 15 })
  await page.mouse.move(box.x + 31, box.y + 16)
  await expect(canvas(page).locator('[data-cms-drop-line]')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(canvas(page).locator('[data-cms-drop-line]')).toHaveCount(0)
  await expect(canvas(page).locator('[data-cms-section]')).toHaveCount(before.length)
  if (await library.isVisible()) await library.getByRole('button', { name: 'Back', exact: true }).click()
  await expect.poll(names).toEqual(before)
  await addSectionButton(page).click()
  await dragLibraryCardToCanvas(page, card, target)
  await expect(library.getByRole('button', { name: 'Add this section', exact: true })).toBeEnabled()
  await library.getByRole('button', { name: 'Add this section', exact: true }).click()
  await expect(library).toHaveCount(0)
  await expect.poll(names).toEqual([name, ...before])
  await expect(canvas(page).locator('[data-cms-drop-line]')).toHaveCount(0)
  await saveDraft(page)
  await page.reload()
  await expect.poll(names).toEqual([name, ...before])
  await expectNoErrors(page, errors)
})

test('inserting an unfinished collection section keeps the rest of a private draft editable after reload', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors = listenForErrors(page)
  const address = await privateEventPage(page, 'resource')
  const before = await treeLabels(page).allTextContents()
  await addSectionButton(page).click()
  await page
    .getByTestId('library-card-speakers-listing')
    .getByRole('button', { name: /^Add .+ (?:after|before|between|as the first)/ })
    .click()
  await page
    .getByRole('dialog', { name: 'Add a section', exact: true })
    .getByRole('button', { name: 'Add this section', exact: true })
    .click()
  await expect(canvas(page).locator('h1')).toHaveText('Private interaction draft')
  await expect(
    canvas(page).getByText('Choose a list in Content to finish this section.', { exact: true }),
  ).toBeVisible()
  await expect(treeLabels(page)).toHaveCount(before.length + 1)
  await saveDraft(page)
  await page.reload()
  await expect(canvas(page).locator('h1')).toHaveText('Private interaction draft')
  await expect(
    canvas(page).getByText('Choose a list in Content to finish this section.', { exact: true }),
  ).toBeVisible()
  expect((await rawRequest(address)).status).toBe(404)
  await expectNoErrors(page, errors)
})
