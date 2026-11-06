import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { sectionStartingValues } from '@cms/schema'
import { e2eTarget } from '../test-target.ts'
import { canvas, savedState, saveDraft, signIn, treeLabels, fetchPublic } from './helpers.ts'
const folder = resolve('../.r8-progress/step-3/editor')
async function capture(page: Page, name: string) {
  await mkdir(folder, { recursive: true })
  await expect(page.getByText('Opening the page preview…', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Updating page preview…', { exact: true })).toHaveCount(0)
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size)
    await expect
      .poll(() =>
        page.locator('.canvas-viewport').evaluate(viewport => {
          const frame = viewport.querySelector('iframe')
          return (
            !frame ||
            viewport.getAttribute('data-zoom') !== 'fit' ||
            Math.abs(
              frame.getBoundingClientRect().width -
                Math.min(
                  viewport.clientWidth - Number.parseFloat(getComputedStyle(viewport).paddingInlineStart || '0'),
                  Number.parseFloat(getComputedStyle(frame).width),
                ),
            ) < 2
          )
        }),
      )
      .toBe(true)
    await page.evaluate(
      () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    const itemControls = page.getByRole('toolbar', { name: /^Selected (?:card|list item) actions$/ })
    if (await itemControls.count()) {
      const controls = await itemControls.boundingBox(),
        frame = await page.locator('iframe[title="Page canvas"]').boundingBox()
      expect(controls).not.toBeNull()
      expect(frame).not.toBeNull()
      expect(controls!.y + controls!.height).toBeLessThanOrEqual(frame!.y + 1)
    }
    await page.screenshot({ path: resolve(folder, `${name}-${size.width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
async function fixture(
  slugs: readonly string[] = ['core-page-header', 'core-text-image', 'core-icon-cards'],
  publish = true,
) {
  const { database, host, port } = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  try {
    await client.query('BEGIN')
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    const pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        'r8-editor-' + Date.now(),
        'A page for revision 8 editing',
      ])
    ).rows[0]!.id
    const sections = []
    for (const slug of slugs) {
      const definition = (
        await client.query(
          'SELECT d.id,v.version,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug=$1 ORDER BY v.version DESC LIMIT 1',
          [slug],
        )
      ).rows[0]!
      sections.push({
        section_def_id: definition.id,
        section_def_version: definition.version,
        values: {
          ...sectionStartingValues(definition.slots),
          heading:
            slug === 'core-page-header'
              ? 'A welcoming place to begin'
              : slug === 'core-text-image'
                ? 'A story worth sharing'
                : 'Ideas into action',
        },
      })
    }
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify(sections),
      '{"description":"A useful description of this welcoming page for the local editor test."}',
    ])
    if (publish) await client.query('SELECT app.publish_page($1,1,1,NULL,$2)', [pageId, '[]'])
    await client.query('COMMIT')
    return pageId as string
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}
test('revision 8: canvas actions, one history, inspector tabs, actual-content layout choices and confirmed live recovery', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const id = await fixture()
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${id}`)
  await expect(canvas(page).locator('h1')).toHaveText('A welcoming place to begin')
  await capture(page, 'editor-overview')
  await treeLabels(page).nth(0).click()
  const initialToolbar = await page
    .getByRole('toolbar', { name: 'Selected section actions', exact: true })
    .boundingBox()
  const initialHeading = await canvas(page).locator('h1').boundingBox()
  expect(initialToolbar).not.toBeNull()
  expect(initialHeading).not.toBeNull()
  expect(
    initialToolbar!.x + initialToolbar!.width <= initialHeading!.x ||
      initialToolbar!.x >= initialHeading!.x + initialHeading!.width ||
      initialToolbar!.y + initialToolbar!.height <= initialHeading!.y ||
      initialToolbar!.y >= initialHeading!.y + initialHeading!.height,
  ).toBe(true)
  await treeLabels(page).nth(1).click()
  const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
  await expect(inspector.getByRole('tab')).toHaveText(['Content', 'Style', 'Visibility', 'Advanced'])
  const heading = inspector.getByLabel('Heading', { exact: true })
  await heading.fill('A change that must survive Duplicate then Undo')
  await expect(savedState(page)).toHaveText('All changes saved')
  const toolbar = page.getByRole('toolbar', { name: 'Selected section actions' })
  await toolbar.getByRole('button', { name: 'Duplicate section', exact: true }).click()
  await expect(treeLabels(page)).toHaveCount(4)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(treeLabels(page)).toHaveCount(3)
  await treeLabels(page).nth(1).click()
  await expect(heading).toHaveValue('A change that must survive Duplicate then Undo')
  await capture(page, 'selected-section-actions')
  await inspector.getByRole('tab', { name: 'Style', exact: true }).click()
  await inspector.getByRole('button', { name: 'Dark', exact: true }).click()
  await inspector
    .getByRole('group', { name: 'Image position', exact: true })
    .getByRole('button', { name: 'Right', exact: true })
    .click()
  await expect(savedState(page)).toHaveText('All changes saved')
  await capture(page, 'style-capabilities')
  await inspector.getByRole('tab', { name: 'Visibility', exact: true }).click()
  await inspector.getByLabel('Hide until ready', { exact: true }).check()
  await expect(canvas(page).locator('[data-cms-hidden]')).toHaveCount(1)
  await expect(page.getByText(/1 section is hidden from visitors/)).toBeVisible()
  await capture(page, 'hidden-section')
  await inspector.getByLabel('Hide until ready', { exact: true }).uncheck()
  await inspector.getByRole('tab', { name: 'Advanced', exact: true }).click()
  await inspector.getByRole('button', { name: 'Change link name', exact: true }).click()
  const linkName = page.getByRole('complementary', { name: 'Section tools', exact: true })
  await linkName.getByLabel('Link name', { exact: true }).fill('speakers-and-stories')
  await linkName.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(linkName.getByRole('status')).toContainText('Link name saved.')
  await linkName.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(inspector).toBeVisible()
  await saveDraft(page)
  await expect(canvas(page).locator('#speakers-and-stories')).toHaveCount(1)
  await capture(page, 'advanced-anchor')
  await inspector.getByRole('tab', { name: 'Style', exact: true }).click()
  await inspector.getByRole('button', { name: /^Layout:/ }).click()
  const chooser = page.getByRole('dialog', { name: 'Choose a layout', exact: true })
  await expect(chooser.getByRole('button', { name: 'Show other layouts', exact: true })).toBeVisible()
  await capture(page, 'no-lossless-layout')
  await chooser.getByRole('button', { name: 'Show other layouts', exact: true }).click()
  await expect(chooser.getByRole('button', { name: /^Review / }).first()).toBeVisible()
  await expect(chooser.locator('iframe').first()).toHaveAttribute('sandbox', 'allow-same-origin')
  await capture(page, 'compatible-layouts')
  await chooser.getByRole('button', { name: 'Close Choose a layout', exact: true }).click()
  await toolbar.getByLabel('More section actions', { exact: true }).click()
  await toolbar.getByRole('button', { name: 'Reset to live version', exact: true }).click()
  const reset = page.getByRole('dialog', { name: 'Reset to live version?', exact: true })
  await reset.getByLabel('Section on the live page').selectOption('1')
  await capture(page, 'reset-live-confirmation')
  await reset.getByRole('button', { name: 'Reset to live version', exact: true }).click()
  await expect(reset).toBeHidden()
  await inspector.getByRole('tab', { name: 'Content', exact: true }).click()
  await expect(heading).toHaveValue('A story worth sharing')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(heading).toHaveValue('A change that must survive Duplicate then Undo')
  await page.getByLabel('More page actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Discard all unpublished changes', exact: true }).click()
  await capture(page, 'discard-confirmation')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard unpublished changes', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
  await treeLabels(page).nth(1).click()
  await expect(heading).toHaveValue('A story worth sharing')
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect(page.locator('iframe[title="Page canvas"]')).toHaveCSS('width', '390px')
  await expect(canvas(page).locator('.cms-phone-menu')).toBeVisible()
  await expect(canvas(page).locator('.cms-phone-menu')).not.toHaveAttribute('open')
  await canvas(page).locator('.cms-phone-menu summary').click()
  await expect(canvas(page).locator('.cms-phone-menu')).toHaveAttribute('open', '')
  await expect
    .poll(async () => {
      const tools = await page.getByRole('toolbar', { name: 'Selected section actions', exact: true }).boundingBox()
      const frame = await page.locator('iframe[title="Page canvas"]').boundingBox()
      return Boolean(tools && frame && tools.y + tools.height <= frame.y)
    })
    .toBe(true)
  await capture(page, 'phone-preview-native-menu')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await page.getByLabel('More page actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Page settings', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Page settings', exact: true })).toBeVisible()
  const settings = page.getByRole('dialog', { name: 'Page settings', exact: true })
  await expect(settings.getByLabel('Page title', { exact: true })).toBeVisible()
  await expect(settings.getByText('✓ Has a main heading', { exact: true })).toBeVisible()
  await capture(page, 'page-settings')
  const oldAddress = await settings.getByLabel('Page address', { exact: true }).inputValue()
  await settings.getByLabel('Page address', { exact: true }).fill('')
  await expect(settings.getByText('Another page already uses this address.', { exact: true })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Save page details', exact: true })).toBeDisabled()
  await capture(page, 'page-address-collision')
  await settings.getByLabel('Page address', { exact: true }).fill(oldAddress + '-updated')
  await settings.getByLabel('Page title', { exact: true }).fill('A clear page title')
  const parentId = await settings
    .getByLabel('Parent page', { exact: true })
    .locator('option')
    .nth(1)
    .getAttribute('value')
  expect(parentId).toBeTruthy()
  await settings.getByLabel('Parent page', { exact: true }).selectOption(parentId!)
  await settings.getByRole('button', { name: 'Save page details', exact: true }).click()
  await expect(settings.getByText(/Page details saved\./)).toBeVisible()
  expect((await fetchPublic('/' + oldAddress)).status).toBe(200)
  expect((await fetchPublic('/' + oldAddress + '-updated')).status).toBe(404)
  await capture(page, 'page-details-saved')
  await settings.getByRole('heading', { name: 'Danger zone', exact: true }).scrollIntoViewIfNeeded()
  await capture(page, 'page-checklist-and-danger-zone')
  await settings.getByRole('button', { name: 'Close Page settings', exact: true }).click()
  await page.getByLabel('More page actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Discard all unpublished changes', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard unpublished changes', exact: true }).click()
  await expect(page.locator('.editor-title strong').filter({ hasText: 'A page for revision 8 editing' })).toBeVisible()
  await saveDraft(page)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.editor-title strong').filter({ hasText: 'A clear page title' })).toBeVisible()
  await saveDraft(page)
  await page.reload()
  await expect(page.locator('.editor-title strong').filter({ hasText: 'A clear page title' })).toBeVisible()
  await page.getByLabel('More page actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Page settings', exact: true }).click()
  await expect(settings.getByLabel('Page address', { exact: true })).toHaveValue(oldAddress + '-updated')
  await settings.getByRole('button', { name: 'Close Page settings', exact: true }).click()
  await treeLabels(page).nth(2).click()
  await expect(canvas(page).locator('[data-cms-editor-ghost]')).toHaveCount(0)
  await canvas(page).locator('[data-cms-slot="cards__i1__title"]').click()
  await expect(page.getByRole('toolbar', { name: 'Selected card actions', exact: true })).toHaveCount(0)
  await capture(page, 'repeat-hover-and-ghost')
  await inspector.getByRole('button', { name: 'Change icon: People', exact: true }).first().click()
  const icons = page.getByRole('dialog', { name: 'Choose an icon', exact: true })
  await icons.getByRole('searchbox', { name: 'Search icons', exact: true }).fill('calendar')
  await capture(page, 'visual-icon-picker')
  await icons.getByRole('button', { name: 'Calendar', exact: true }).click()
  await inspector.getByRole('button', { name: 'Done', exact: true }).click()
  await inspector.getByRole('button', { name: 'Add a card', exact: true }).click()
  await expect(canvas(page).locator('[data-cms-slot="cards__i4__title"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(canvas(page).locator('[data-cms-slot="cards__i4__title"]')).toHaveCount(0)
  const actions = page.getByRole('toolbar', { name: 'Selected section actions', exact: true })
  await actions.getByLabel('More section actions', { exact: true }).click()
  await actions.getByRole('button', { name: 'Copy section', exact: true }).click()
  await page.getByRole('button', { name: 'Add section below', exact: true }).click()
  await page.getByRole('button', { name: /^Paste copied section/ }).click()
  await expect(treeLabels(page)).toHaveCount(4)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(treeLabels(page)).toHaveCount(3)
  expect(errors).toEqual([])
})

test('revision 8: native header and footer clicks offer site-level handoffs without changing the page or menu', async ({
  page,
}) => {
  const id = await fixture(),
    { database, host, port } = e2eTarget(),
    client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  try {
    const site = (await client.query('SELECT site_id FROM pages WHERE id=$1', [id])).rows[0]!.site_id,
      before = (await client.query('SELECT * FROM navigations WHERE site_id=$1', [site])).rows
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + id)
    await canvas(page).locator('header .cms-site-brand').click()
    const panel = page.getByRole('complementary', { name: 'Site-wide settings', exact: true })
    await expect(panel.getByText(/Header: on all/)).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Open Header & menu', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + site + '/header',
    )
    await expect(panel.getByRole('button', { name: 'Edit header', exact: true })).toHaveCount(0)
    await expect(canvas(page).getByLabel('Add page to menu', { exact: true })).toHaveCount(0)
    await capture(page, 'site-wide-header-selected')
    await panel.getByRole('button', { name: 'Done', exact: true }).click()
    await canvas(page).locator('footer').click()
    await expect(panel.getByText(/Footer: on all/)).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Open Footer', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + site + '/footer',
    )
    await capture(page, 'site-wide-footer-selected')
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    expect((await client.query('SELECT * FROM navigations WHERE site_id=$1', [site])).rows).toEqual(before)
  } finally {
    await client.end()
  }
})

test('revision 8: an Editor adds and edits a shared speaker on the page without changing public output', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const { database, host, port } = e2eTarget(),
    client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  let listId = '',
    before: unknown[] = []
  try {
    const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [root])
    let list = (
      await client.query(
        "SELECT id,published_schema_version_id,entry_revision FROM collections WHERE site_id=$1 AND reader_key='speakers'",
        [site],
      )
    ).rows[0]
    if (!list) {
      const { demoSpeakersCollection: source } = await import('@cms/seeds')
      const created = (
        await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          site,
          source.slug,
          source.name,
          source.readerKey,
          JSON.stringify(source.fields),
          JSON.stringify(source.presentation),
        ])
      ).rows[0]!
      await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [
        created.collection_id,
        created.revision,
      ])
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
        created.collection_id,
        JSON.stringify(source.entries),
      ])
      await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [created.collection_id])
      list = { id: created.collection_id }
    }
    listId = list.id
    before = (
      await client.query(
        'SELECT e.id,e.stable_key AS "stableKey",v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index',
        [listId],
      )
    ).rows
    await client.query('COMMIT')
    const id = await fixture(['core-page-header', 'core-speakers-grid'])
    const address = (await client.query('SELECT slug FROM pages WHERE id=$1', [id])).rows[0]!.slug
    const publicBefore = await fetchPublic('/' + address)
    expect(publicBefore.status).toBe(200)
    expect(publicBefore.body).toContain('Speaker 1 (sample)')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, 'editor@example.test')
    await page.goto(`/pages/${id}`)
    await treeLabels(page).nth(1).click()
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
    await expect(inspector.getByRole('tab', { name: 'Advanced', exact: true })).toHaveCount(0)
    await expect(canvas(page).locator('[data-cms-editor-list-ghost]')).toHaveCount(0)
    await inspector.getByRole('button', { name: 'Add speaker', exact: true }).click()
    const adding = page.getByRole('dialog', { name: 'Add speaker', exact: true })
    await expect(adding.getByRole('button', { name: 'Save speaker', exact: true })).toBeDisabled()
    await capture(page, 'add-speaker-empty')
    await adding.getByLabel('Name', { exact: false }).fill('A coordinator’s new speaker')
    await adding.getByLabel('Role', { exact: false }).fill('Community workshop leader')
    await capture(page, 'add-speaker-ready')
    await adding.getByRole('button', { name: 'Save speaker', exact: true }).click()
    await expect(adding).toBeHidden()
    await expect(canvas(page).getByText('A coordinator’s new speaker', { exact: true })).toBeVisible()
    expect((await fetchPublic('/' + address)).body).toBe(publicBefore.body)
    await capture(page, 'speaker-private-draft')
    await canvas(page).getByText('A coordinator’s new speaker', { exact: true }).click()
    await page
      .getByRole('toolbar', { name: 'Selected list item actions', exact: true })
      .getByRole('button', { name: 'Edit speaker', exact: true })
      .click()
    const editing = page.getByRole('dialog', { name: 'Edit speaker', exact: true })
    await editing.getByLabel('Role', { exact: false }).fill('A revised shared role')
    await editing.getByRole('button', { name: 'Save speaker', exact: true }).click()
    await expect(editing).toBeHidden()
    await expect(canvas(page).getByText('A revised shared role', { exact: true })).toBeVisible()
    await treeLabels(page).nth(1).click()
    await inspector.getByLabel('Items to show', { exact: true }).selectOption('newest')
    await inspector.getByLabel('Maximum items', { exact: true }).fill('1')
    await saveDraft(page)
    await expect(canvas(page).locator('[data-cms-entry]')).toHaveCount(1)
    await expect(canvas(page).getByText('A coordinator’s new speaker', { exact: true })).toBeVisible()
    await capture(page, 'newest-speaker-choice')
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect(page.getByRole('toolbar', { name: 'Selected section actions', exact: true })).toHaveCount(0)
    await capture(page, 'speaker-phone-preview')
    expect((await fetchPublic('/' + address)).body).toBe(publicBefore.body)
    expect(errors).toEqual([])
  } finally {
    await client.query('ROLLBACK')
    if (listId) {
      await client.query('BEGIN')
      const root = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await client.query("SELECT set_config('app.user_id',$1,true)", [root])
      const revision = (await client.query('SELECT entry_revision FROM collections WHERE id=$1', [listId])).rows[0]!
        .entry_revision
      await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        listId,
        revision,
        JSON.stringify(before),
      ])
      await client.query('COMMIT')
    }
    await client.end()
  }
})

