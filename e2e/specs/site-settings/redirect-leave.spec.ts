import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'
import { rawRequest } from '../http.ts'

test('redirect leave choices stay private and restored old revisions cannot overwrite newer routing', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/redirect-leave/' + info.project.name),
    base = '/sites/' + f.site + '/redirects',
    old = '/private-setup',
    proposed = '/private-renamed'
  const rows = async () =>
      (await f.pool.query('SELECT * FROM site_redirects WHERE site_id=$1 ORDER BY id', [f.site])).rows,
    request = (path: string) => rawRequest({ host: f.host, path })
  try {
    await mkdir(folder, { recursive: true })
    const heads = (
      await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
        f.site,
      ])
    ).rows
    const shot = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto(base)
    const open = () => page.getByRole('button', { name: 'Add redirect', exact: true }).click(),
      dialog = page.getByRole('dialog', { name: 'Add redirect', exact: true }),
      path = dialog.getByRole('textbox', { name: /^Old address/ }),
      target = dialog.getByRole('combobox', { name: /^New page/ }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      cancel = () => dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await open()
    await cancel()
    await expect(leave).toHaveCount(0)
    await open()
    await path.fill(old)
    await target.selectOption(f.pages[0]!)
    await shot('redirect-edited')
    await cancel()
    await expect(leave).toContainText('Redirect setup (saved only in this browser)')
    await shot('redirect-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(path).toHaveValue(old)
    await cancel()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    expect(await rows()).toEqual([])
    expect((await request(old)).status).toBe(404)
    await open()
    await expect(path).toHaveValue('')
    await path.fill(old)
    await target.selectOption(f.pages[0]!)
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      ;(window as any).storageWrite = original
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('cms.redirect-setup.')) throw new Error('Synthetic storage refusal')
        return original.call(this, key, value)
      }
    })
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not save')
    await shot('redirect-storage-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(path).toHaveValue(old)
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as any).storageWrite
    })
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await rows()).toEqual([])
    await open()
    await expect(path).toHaveValue(old)
    await expect(target).toHaveValue(f.pages[0]!)
    await shot('redirect-restored')
    const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const view = await isolated.newPage()
      await signIn(view, 'root@example.test')
      await view.goto(base)
      await view.getByRole('button', { name: 'Add redirect', exact: true }).click()
      await expect(
        view.getByRole('dialog', { name: 'Add redirect', exact: true }).getByRole('textbox', { name: /^Old address/ }),
      ).toHaveValue('')
    } finally {
      await isolated.close()
    }
    let release!: () => void
    const waiting = new Promise<void>(resolve => {
        release = resolve
      }),
      pattern = '**/sites/' + f.site + '/redirects**'
    await page.route(pattern, async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await waiting
        await route.fulfill({ status: 503, body: 'Synthetic unavailable' })
      } else await route.continue()
    })
    await dialog.getByRole('button', { name: 'Save redirect', exact: true }).click()
    await expect(path).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await shot('redirect-pending')
    release()
    await expect(dialog.getByRole('alert')).toContainText('could not be confirmed')
    await shot('redirect-command-error')
    expect(await rows()).toEqual([])
    expect((await request(old)).status).toBe(404)
    await page.unroute(pattern)
    await dialog.getByRole('button', { name: 'Save redirect', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Redirect saved')
    const row = (await rows())[0]!
    expect((await request(old + '?tag=one&tag=two')).headers['location']).toBe('/?tag=one&tag=two')
    await page.getByRole('button', { name: 'Edit ' + old, exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit redirect', exact: true })
    await edit.getByRole('textbox', { name: /^Old address/ }).fill(proposed)
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    expect((await request(proposed)).status).toBe(404)
    const c = await f.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      const actor = (await f.pool.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
      await c.query('SELECT app.save_site_redirect($1,$2,$3,$4,$5)', [f.site, row.id, row.revision, old, f.pages[1]])
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const concurrent = await rows()
    await page.reload()
    await page.getByRole('button', { name: 'Edit ' + old, exact: true }).click()
    await expect(edit.getByRole('textbox', { name: /^Old address/ })).toHaveValue(proposed)
    await edit.getByRole('button', { name: 'Save redirect', exact: true }).click()
    await expect(edit.getByRole('alert')).toBeVisible()
    await shot('redirect-stale')
    expect(await rows()).toEqual(concurrent)
    expect((await request(old)).headers['location']).toBe('/visit')
    expect((await request(proposed)).status).toBe(404)
    await page.evaluate(() => {
      const original = Storage.prototype.removeItem
      ;(window as any).storageRemove = original
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('cms.redirect-setup.')) throw new Error('Synthetic storage refusal')
        return original.call(this, key)
      }
    })
    await edit.getByRole('button', { name: 'Clear saved redirect setup', exact: true }).click()
    await expect(edit.getByRole('alert').filter({ hasText: 'could not be cleared' })).toBeVisible()
    await expect(edit.getByRole('textbox', { name: /^Old address/ })).toHaveValue(proposed)
    await shot('redirect-clear-error')
    await page.evaluate(() => {
      Storage.prototype.removeItem = (window as any).storageRemove
    })
    await edit.getByRole('button', { name: 'Clear saved redirect setup', exact: true }).click()
    await expect(edit.getByRole('textbox', { name: /^Old address/ })).toHaveValue(old)
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(leave).toHaveCount(0)
    await page.getByRole('button', { name: 'Remove ' + old, exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Remove redirect?', exact: true })
      .getByRole('button', { name: 'Remove redirect', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText('Redirect removed')
    expect((await request(old)).status).toBe(404)
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})

test('redirect spreadsheet leave saves only source and requires a fresh preview after concurrent routing changes', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/redirect-leave/' + info.project.name),
    base = '/sites/' + f.site + '/redirects',
    old = '/spreadsheet-old',
    source = 'Old address,New address\n' + old + ',/visit',
    rows = async () => (await f.pool.query('SELECT * FROM site_redirects WHERE site_id=$1 ORDER BY id', [f.site])).rows
  try {
    await mkdir(folder, { recursive: true })
    const heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      shot = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 900 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
        }
      }
    await signIn(page, 'root@example.test')
    await page.goto(base)
    const open = () => page.getByRole('button', { name: 'Import from a spreadsheet', exact: true }).click(),
      dialog = page.getByRole('dialog', { name: 'Import redirects from a spreadsheet', exact: true }),
      file = dialog.getByLabel('Spreadsheet saved as CSV', { exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      cancel = () => dialog.getByRole('button', { name: 'Cancel', exact: true }).click(),
      load = () =>
        file.setInputFiles({ name: 'private-redirects.csv', mimeType: 'text/csv', buffer: Buffer.from(source) })
    await open()
    await cancel()
    await expect(leave).toHaveCount(0)
    await open()
    await expect(file).toBeEnabled()
    await load()
    await expect(dialog.getByRole('button', { name: 'Preview redirects', exact: true })).toBeEnabled()
    await shot('csv-source')
    await cancel()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(dialog).toContainText('Loaded CSV: private-redirects.csv')
    await cancel()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    expect(await rows()).toEqual([])
    await open()
    await expect(file).toBeEnabled()
    await load()
    await dialog.getByRole('button', { name: 'Preview redirects', exact: true }).click()
    await expect(dialog.getByRole('table', { name: 'Redirect import preview', exact: true })).toContainText(old)
    await expect(dialog.getByRole('button', { name: 'Import 1 redirect', exact: true })).toBeEnabled()
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await rows()).toEqual([])
    await page.reload()
    await open()
    await expect(dialog).toContainText('Spreadsheet source restored or saved')
    await expect(dialog).toContainText('Loaded CSV: private-redirects.csv')
    await expect(dialog.getByRole('table', { name: 'Redirect import preview', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Preview redirects', exact: true })).toBeEnabled()
    await shot('csv-restored')
    await dialog.getByRole('button', { name: 'Preview redirects', exact: true }).click()
    await shot('csv-preview')
    const c = await f.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      const actor = (await f.pool.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
      await c.query('SELECT app.save_site_redirect($1,NULL,0,$2,$3)', [f.site, old, f.pages[0]])
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const concurrent = await rows()
    await dialog.getByRole('button', { name: 'Import 1 redirect', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Preview')
    await expect(dialog.getByRole('table', { name: 'Redirect import preview', exact: true })).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Site redirects', exact: true })).toContainText(old)
    await shot('csv-stale')
    expect(await rows()).toEqual(concurrent)
    expect((await rawRequest({ host: f.host, path: old })).headers['location']).toBe('/')
    await dialog.getByRole('button', { name: 'Preview redirects', exact: true }).click()
    await expect(dialog.getByRole('table', { name: 'Redirect import preview', exact: true })).toContainText('Update')
    await dialog.getByRole('button', { name: 'Import 1 redirect', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('1 redirect imported')
    expect((await rawRequest({ host: f.host, path: old })).headers['location']).toBe('/visit')
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
    await open()
    await expect(dialog.getByRole('button', { name: 'Preview redirects', exact: true })).toBeDisabled()
    await expect(dialog).not.toContainText('Loaded CSV: private-redirects.csv')
    await cancel()
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
