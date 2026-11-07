import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('CSV source leave choices preserve a private account/list draft without adding rows until asked', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/csv-leave/' + info.project.name),
    root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
  const capture = async (active: Page, name: string) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: 950 })
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  async function as<T>(run: () => Promise<T>) {
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [root])
    try {
      const result = await run()
      await c.query('COMMIT')
      return result
    } catch (error) {
      await c.query('ROLLBACK')
      throw error
    }
  }
  try {
    await mkdir(folder, { recursive: true })
    const lists = await as(async () => {
      const ids: string[] = []
      for (const name of ['First list', 'Other list']) {
        const id = (
          await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
            f.site,
            name.toLowerCase().replaceAll(' ', '-'),
            name,
            'csv_' + randomUUID().slice(0, 8),
            JSON.stringify([{ key: 'name', label: 'Name', type: 'text', required: true }]),
            JSON.stringify({
              schemaVersion: 1,
              titleField: 'name',
              subtitleField: null,
              imageField: null,
              groupField: null,
            }),
          ])
        ).rows[0]!.collection_id
        await c.query('SELECT app.publish_collection_schema($1,1)', [id])
        await c.query('SELECT app.save_collection_entries($1,0,$2)', [
          id,
          JSON.stringify([{ id: null, stableKey: 'original', values: { name: '[Original item]' } }]),
        ])
        await c.query('SELECT app.publish_collection_entries($1,1)', [id])
        ids.push(id)
      }
      return ids
    })
    const list = lists[0]!,
      address = '/sites/' + f.site + '/content?collection=' + list,
      key = 'cms.csv-draft.' + root + '.' + f.site + '.' + list
    const rows = async () =>
      (
        await c.query(
          'SELECT id,draft_version_id,published_version_id,sort_index,published_sort_index,archived_at,published_archived_at FROM collection_entries WHERE collection_id=$1 ORDER BY id',
          [list],
        )
      ).rows
    const original = await rows(),
      pages = (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      versions = (
        await c.query(
          'SELECT v.* FROM collection_entry_versions v JOIN collection_entries e ON e.id=v.entry_id WHERE e.collection_id=$1 ORDER BY v.id',
          [list],
        )
      ).rows
    await signIn(page, 'root@example.test')
    await page.goto(address)
    const dialog = page.getByRole('dialog', { name: 'CSV import & export', exact: true }),
      source = dialog.getByRole('textbox', { name: 'CSV source', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    const open = async () => {
        await page.getByRole('button', { name: 'Import / Export', exact: true }).click()
        await page.getByRole('button', { name: 'Import / Export CSV', exact: true }).click()
      },
      close = () => dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await open()
    await close()
    await expect(dialog).toBeHidden()
    await expect(leave).toHaveCount(0)
    await open()
    await source.fill('name\n[Unadded row]')
    await capture(page, 'edited')
    await close()
    await expect(leave).toContainText('CSV source (saved only in this browser)')
    await capture(page, 'leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(source).toHaveValue('name\n[Unadded row]')
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(await rows()).toEqual(original)
    await open()
    await expect(source).toHaveValue('')
    await source.fill('name\n[Saved row]')
    await close()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(await rows()).toEqual(original)
    await open()
    await expect(source).toHaveValue('name\n[Saved row]')
    await expect(dialog.getByRole('status')).toContainText('restored from this browser')
    await capture(page, 'restored')
    await close()
    // Another account in the same browser storage partition sees no source.
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/sign-in(?:[?#]|$)/)
    await signIn(page, 'editor@example.test')
    await page.goto(address)
    await open()
    await expect(source).toHaveValue('')
    await close()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/sign-in(?:[?#]|$)/)
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/content?collection=' + lists[1])
    await open()
    await expect(source).toHaveValue('')
    await close()
    await page.goto(address)
    await open()
    await expect(source).toHaveValue('name\n[Saved row]')
    await source.fill('name\n[Unsaved change]')
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      ;(window as any).__csvSet = original
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('cms.csv-draft.')) throw new Error('local storage unavailable')
        return original.call(this, key, value)
      }
    })
    await close()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not save the CSV source')
    await capture(page, 'storage-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(source).toHaveValue('name\n[Unsaved change]')
    expect(await rows()).toEqual(original)
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as any).__csvSet
    })
    await close()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await open()
    await expect(source).toHaveValue('name\n[Saved row]')
    // Invalid raw work is recoverable, but cannot add invalid items.
    await source.fill('unknown\n[Needs mapping]')
    await close()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await open()
    await expect(source).toHaveValue('unknown\n[Needs mapping]')
    await expect(dialog).toContainText('Unknown headers: unknown.')
    await expect(dialog.getByRole('button', { name: /Add .* to draft/ })).toHaveCount(0)
    await capture(page, 'invalid-restored')
    await dialog.getByRole('button', { name: 'Clear saved CSV source', exact: true }).click()
    await expect(source).toHaveValue('')
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    await close()
    // Closing just the CSV step never discards or saves other unfinished items.
    await open()
    await source.fill('name\n[First staged item]')
    await dialog.getByRole('button', { name: 'Add 1 to draft', exact: true }).click()
    await expect(dialog).toBeHidden()
    await open()
    await dialog
      .getByLabel('Choose a CSV file')
      .setInputFiles({ name: 'local.csv', mimeType: 'text/csv', buffer: Buffer.from('name\n[Imported item]') })
    await expect(source).toHaveValue('name\n[Imported item]')
    await close()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    expect(await rows()).toEqual(original)
    await open()
    await expect(source).toHaveValue('name\n[Imported item]')
    await dialog.getByRole('button', { name: 'Add 1 to draft', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Edit [First staged item]', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit [Imported item]', exact: true })).toBeVisible()
    expect(await rows()).toEqual(original)
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    await capture(page, 'staged')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'List draft saved.' })).toBeVisible()
    await page.reload()
    expect(await rows()).toHaveLength(3)
    await open()
    await expect(source).toHaveValue('')
    await close()
    const saved = await rows()
    expect(saved.find(row => row.id === original[0]!.id)!.published_version_id).toBe(original[0]!.published_version_id)
    for (const row of saved.filter(row => row.id !== original[0]!.id)) expect(row.published_version_id).toBeNull()
    expect(
      (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(pages)
    expect(
      (
        await c.query('SELECT * FROM collection_entry_versions WHERE id=ANY($1::uuid[]) ORDER BY id', [
          versions.map(row => row.id),
        ])
      ).rows,
    ).toEqual(versions)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
