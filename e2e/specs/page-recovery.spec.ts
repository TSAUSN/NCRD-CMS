import { expect, test, type Page, type Route } from '@playwright/test'
import { Client } from 'pg'
import { e2eTarget } from '../test-target.ts'
import { canvas, saveDraft, savedState, signIn } from './helpers.ts'

async function database() {
  const target = e2eTarget()
  const client = new Client({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` })
  await client.connect()
  return client
}
async function fixture(page: Page) {
  const client = await database()
  let pageId = '',
    siteId = ''
  const name = `Browser recovery ${Date.now()}-${Math.floor(Math.random() * 10000)}`
  try {
    const user = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    siteId = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const hero = (await client.query("SELECT id FROM section_defs WHERE slug='hero' AND scope='global'")).rows[0]!.id
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [user])
    pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        siteId,
        `recovery-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        name,
      ])
    ).rows[0]!.id
    await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([{ section_def_id: hero, section_def_version: 1, values: { heading: 'Saved starting point' } }]),
      '{}',
    ])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
  await signIn(page, 'editor@example.test')
  await page.getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/pages/${pageId}$`))
  await expect(recoveryStatus(page)).toHaveText('Ready')
  await selectHeading(page)
  return { pageId, siteId, url: page.url() }
}
async function selectHeading(page: Page) {
  await canvas(page).locator('[data-cms-slot="heading"]').first().click()
  await expect(page.locator('#slot-0-heading')).toBeVisible()
}
function recoveryStatus(page: Page) {
  return page.getByRole('status', { name: 'Browser recovery status' })
}
function reviewButton(page: Page) {
  return page.getByRole('button', { name: /^Review copy from / }).first()
}
async function blockSaves(page: Page, pageId: string) {
  const handler = async (route: Route) =>
    new URL(route.request().url()).pathname === `/pages/${pageId}` && route.request().method() === 'POST'
      ? route.abort('internetdisconnected')
      : route.continue()
  await page.route('**', handler)
  return () => page.unroute('**', handler)
}
async function reloadLeavingLocalWork(page: Page) {
  const accept = (dialog: import('@playwright/test').Dialog) => void dialog.accept()
  page.on('dialog', accept)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
  } finally {
    page.off('dialog', accept)
  }
  await expect(recoveryStatus(page)).toHaveText('Ready')
  await selectHeading(page)
}
async function copies(page: Page, pageId: string) {
  return page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('cms-page-recovery', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<
        {
          sequence: number
          scope: { userId: string; pageId: string }
          document: { sections: { values: { heading: string } }[] }
          base: { document: { sections: { values: { heading: string } }[] } }
        }[]
      >((resolve, reject) => {
        const request = db.transaction('drafts', 'readonly').objectStore('drafts').getAll()
        request.onsuccess = () => resolve(request.result.filter(row => row.scope.pageId === id))
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  }, pageId)
}

test('offline edits survive a real reload, compare explicitly, and use shared undo/save history', async ({
  page,
  context,
}, testInfo) => {
  const { pageId } = await fixture(page)
  const unblock = await blockSaves(page, pageId)
  await context.setOffline(true)
  await page.locator('#slot-0-heading').fill('Work retained while offline')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toBeVisible()
  await context.setOffline(false)
  await reloadLeavingLocalWork(page)
  await expect(page.locator('#slot-0-heading')).toHaveValue('Saved starting point')
  await reviewButton(page).click()
  const dialog = page.getByRole('dialog', { name: 'Review browser recovery' })
  await expect(dialog.getByText('Work retained while offline', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Saved starting point', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('#slot-0-heading')).toHaveValue('Saved starting point')
  await reviewButton(page).click()
  // Capture the comparison itself, not the instant before the dialog renders.
  await expect(dialog.getByText('Work retained while offline', { exact: true })).toBeVisible()
  const originalViewport = page.viewportSize()
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    const path = testInfo.outputPath('browser-recovery-comparison-' + width + '.png')
    await page.screenshot({ path, animations: 'disabled' })
    await testInfo.attach('Browser recovery comparison ' + width, { path, contentType: 'image/png' })
  }
  if (originalViewport) await page.setViewportSize(originalViewport)
  await dialog.getByRole('button', { name: 'Apply browser copy', exact: true }).click()
  await expect(page.locator('#slot-0-heading')).toHaveValue('Work retained while offline')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('#slot-0-heading')).toHaveValue('Saved starting point')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('#slot-0-heading')).toHaveValue('Work retained while offline')
  await unblock()
  await saveDraft(page)
  await expect(savedState(page)).toHaveText('All changes saved')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await selectHeading(page)
  await expect(page.locator('#slot-0-heading')).toHaveValue('Work retained while offline')
  await expect(reviewButton(page)).toHaveCount(0)
  await expect.poll(async () => (await copies(page, pageId)).length).toBe(0)
})

test('a lost save response is recognized as already saved after reload', async ({ page }) => {
  const { pageId } = await fixture(page)
  let stored = false
  const handler = async (route: Route) => {
    if (new URL(route.request().url()).pathname !== `/pages/${pageId}` || route.request().method() !== 'POST')
      return route.continue()
    if (!stored) {
      await route.fetch()
      stored = true
    }
    return route.abort('connectionfailed')
  }
  await page.route('**', handler)
  await page.locator('#slot-0-heading').fill('Saved despite the lost response')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect.poll(() => stored).toBe(true)
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toBeVisible()
  await reloadLeavingLocalWork(page)
  await expect(page.locator('#slot-0-heading')).toHaveValue('Saved despite the lost response')
  await expect(savedState(page)).toHaveText('All changes saved')
  await expect(reviewButton(page)).toHaveCount(0)
  await expect.poll(async () => (await copies(page, pageId)).length).toBe(0)
})

test('newer typing remains recoverable after an older in-flight save is acknowledged', async ({ page }) => {
  const { pageId } = await fixture(page)
  let release!: () => void,
    started = 0
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const handler = async (route: Route) => {
    if (new URL(route.request().url()).pathname !== `/pages/${pageId}` || route.request().method() !== 'POST')
      return route.continue()
    if (++started === 1) {
      await gate
      return route.continue()
    }
    return route.abort('connectionfailed')
  }
  await page.route('**', handler)
  await page.locator('#slot-0-heading').fill('First save snapshot')
  await expect.poll(() => started).toBe(1)
  await page.locator('#slot-0-heading').fill('Newer typing during that save')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  release()
  await expect
    .poll(async () => (await copies(page, pageId))[0]?.base.document.sections[0]?.values.heading)
    .toBe('First save snapshot')
  expect((await copies(page, pageId))[0]?.document.sections[0]?.values.heading).toBe('Newer typing during that save')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not save' })).toBeVisible()
  await reloadLeavingLocalWork(page)
  await expect(page.locator('#slot-0-heading')).toHaveValue('First save snapshot')
  await reviewButton(page).click()
  await expect(page.getByRole('dialog').getByText('Newer typing during that save', { exact: true })).toBeVisible()
})

test('changed saved heads require comparison and reject a head that advances during review', async ({
  page,
  context,
}) => {
  const { pageId, url } = await fixture(page)
  const unblock = await blockSaves(page, pageId)
  await page.locator('#slot-0-heading').fill('Local browser version')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  const other = await context.newPage()
  await other.goto(url)
  await selectHeading(other)
  await other.locator('#slot-0-heading').fill('Another window saved this')
  await saveDraft(other)
  await reloadLeavingLocalWork(page)
  await reviewButton(page).click()
  const dialog = page.getByRole('dialog', { name: 'Review browser recovery' })
  await expect(dialog.getByRole('button', { name: 'Apply browser copy' })).toBeDisabled()
  await expect(dialog.getByText('Another window saved this', { exact: true })).toBeVisible()
  await other.locator('#slot-0-heading').fill('New head after the comparison')
  await saveDraft(other)
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Apply browser copy' }).click()
  await expect(dialog.getByRole('alert')).toContainText('page changed during this review')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await selectHeading(page)
  await expect(page.locator('#slot-0-heading')).toHaveValue('New head after the comparison')
  await reviewButton(page).click()
  await dialog.getByRole('checkbox').check()
  await unblock()
  await dialog.getByRole('button', { name: 'Apply browser copy' }).click()
  await expect(page.locator('#slot-0-heading')).toHaveValue('Local browser version')
  await saveDraft(page)
  await other.close()
})

test('another account cannot open or apply a browser copy, including a stale signed-in tab', async ({
  page,
  context,
}) => {
  const { pageId } = await fixture(page)
  await blockSaves(page, pageId)
  await page.locator('#slot-0-heading').fill('Editor account private browser work')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  await reloadLeavingLocalWork(page)
  await reviewButton(page).click()
  const other = await context.newPage()
  // The browser shares one cookie jar: switch accounts there the way other
  // specs do, which leaves this tab holding the previous account's editor.
  await context.clearCookies()
  await signIn(other, 'contributor@example.test')
  await page.getByRole('dialog').getByRole('button', { name: 'Apply browser copy' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in changed' })).toBeVisible()
  await expect(page.locator('#slot-0-heading')).toHaveValue('Saved starting point')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await selectHeading(page)
  await expect(recoveryStatus(page)).toHaveText('Ready')
  await expect(reviewButton(page)).toHaveCount(0)
  await expect(page.getByText('Editor account private browser work', { exact: true })).toHaveCount(0)
  expect((await copies(page, pageId)).length).toBe(1)
  await context.clearCookies()
  await signIn(other, 'editor@example.test')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await selectHeading(page)
  await reviewButton(page).click()
  await expect(page.getByRole('dialog').getByText('Editor account private browser work', { exact: true })).toBeVisible()
  await other.close()
})

test('a reviewed copy cannot delete a newer sequence written by another window', async ({ page, context }) => {
  const { pageId, url } = await fixture(page)
  await blockSaves(page, pageId)
  await page.locator('#slot-0-heading').fill('First browser copy')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  const other = await context.newPage()
  await other.goto(url)
  await reviewButton(other).click()
  const dialog = other.getByRole('dialog', { name: 'Review browser recovery' })
  await expect(dialog.getByText('First browser copy', { exact: true })).toBeVisible()
  await page.locator('#slot-0-heading').fill('Newer work from the original window')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  await dialog.getByRole('button', { name: 'Discard this copy…' }).click()
  await other.getByRole('dialog').getByRole('button', { name: 'Discard browser copy', exact: true }).click()
  await expect(other.getByRole('dialog').getByRole('alert')).toContainText('changed in another window')
  expect((await copies(page, pageId))[0]?.document.sections[0]?.values.heading).toBe(
    'Newer work from the original window',
  )
  await other.close()
})

test('an older review response cannot reopen private content after a newer account check refuses it', async ({
  page,
  context,
}) => {
  const { pageId } = await fixture(page)
  await blockSaves(page, pageId)
  await page.locator('#slot-0-heading').fill('Do not reveal from an older response')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  await reloadLeavingLocalWork(page)
  let release!: () => void,
    parked = false
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  await page.route(`**/api/pages/${pageId}/recovery?*`, async route => {
    if (parked) return route.continue()
    const response = await route.fetch()
    parked = true
    await gate
    await route.fulfill({ response })
  })
  await reviewButton(page).click()
  await expect.poll(() => parked).toBe(true)
  const other = await context.newPage()
  // The browser shares one cookie jar: switch accounts there the way other
  // specs do, which leaves this tab holding the previous account's editor.
  await context.clearCookies()
  await signIn(other, 'contributor@example.test')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in changed' })).toBeVisible()
  release()
  await expect(page.getByRole('button', { name: 'Refresh browser copies', includeHidden: true })).not.toBeDisabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Do not reveal from an older response', { exact: true })).toHaveCount(0)
  await other.close()
})

test('archiving a page during recovery prevents applying the copy and retains it', async ({ page }) => {
  const { pageId } = await fixture(page)
  await blockSaves(page, pageId)
  await page.locator('#slot-0-heading').fill('Copy retained after archive')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  await reloadLeavingLocalWork(page)
  await reviewButton(page).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Apply browser copy' })).toBeVisible()
  const client = await database()
  try {
    const user = (await client.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    const before = (await client.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.user_id',$1,true)", [user])
    await client.query('SELECT app.archive_page($1,$2)', [pageId, before.revision])
    await client.query('COMMIT')
    await page.getByRole('dialog').getByRole('button', { name: 'Apply browser copy' }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('available')
    expect(
      (await client.query('SELECT draft_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!.draft_version_id,
    ).toBe(before.draft_version_id)
    expect((await copies(page, pageId)).length).toBe(1)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  }
})

test('supported Back cancellation preserves the page', async ({ page }) => {
  const { pageId, url } = await fixture(page)
  await blockSaves(page, pageId)
  await page.locator('#slot-0-heading').fill('Keep when Back is canceled')
  await expect(recoveryStatus(page)).toHaveText('Copy kept')
  const prompt = page.waitForEvent('dialog')
  const back = page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => null)
  const dialog = await prompt
  expect(dialog.type()).toBe('confirm')
  expect(dialog.message()).toContain('unsaved changes')
  await dialog.dismiss()
  await back
  await expect(page).toHaveURL(url)
  await expect(page.locator('#slot-0-heading')).toHaveValue('Keep when Back is canceled')
})

test('unavailable browser storage and history support do not claim a durable recovery copy', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('Storage disabled for this test')
      },
    })
    Object.defineProperty(window, 'navigation', { configurable: true, value: undefined })
  })
  // This case deliberately cannot use fixture's Ready assertion.
  await signIn(page, 'editor@example.test')
  await page.getByRole('link', { name: 'Demo site', exact: true }).click()
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(recoveryStatus(page)).toHaveText('Unavailable')
  await expect(page.getByRole('alert').filter({ hasText: 'Browser recovery is unavailable' })).toBeVisible()
  await page.locator('.recovery-status summary').click()
  await expect(page.getByText(/This browser cannot pause every Back\/Forward move/)).toBeVisible()
  await expect(savedState(page)).toHaveText('All changes saved')
})
