import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('List settings protects unsaved fields and saves only a private exact draft when leaving', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/list-field-leave/' + info.project.name),
    root = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
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
  const capture = async (active: Page, name: string) => {
    for (const width of [1440, 1024]) {
      await active.setViewportSize({ width, height: 950 })
      expect(await active.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await active.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  const fields = [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'role', label: 'Role', type: 'text', required: false },
    ],
    presentation = { schemaVersion: 1, titleField: 'name', subtitleField: 'role', imageField: null, groupField: null }
  try {
    await mkdir(folder, { recursive: true })
    const list = await as(async () => {
      const id = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          f.site,
          'field-check',
          '[Field check]',
          'field_check_' + randomUUID().slice(0, 8),
          JSON.stringify(fields),
          JSON.stringify(presentation),
        ])
      ).rows[0]!.collection_id
      await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
        id,
        JSON.stringify([{ id: null, stableKey: 'initial', values: { name: '[Initial item]', role: '[Saved role]' } }]),
      ])
      await c.query('SELECT app.publish_collection_schema($1,1)', [id])
      await c.query('SELECT app.publish_collection_entries($1,1)', [id])
      return id
    })
    const baseline = (
        await c.query(
          'SELECT revision,draft_schema_version_id,published_schema_version_id FROM collections WHERE id=$1',
          [list],
        )
      ).rows[0]!,
      pages = (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      live = (
        await c.query(
          'SELECT id,published_version_id,published_sort_index,published_archived_at FROM collection_entries WHERE collection_id=$1 ORDER BY id',
          [list],
        )
      ).rows
    const versions = (
      await c.query('SELECT id,fields,sort FROM collection_schema_versions WHERE collection_id=$1 ORDER BY id', [list])
    ).rows
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/content?collection=' + list)
    const dialog = page.getByRole('dialog', { name: 'List settings', exact: true }),
      first = dialog.locator('.schema-field-card').first(),
      label = first.getByLabel('Label', { exact: true }),
      guidance = first.getByLabel('Guidance', { exact: true })
    const open = async () => {
      await page.getByRole('button', { name: 'More list actions', exact: true }).click()
      await page.getByRole('button', { name: 'List settings', exact: true }).click()
      await expect(dialog).toBeVisible()
    }
    await open()
    await label.fill('Heading')
    await capture(page, 'edited')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    const leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(leave).toContainText('List fields')
    await capture(page, 'leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(label).toHaveValue('Heading')
    await page.keyboard.press('Escape')
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(
      (
        await c.query(
          'SELECT revision,draft_schema_version_id,published_schema_version_id FROM collections WHERE id=$1',
          [list],
        )
      ).rows[0],
    ).toEqual(baseline)
    await open()
    await expect(label).toHaveValue('Name')
    await label.fill('Heading')
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: 'List fields saved as a draft.' })).toBeVisible()
    await capture(page, 'saved')
    const privateHead = (
      await c.query('SELECT draft_schema_version_id,published_schema_version_id FROM collections WHERE id=$1', [list])
    ).rows[0]!
    expect(privateHead.draft_schema_version_id).not.toBe(baseline.draft_schema_version_id)
    expect(privateHead.published_schema_version_id).toBe(baseline.published_schema_version_id)
    // The existing list workflow saves items against a newly saved field design.
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'List draft saved.' })).toBeVisible()
    await open()
    await expect(label).toHaveValue('Heading')
    await label.fill('')
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Enter a label for field 1.')
    await capture(page, 'invalid')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(label).toHaveValue('')
    await label.fill('Heading')
    await guidance.fill('[My private guidance]')
    await as(async () => {
      const head = (
        await c.query(
          'SELECT c.revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
          [list],
        )
      ).rows[0]!
      head.fields[0].help = '[Other saved guidance]'
      await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
        list,
        head.revision,
        JSON.stringify(head.fields),
        JSON.stringify(head.sort),
      ])
    })
    const otherHead = (await c.query('SELECT draft_schema_version_id FROM collections WHERE id=$1', [list])).rows[0]!
      .draft_schema_version_id
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toBeVisible()
    await capture(page, 'stale')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(guidance).toHaveValue('[My private guidance]')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(
      (await c.query('SELECT draft_schema_version_id FROM collections WHERE id=$1', [list])).rows[0]!
        .draft_schema_version_id,
    ).toBe(otherHead)
    expect(
      (
        await c.query(
          'SELECT id,published_version_id,published_sort_index,published_archived_at FROM collection_entries WHERE collection_id=$1 ORDER BY id',
          [list],
        )
      ).rows,
    ).toEqual(live)
    expect(
      (
        await c.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(pages)
    expect(
      (
        await c.query(
          'SELECT id,fields,sort FROM collection_schema_versions WHERE collection_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
          [list, versions.map(row => row.id)],
        )
      ).rows,
    ).toEqual(versions)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
