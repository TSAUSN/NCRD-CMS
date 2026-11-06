import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'

test('new list setup can be kept, discarded or saved privately without losing its requested destination', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/new-list-leave/' + info.project.name),
    root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
  try {
    await mkdir(folder, { recursive: true })
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [root])
    const base = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        f.site,
        'existing-list',
        '[Existing list]',
        'existing_' + randomUUID().slice(0, 8),
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
    await c.query('SELECT app.publish_collection_schema($1,1)', [base])
    await c.query('COMMIT')
    const baseHead = (await c.query('SELECT * FROM collections WHERE id=$1', [base])).rows[0],
      pages = (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      address = '/sites/' + f.site + '/content?collection=' + base
    const capture = async (active: Page, name: string) => {
      for (const width of [1440, 1024]) {
        await active.setViewportSize({ width, height: 950 })
        expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await active.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    const count = async () =>
      (await c.query('SELECT count(*)::int n FROM collections WHERE site_id=$1', [f.site])).rows[0]!.n
    await signIn(page, 'root@example.test')
    await page.goto(address)
    const dialog = page.getByRole('dialog', { name: 'Create a list', exact: true }),
      name = dialog.getByLabel('List name', { exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      open = () => page.getByRole('button', { name: 'New list', exact: true }).click()
    await open()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(leave).toHaveCount(0)
    expect(await count()).toBe(1)
    await open()
    await name.fill('[Discarded setup]')
    await capture(page, 'edited')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(leave).toContainText('New list setup')
    await capture(page, 'leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Discarded setup]')
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(await count()).toBe(1)
    await open()
    await name.fill('[Saved setup]')
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp('collection=' + base + '$'))
    await expect(
      page.getByRole('status').filter({ hasText: 'List saved as a private draft. Nothing was published.' }),
    ).toBeVisible()
    await capture(page, 'saved-private')
    expect(await count()).toBe(2)
    const saved = (
      await c.query(
        "SELECT id,draft_schema_version_id,published_schema_version_id FROM collections WHERE site_id=$1 AND name='[Saved setup]'",
        [f.site],
      )
    ).rows[0]!
    expect(saved.draft_schema_version_id).toBeTruthy()
    expect(saved.published_schema_version_id).toBeNull()
    expect(
      (await c.query('SELECT count(*)::int n FROM collection_entries WHERE collection_id=$1', [saved.id])).rows[0]!.n,
    ).toBe(0)
    await open()
    await name.fill('')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Give the list a name before saving.')
    await capture(page, 'invalid')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('')
    expect(await count()).toBe(2)
    await name.fill('[Error preserved]')
    const fail = '**/sites/' + f.site + '/content*'
    await page.route(fail, async route =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, body: 'A local failure response' })
        : route.continue(),
    )
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Creation could not be confirmed.')
    await capture(page, 'save-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Error preserved]')
    await page.unroute(fail)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    expect(await count()).toBe(2)
    await open()
    await name.fill('[Explicit list]')
    await dialog.getByRole('button', { name: 'Create list', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(new RegExp('collection=' + base + '$'))
    await expect(page.getByRole('heading', { name: '[Explicit list]', exact: true })).toBeVisible()
    await capture(page, 'normal-create')
    expect(await count()).toBe(3)
    expect((await c.query('SELECT * FROM collections WHERE id=$1', [base])).rows[0]).toEqual(baseHead)
    expect(
      (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(pages)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
