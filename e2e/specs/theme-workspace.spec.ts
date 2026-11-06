import { E2E_PORTS } from '../test-ports.ts'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page, type Locator } from '@playwright/test'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
const folder = resolve('../.r8-progress/step-4/site-look-style')
let fixture: Awaited<ReturnType<typeof siteLookFixture>>
test.beforeEach(async () => {
  fixture = await siteLookFixture()
})
test.afterEach(async () => {
  await fixture.pool.end()
})
const preview = (page: Page) => page.frameLocator('iframe[title="Site look page preview"]')
async function openLook(page: Page, email = 'root@example.test', wait = true) {
  await signIn(page, email)
  await page.goto(`/sites/${fixture.site}/design`)
  await expect(page.getByRole('heading', { name: 'Site look', exact: true })).toBeVisible()
  if (wait) {
    await expect(preview(page).locator('h1')).toHaveText('Welcome')
    expect(await preview(page).locator('.cms-section').count()).toBeGreaterThan(0)
  }
}
async function capture(page: Page, name: string, target?: Locator) {
  await expect(page.getByRole('status').filter({ hasText: 'Updating site preview…' })).toHaveCount(0)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    if (target) {
      await target.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
      await expect(target).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('group', { name: 'Site look controls', exact: true })).toBeVisible()
    }
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: resolve(folder, `${name}-${width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const save = page.getByRole('button', { name: 'Save draft', exact: true })
    if (await save.count()) await expect(save).toBeInViewport({ ratio: 1 })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
async function saveTheme(page: Page) {
  const save = page.getByRole('button', { name: 'Save draft', exact: true })
  await save.click()
  await expect(save).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('status').filter({ hasText: 'Design draft saved.' })).toBeVisible()
  await expect(save).toBeDisabled()
}
async function more(page: Page, name: string) {
  const summary = page.locator('summary').filter({ hasText: new RegExp('^' + name + '$') })
  if (!(await summary.evaluate(node => (node.parentElement as HTMLDetailsElement).open))) await summary.click()
}
async function addAction() {
  const client = await fixture.pool.connect()
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const rows = (
        await client.query(
          'SELECT e.kind,e.revision,v.content FROM global_elements e JOIN global_element_versions v ON v.id=e.draft_version_id WHERE e.site_id=$1',
          [fixture.site],
        )
      ).rows,
      header = rows.find(row => row.kind === 'header')!,
      footer = rows.find(row => row.kind === 'footer')!
    header.content.cta = { label: 'Explore', target: { type: 'page', page_id: fixture.pages[1] } }
    await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      fixture.site,
      header.revision,
      footer.revision,
      JSON.stringify(header.content),
      JSON.stringify(footer.content),
    ])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
test('keeps a theme draft private, previews the real page, then publishes it site-wide', async ({ page, context }) => {
  test.setTimeout(90000)
  await openLook(page)
  const before = await rawRequest({ host: fixture.host, path: '/' })
  await page.getByLabel('Brand', { exact: true }).fill('#0055aa')
  await expect(preview(page).locator('.cms-site-header')).toHaveCSS('border-top-color', 'rgb(0, 85, 170)')
  await expect(page.getByText('Saved changes are not live yet', { exact: true })).toBeVisible()
  await capture(page, 'four-colours', page.getByLabel('Brand', { exact: true }))
  await saveTheme(page)
  expect((await rawRequest({ host: fixture.host, path: '/' })).body).toBe(before.body)
  await page.getByRole('button', { name: 'Publish site look', exact: true }).click()
  const affected = page.getByRole('dialog', { name: 'Publish site look', exact: true })
  await expect(affected).toContainText('Welcome')
  await expect(affected).toContainText('Visit us')
  await capture(page, 'affected-pages')
  await affected.getByRole('button', { name: 'Review site look changes', exact: true }).click()
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await expect(page.getByLabel('Selected changes review', { exact: true })).toContainText(/pages checked, all ready/)
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
  await expect
    .poll(async () => (await rawRequest({ host: fixture.host, path: '/' })).body)
    .toContain('--color-primary:#0055aa')
  const live = await context.newPage()
  await live.goto('http://' + fixture.host + `:${E2E_PORTS.site}/`)
  await expect(live.locator('.cms-site-header')).toHaveCSS('border-top-color', 'rgb(0, 85, 170)')
  await live.close()
})
test('blocks low-contrast publication and restores a private draft from live', async ({ page }) => {
  test.setTimeout(60000)
  await openLook(page)
  await page.getByLabel('Brand', { exact: true }).fill('#777777')
  await page.getByRole('button', { name: 'Advanced colours', exact: true }).click()
  await page.getByLabel('On primary', { exact: true }).fill('#ffffff')
  await expect(page.getByText('4.4:1 Needs 4.5:1').first()).toBeVisible()
  await capture(page, 'low-contrast', page.getByLabel('On primary', { exact: true }))
  await saveTheme(page)
  await expect(page.getByRole('button', { name: 'Publish site look', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert').filter({ hasText: 'Improve colour contrast before publishing.' })).toBeVisible()
  expect((await rawRequest({ host: fixture.host, path: '/' })).body).not.toContain('--color-primary:#777777')
  await page.getByRole('button', { name: 'Revert to live', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revert draft', exact: true }).click()
  await expect(
    page.getByText('The draft now matches the live design. Published pages were not changed.', { exact: true }),
  ).toBeVisible()
  const row = (
    await fixture.pool.query(
      'SELECT d.tokens AS draft,l.tokens AS live FROM themes t JOIN theme_versions d ON d.id=t.draft_version_id JOIN theme_versions l ON l.id=t.published_version_id WHERE t.site_id=$1',
      [fixture.site],
    )
  ).rows[0]!
  expect(row.draft).toEqual(row.live)
})
test('shared national appearance aliases save privately and publish with readable phone output', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000)
  await openLook(page)
  const before = (await rawRequest({ host: fixture.host, path: '/' })).body
  await page.getByLabel('Theme preset', { exact: true }).selectOption('National')
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('#ef3e42')
  await expect(preview(page).locator('body')).toHaveCSS('background-color', 'rgb(217, 217, 217)')
  await expect(page.getByLabel('Page layout', { exact: true })).toHaveValue('panels')
  await page.getByLabel('Page layout', { exact: true }).selectOption('standard')
  await expect(preview(page).locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.getByLabel('Page layout', { exact: true }).selectOption('panels')
  await expect(preview(page).locator('body')).toHaveCSS('background-color', 'rgb(217, 217, 217)')
  page.once('dialog', async dialog => {
    expect(dialog.message()).toBe('Replace your unsaved colour, font and button choices with this preset?')
    await dialog.accept()
  })
  await page.getByLabel('Theme preset', { exact: true }).selectOption('Echelon')
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('#ef3e42')
  await expect(preview(page).locator('.cms-section').first()).toHaveCSS('border-radius', '0px')
  await expect(preview(page).locator('.national-content-panel').first()).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
  await expect(page.getByLabel('Page layout', { exact: true })).toHaveCount(0)
  await expect(page.getByText('The national template sets the page layout.', { exact: true })).toBeVisible()
  await expect(
    page.getByText('The national template keeps the approved red and white button colours.', { exact: true }),
  ).toBeVisible()
  const evidence = resolve('../.r8-progress/echelon/theme')
  await mkdir(evidence, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.getByText('The national template sets the page layout.', { exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByText('The national template sets the page layout.', { exact: true })).toBeInViewport()
    await page.screenshot({ path: resolve(evidence, 'site-look-' + width + '.png'), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect(preview(page).locator('body')).toHaveCSS('background-color', 'rgb(217, 217, 217)')
  expect(
    await preview(page)
      .locator('html')
      .evaluate(node => node.scrollWidth <= node.clientWidth),
  ).toBe(true)
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.screenshot({ path: resolve(evidence, 'phone-preview-' + width + '.png'), animations: 'disabled' })
  }
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await saveTheme(page)
  expect((await rawRequest({ host: fixture.host, path: '/' })).body).toBe(before)
  await page.getByRole('button', { name: 'Publish site look', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Publish site look', exact: true })
    .getByRole('button', { name: 'Review site look changes', exact: true })
    .click()
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await expect(page.getByLabel('Selected changes review', { exact: true })).toContainText(/pages checked, all ready/)
  await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
  const visitor = await browser.newContext({ javaScriptEnabled: false })
  try {
    for (const width of [1440, 1024, 390]) {
      const live = await visitor.newPage()
      await live.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await live.goto('http://' + fixture.host + `:${E2E_PORTS.site}/`)
      await expect(live.locator('h1')).toHaveText('Welcome')
      await expect(live.locator('body')).toHaveCSS('background-color', 'rgb(217, 217, 217)')
      await expect(live.locator('.cms-section').first()).toHaveCSS('border-radius', '0px')
      await expect(live.locator('.national-content-panel').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      expect(await live.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await live.screenshot({ path: resolve(evidence, 'public-' + width + '.png'), animations: 'disabled' })
      await live.close()
    }
  } finally {
    await visitor.close()
  }
})
test('shows self-hosted font specimens and visual button styles on the actual page', async ({ page }) => {
  test.setTimeout(120000)
  const fontErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error' && /Content-Security-Policy|downloadable font/i.test(message.text()))
      fontErrors.push(message.text())
  })
  await addAction()
  await openLook(page)
  const before = await rawRequest({ host: fixture.host, path: '/' }),
    preset = page.getByLabel('Theme preset', { exact: true })
  for (const name of ['National', 'Better Together 2027', 'Echelon', 'SAWSO', 'Neutral'])
    await expect(preset.locator('option').filter({ hasText: new RegExp('^' + name + '$') })).toHaveCount(1)
  await preset.selectOption('Better Together 2027')
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('#175777')
  for (const name of ['Modern', 'Reading', 'Editorial']) {
    const choice = page.getByRole('button', { name: 'Use ' + name + ' type', exact: true })
    await choice.click()
    await expect(choice).toHaveAttribute('aria-pressed', 'true')
    await expect(preview(page).locator(name === 'Reading' ? 'body' : 'h1')).toHaveCSS(
      'font-family',
      /Source Serif 4|Open Sans/,
    )
  }
  await expect(preview(page).locator('h1')).toHaveCSS('font-family', /Source Serif 4/)
  await expect
    .poll(() =>
      preview(page)
        .locator('h1')
        .evaluate(async node => {
          await node.ownerDocument.fonts.ready
          return node.ownerDocument.fonts.check('700 20px "Source Serif 4"')
        }),
    )
    .toBe(true)
  await capture(page, 'font-specimens', page.getByRole('button', { name: 'Use Editorial type', exact: true }))
  await page.getByRole('button', { name: 'Use Outline buttons', exact: true }).click()
  await expect(preview(page).getByRole('link', { name: 'Explore', exact: true })).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await capture(page, 'button-styles', page.getByRole('button', { name: 'Use Outline buttons', exact: true }))
  await page.getByRole('button', { name: 'Use Pill button shape', exact: true }).click()
  await page.getByRole('button', { name: 'Use Lift button hover', exact: true }).click()
  await more(page, 'More button options')
  await page.getByLabel('Hover speed', { exact: true }).selectOption('slow')
  const action = preview(page).getByRole('link', { name: 'Explore', exact: true })
  await expect(action).toHaveCSS('border-radius', '16px')
  await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.getByRole('status').filter({ hasText: 'Updating site preview…' })).toHaveCount(0)
  await action.hover()
  await expect(action).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -2)')
  await capture(page, 'button-shapes', page.getByRole('button', { name: 'Use Pill button shape', exact: true }))
  await capture(page, 'button-hover', page.getByRole('button', { name: 'Use Lift button hover', exact: true }))
  await saveTheme(page)
  expect((await rawRequest({ host: fixture.host, path: '/' })).body).toBe(before.body)
  const saved = (
    await fixture.pool.query(
      'SELECT v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
      [fixture.site],
    )
  ).rows[0]!.tokens
  expect(saved.fonts.heading).toContain('Source Serif 4')
  expect(saved.buttons).toMatchObject({ style: 'outline', radius: '1rem', hover: 'lift', speed: 'slow' })
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect(preview(page).locator('iframe')).toHaveCount(0)
  await capture(page, 'styled-phone')
  await page.getByRole('button', { name: 'Use the standard Salvation Army starting design', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Use starting design', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Use Filled buttons', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Use Darken button hover', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('#175777')
  expect(fontErrors).toEqual([])
})
test('keeps Editors in an honest read-only theme workspace', async ({ page }) => {
  await openLook(page, 'editor@example.test')
  await expect(
    page.getByText('You can inspect this design. A site administrator can change it.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Brand', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('Theme preset', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Use Editorial type', exact: true })).toBeDisabled()
  await capture(page, 'editor-theme-permissions', page.getByRole('button', { name: 'Use Editorial type', exact: true }))
})
test('keeps the real preview and theme controls usable at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1100 })
  await openLook(page)
  await expect(page.getByRole('heading', { name: 'Colours', exact: true })).toBeVisible()
  await expect(page.locator('iframe[title="Site look page preview"]')).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('clears a failed preview, retries it, and preserves the last valid page while a colour is incomplete', async ({
  page,
}) => {
  test.setTimeout(60000)
  await openLook(page)
  const endpoint = '**/api/sites/*/global-elements/preview'
  await page.route(endpoint, route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.getByLabel('Brand', { exact: true }).fill('#226688')
  const failure = page.getByRole('alert').filter({ hasText: 'The preview could not be rendered.' })
  await expect(failure).toBeVisible()
  await expect(page.locator('iframe[title="Site look page preview"]')).toHaveCount(0)
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('#226688')
  await capture(page, 'preview-error', page.getByLabel('Brand', { exact: true }))
  await page.unroute(endpoint)
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await expect(preview(page).locator('.cms-site-header')).toHaveCSS('border-top-color', 'rgb(34, 102, 136)')
  await expect(failure).toHaveCount(0)
  await page.getByLabel('Brand', { exact: true }).fill('#12')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Enter complete six-digit colours before saving.' }),
  ).toBeVisible()
  await expect(preview(page).locator('.cms-site-header')).toHaveCSS('border-top-color', 'rgb(34, 102, 136)')
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Publish site look', exact: true })).toBeDisabled()
  await capture(page, 'incomplete-colour', page.getByLabel('Brand', { exact: true }))
})
test('leaving during a preview request does not raise an unhandled cancellation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const endpoint = '**/api/sites/*/global-elements/preview'
  let release: () => void = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  await page.route(endpoint, async route => {
    await held
    await route.abort('aborted').catch(() => {})
  })
  const requested = page.waitForRequest(endpoint)
  await openLook(page, 'root@example.test', false)
  await requested
  await page.getByRole('link', { name: 'Pages', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible()
  release()
  await page.evaluate(
    () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  expect(errors).toEqual([])
})