test('revision 8: the empty editor and a failed preview keep a clear next action', async ({ page }) => {
  test.setTimeout(90_000)
  const empty = await fixture([], false)
  await signIn(page, 'root@example.test')
  await page.goto(`/pages/${empty}`)
  await expect(page.getByRole('heading', { name: 'This page is empty', exact: true })).toBeVisible()
  await capture(page, 'empty-editor')
  const id = await fixture()
  await page.clock.install()
  let reject = true
  await page.route('**/preview/**', async route => {
    if (reject) {
      await route.abort()
      return
    }
    await route.continue()
  })
  await page.goto(`/pages/${id}`)
  await expect(page.getByText('Opening the page preview…', { exact: true })).toBeVisible()
  await page.clock.fastForward(21_000)
  await expect(page.getByRole('button', { name: 'Reload preview', exact: true })).toBeVisible()
  // The preview is unavailable, so capture the outer workspace without geometry waits.
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size)
    await page.screenshot({ path: resolve(folder, `preview-error-${size.width}.png`), animations: 'disabled' })
  }
  reject = false
  await page.getByRole('button', { name: 'Reload preview', exact: true }).click()
  await expect(canvas(page).locator('h1')).toHaveText('A welcoming place to begin')
  await expect(page.getByRole('button', { name: 'Reload preview', exact: true })).toHaveCount(0)
})

