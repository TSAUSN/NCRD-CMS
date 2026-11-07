import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'

test('template start setup can stay private in this browser without implicitly creating a site', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true),
    folder = resolve('../.r8-progress/round3/template-start-leave/' + info.project.name),
    actor = (await f.pool.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
    key = 'cms.template-start.' + actor + '.' + f.siteId,
    address = '/sites/' + f.siteId + '/template',
    slug = 'private-start-' + randomUUID().slice(0, 8)
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  const rows = async () => (await f.pool.query('SELECT * FROM sites ORDER BY id')).rows
  try {
    await mkdir(folder, { recursive: true })
    const before = await rows(),
      heads = (await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id')).rows
    await signIn(page, 'root@example.test')
    await page.goto(address)
    const dialog = page.getByRole('dialog', { name: 'Start a site from the national template', exact: true }),
      name = dialog.getByLabel(/^Site name/),
      short = dialog.getByLabel(/^Test address/),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      open = () => page.getByRole('button', { name: 'Start a site from this', exact: true }).click(),
      cancel = () => dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await open()
    await cancel()
    await expect(dialog).toHaveCount(0)
    await expect(leave).toHaveCount(0)
    await open()
    await name.fill('[Discarded private setup]')
    await capture('edited')
    await cancel()
    await expect(leave).toContainText('Template site setup (saved only in this browser)')
    await capture('leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Discarded private setup]')
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await rows()).toEqual(before)
    await open()
    await name.fill('[Saved private setup]')
    await short.fill(slug)
    await dialog.getByRole('radio', { name: 'Home page only', exact: true }).check()
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await rows()).toEqual(before)
    await open()
    await expect(name).toHaveValue('[Saved private setup]')
    await expect(short).toHaveValue(slug)
    await expect(dialog.getByRole('radio', { name: 'Home page only', exact: true })).toBeChecked()
    await expect(dialog.getByRole('status')).toContainText('restored from this browser')
    await capture('restored')
    await cancel()
    const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const other = await isolated.newPage()
      await signIn(other, 'root@example.test')
      await other.goto(address)
      await other.getByRole('button', { name: 'Start a site from this', exact: true }).click()
      await expect(other.getByLabel(/^Site name/)).toHaveValue('')
    } finally {
      await isolated.close()
    }
    await open()
    await short.fill('Bad address!')
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Use lowercase words separated by hyphens')
    await capture('invalid')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(short).toHaveValue('Bad address!')
    expect(await rows()).toEqual(before)
    await cancel()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await open()
    await expect(short).toHaveValue(slug)
    await name.fill('[Unsaved browser setup]')
    await page.evaluate(() => {
      ;(window as any).__templateSet = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('cms.template-start.')) throw new Error('storage unavailable')
        return (window as any).__templateSet.call(this, key, value)
      }
    })
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('This browser could not save the setup.')
    await capture('storage-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Unsaved browser setup]')
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as any).__templateSet
    })
    await cancel()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await open()
    await expect(name).toHaveValue('[Saved private setup]')
    await page.evaluate(() => {
      ;(window as any).__templateRemove = Storage.prototype.removeItem
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('cms.template-start.')) throw new Error('storage unavailable')
        return (window as any).__templateRemove.call(this, key)
      }
    })
    await dialog.getByRole('button', { name: 'Clear saved setup', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('could not be cleared')
    await capture('clear-error')
    await expect(name).toHaveValue('[Saved private setup]')
    await page.evaluate(() => {
      Storage.prototype.removeItem = (window as any).__templateRemove
    })
    await dialog.getByRole('button', { name: 'Clear saved setup', exact: true }).click()
    await expect(name).toHaveValue('')
    await cancel()
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    expect(await rows()).toEqual(before)
    expect((await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages ORDER BY id')).rows).toEqual(
      heads,
    )
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
