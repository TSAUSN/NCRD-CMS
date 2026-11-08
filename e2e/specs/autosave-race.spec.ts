// The autosave acknowledgement race, in a real browser (SPEC §6.4).
//
// The editor used to mark "whatever is on screen now" as saved when a response
// arrived, so text typed while a save was in flight was declared saved without
// ever reaching the server — and, because nothing then looked dirty, no further
// autosave fired. A refresh lost it silently.
//
// Every interleaving here is driven deliberately. Each save request parks until
// the test hands it a permit, so "A's response arrives while B is untyped" is
// something the test *causes* rather than something it hopes a timer produces.
import { expect, type Page } from '@playwright/test'
import { test } from './fixtures/shared-demo-home.ts'
import { canvas, clickOnCanvas, openSeededPage, saveDraft, savedState, signIn, typeInInspector } from './helpers.ts'

/**
 * Park every server action until released, one at a time.
 *
 * Server actions POST to the page's own URL, so matching on method is enough
 * and leaves navigation alone.
 */
function parkServerActions(page: Page) {
  const waiting: (() => void)[] = []
  let started = 0
  // Once opened, the gate stops parking: later requests pass straight through.
  // Without this, a follow-up save that arrives after releaseAll() parks
  // forever and the editor sits on "Saving…" for reasons the test invented.
  let open = false

  void page.route('**', async (route, request) => {
    if (request.method() !== 'POST') return route.continue()
    started += 1
    if (!open) await new Promise<void>(resolve => waiting.push(resolve))
    return route.continue()
  })

  return {
    /** How many requests have arrived at the gate. */
    started: () => started,
    /** How many are parked right now. */
    parked: () => waiting.length,
    releaseOne: () => waiting.shift()?.(),
    releaseAll: () => {
      open = true
      while (waiting.length) waiting.shift()?.()
    },
  }
}

test.beforeEach(async ({ page }) => {
  await signIn(page, 'editor@example.test')
  await openSeededPage(page)
})

test.describe('text typed during an in-flight save', () => {
  test('stays unsaved, and the follow-up save persists it', async ({ page }) => {
    await clickOnCanvas(page, 'heading')

    const textA = `A ${Date.now()}`
    const textB = `B ${Date.now()}`
    const gate = parkServerActions(page)

    // Type A. Its autosave reaches the gate and parks there.
    await typeInInspector(page, 0, 'heading', textA)
    await expect(savedState(page)).toHaveText('Unsaved changes')
    await expect.poll(() => gate.parked(), { timeout: 15_000 }).toBe(1)

    // Type B while A's request is still open.
    await typeInInspector(page, 0, 'heading', textB)
    expect(gate.parked()).toBe(1) // still just A in flight

    // Let A's response land — and only A's.
    gate.releaseOne()

    // B never reached the server. Marking it saved here is exactly the bug:
    // the indicator would lie and no further autosave would ever fire.
    await expect(savedState(page)).toHaveText('Unsaved changes')

    // The follow-up save carries B, with no further prompting from anyone.
    await expect.poll(() => gate.started(), { timeout: 15_000 }).toBeGreaterThan(1)
    gate.releaseAll()
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 15_000 })

    // And it is really on the server — proved by throwing the browser away.
    await page.unroute('**')
    await page.reload()
    await clickOnCanvas(page, 'heading')
    await expect(page.locator('#slot-0-heading')).toHaveValue(textB)
    await expect(canvas(page).locator('h1')).toHaveText(textB)
  })

  test('two saves never run at once, and never reuse a revision', async ({ page }) => {
    await clickOnCanvas(page, 'heading')
    const gate = parkServerActions(page)

    await typeInInspector(page, 0, 'heading', `first ${Date.now()}`)
    await expect.poll(() => gate.parked(), { timeout: 15_000 }).toBe(1)

    await typeInInspector(page, 0, 'heading', `second ${Date.now()}`)
    await typeInInspector(page, 0, 'heading', `third ${Date.now()}`)

    // However much is typed, exactly one request is ever open: the queue holds
    // the rest back so they cannot send the same revision.
    await page.waitForTimeout(2500)
    expect(gate.parked()).toBe(1)

    gate.releaseAll()
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 15_000 })
    // A revision race would have surfaced as a conflict nobody caused.
    await expect(page.getByText(/Someone else saved this page/)).toHaveCount(0)
  })

  test('a burst of typing settles on the last thing typed', async ({ page }) => {
    await clickOnCanvas(page, 'heading')

    const final = `Final ${Date.now()}`
    for (const value of ['one', 'two', 'three', final]) {
      await typeInInspector(page, 0, 'heading', value)
    }

    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 15_000 })
    await page.reload()
    await clickOnCanvas(page, 'heading')
    await expect(page.locator('#slot-0-heading')).toHaveValue(final)
  })
})

test.describe('publishing while a save is in flight', () => {
  test('does not race the revision, and publishes the latest text', async ({ page }) => {
    await clickOnCanvas(page, 'heading')

    const text = `Published under load ${Date.now()}`
    const gate = parkServerActions(page)
    await typeInInspector(page, 0, 'heading', text)
    await expect.poll(() => gate.parked(), { timeout: 15_000 }).toBe(1)

    // Press Publish while the autosave is still open.
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const publishing = page
      .getByRole('dialog', { name: 'Publish this page', exact: true })
      .getByRole('button', { name: 'Publish', exact: true })
      .click()

    // Serialization is visible right here: publish does not even issue a
    // request while the autosave is open. It waits its turn rather than sending
    // a second request with the same revision, which is what produced a
    // conflict the person did not cause.
    await page.waitForTimeout(1500)
    expect(gate.started()).toBe(1)

    gate.releaseAll()
    await publishing

    await expect(page.getByText('Published. The live page now shows these changes.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Someone else saved this page/)).toHaveCount(0)

    await page.unroute('**')
    await page.reload()
    await clickOnCanvas(page, 'heading')
    await expect(page.locator('#slot-0-heading')).toHaveValue(text)
  })

  test('a page saved and published repeatedly never self-conflicts', async ({ page }) => {
    await clickOnCanvas(page, 'heading')

    for (let round = 0; round < 3; round += 1) {
      await typeInInspector(page, 0, 'heading', `Round ${round} ${Date.now()}`)
      await saveDraft(page)
      await page.getByRole('button', { name: 'Publish', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Publish this page', exact: true })
        .getByRole('button', { name: 'Publish', exact: true })
        .click()
      await expect(page.getByText('Published. The live page now shows these changes.')).toBeVisible()
    }

    await expect(page.getByText(/Someone else saved this page/)).toHaveCount(0)
  })
})