test('revision 8: page settings confirms unpublish and archive while keeping the draft', async ({ page }) => {
  test.setTimeout(90_000)
  const id = await fixture(['core-page-header']),
    { database, host, port } = e2eTarget(),
    client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  await client.connect()
  try {
    const address = (await client.query('SELECT slug FROM pages WHERE id=$1', [id])).rows[0]!.slug
    await signIn(page, 'editor@example.test')
    await page.goto(`/pages/${id}`)
    async function settings() {
      await page.getByLabel('More page actions', { exact: true }).click()
      await page.getByRole('button', { name: 'Page settings', exact: true }).click()
      return page.getByRole('dialog', { name: 'Page settings', exact: true })
    }
    const drawer = await settings()
    await drawer.getByRole('button', { name: 'Unpublish page', exact: true }).click()
    await expect(drawer).toBeHidden()
    await capture(page, 'unpublish-page-confirmation')
    const confirm = page.getByRole('alertdialog')
    await confirm.getByRole('button', { name: 'Unpublish page', exact: true }).click()
    await expect(confirm).toBeHidden()
    expect((await fetchPublic('/' + address)).status).toBe(404)
    await expect(canvas(page).locator('h1')).toHaveText('A welcoming place to begin')
    const current = await settings()
    await current.getByRole('button', { name: 'Archive page', exact: true }).click()
    await capture(page, 'archive-page-confirmation')
    await confirm.getByRole('button', { name: 'Archive page', exact: true }).click()
    await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
    const kept = (
      await client.query(
        'SELECT p.archived_at,p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [id],
      )
    ).rows[0]!
    expect(kept.archived_at).not.toBeNull()
    expect(kept.published_version_id).toBeNull()
    expect(kept.content[0].values.heading).toBe('A welcoming place to begin')
  } finally {
    await client.end()
  }
})

for (const width of [1440, 1024]) {
  test(`archiving a published page returns to its site after the complete action response at ${width}`, async ({
    page,
  }) => {
    const id = await fixture(['core-page-header']),
      { database, host, port } = e2eTarget(),
      client = new Client({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
    await client.connect()
    try {
      const before = (await client.query('SELECT site_id,slug,draft_version_id FROM pages WHERE id=$1', [id])).rows[0]!
      await signIn(page, 'editor@example.test')
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/pages/${id}`)
      await expect(canvas(page).locator('h1')).toHaveText('A welcoming place to begin')
      await page.getByLabel('More page actions', { exact: true }).click()
      await page.getByRole('button', { name: 'Page settings', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Page settings', exact: true })
        .getByRole('button', { name: 'Archive page', exact: true })
        .click()
      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation).toBeVisible()
      // Remote action responses can finish before the client handles the receipt.
      // Deliver a complete response so an archived-page re-render cannot hide in
      // a streaming race behind the client's subsequent site navigation.
      let actionReturnedNotFound = false
      await page.route('**/pages/' + id, async route => {
        if (route.request().method() !== 'POST') return route.continue()
        const response = await route.fetch()
        actionReturnedNotFound = (await response.text()).includes('NEXT_HTTP_ERROR_FALLBACK;404')
        await route.fulfill({ response })
      })
      await confirmation.getByRole('button', { name: 'Archive page', exact: true }).click()
      await expect(page).toHaveURL('/sites/' + before.site_id)
      expect(actionReturnedNotFound).toBe(false)
      await expect(page.getByText('This page could not be found.', { exact: true })).toHaveCount(0)
      const after = (
        await client.query('SELECT archived_at,published_version_id,draft_version_id FROM pages WHERE id=$1', [id])
      ).rows[0]!
      expect(after.archived_at).not.toBeNull()
      expect(after.published_version_id).toBeNull()
      expect(after.draft_version_id).toBe(before.draft_version_id)
      expect((await fetchPublic('/' + before.slug)).status).toBe(404)
    } finally {
      await client.end()
    }
  })
}
