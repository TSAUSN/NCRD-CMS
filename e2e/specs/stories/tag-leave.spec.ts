import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
test('unfinished tag edits keep their fields, refuse invalid saves and save privately before the chosen destination', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/tag-leave/' + info.project.name),
    title = '[Tag destination ' + randomUUID().slice(0, 8) + ']'
  await mkdir(folder, { recursive: true })
  let native = 0
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  const read = async () =>
      (
        await f.pool.query(
          'SELECT c.revision,c.draft_schema_version_id,c.published_schema_version_id,c.entry_revision,c.published_entry_revision,v.fields,v.sort AS presentation FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
          [f.collectionId],
        )
      ).rows[0]!,
    stories = async () =>
      (
        await f.pool.query(
          'SELECT id,draft_version_id,published_version_id FROM collection_entries WHERE collection_id=$1 ORDER BY id',
          [f.collectionId],
        )
      ).rows
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
  }
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const destination = (
      await f.client.query('SELECT app.create_page($1,$2,$3) AS id', [
        f.siteId,
        'tag-destination-' + randomUUID().slice(0, 8),
        title,
      ])
    ).rows[0]!.id
    await f.client.query('COMMIT')
    const before = await read(),
      entries = await stories(),
      base = '/sites/' + f.siteId + '/stories/tags'
    await signIn(page, 'root@example.test')
    await page.goto(base)
    const edit = page.getByRole('dialog', { name: 'Add a project sector', exact: true }),
      search = page.getByRole('dialog', { name: 'Search or jump to', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    const attempt = async () => {
      await page.keyboard.press('Control+k')
      await search.getByRole('combobox').fill(title)
      await search.getByRole('option').filter({ hasText: title }).click()
      await expect(search).toHaveCount(0)
      await expect(leave).toBeVisible()
    }
    await page.getByRole('button', { name: 'Add sector', exact: true }).click()
    await edit.getByLabel('Name', { exact: true }).fill('[Unfinished campaign]')
    await edit.getByLabel('Suggest it for stories that mention', { exact: true }).fill('anniversary, fifty years')
    await attempt()
    await capture('choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(edit.getByLabel('Name', { exact: true })).toHaveValue('[Unfinished campaign]')
    await attempt()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await expect(edit.getByLabel('Suggest it for stories that mention', { exact: true })).toHaveValue(
      'anniversary, fifty years',
    )
    await attempt()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + destination)
    expect(await read()).toEqual(before)
    await page.goto(base)
    await page.getByRole('button', { name: 'Add sector', exact: true }).click()
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Check the tag name')
    await capture('save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await edit.getByLabel('Name', { exact: true }).fill('[Saved on leave]')
    await edit.getByLabel('Suggest it for stories that mention', { exact: true }).fill('anniversary')
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + destination)
    const saved = await read()
    expect(saved.draft_schema_version_id).not.toBe(before.draft_schema_version_id)
    expect(saved.published_schema_version_id).toBe(before.published_schema_version_id)
    expect(JSON.stringify(saved.presentation)).toContain('[Saved on leave]')
    expect(JSON.stringify(saved.presentation)).not.toContain('[Unfinished campaign]')
    expect(await stories()).toEqual(entries)
    await page.goto(base)
    await page.getByRole('button', { name: 'Rename level', exact: true }).first().click()
    const rename = page.getByRole('dialog', { name: 'Rename level', exact: true })
    await rename.getByLabel('Main tag level name', { exact: true }).fill('[Project topics]')
    await attempt()
    await capture('rename-choice')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL('/pages/' + destination)
    const renamed = await read()
    expect(JSON.stringify(renamed.presentation)).toContain('[Project topics]')
    expect(JSON.stringify(renamed.presentation)).toContain('[Saved on leave]')
    expect(renamed.published_schema_version_id).toBe(before.published_schema_version_id)
    expect(await stories()).toEqual(entries)
    expect(native).toBe(0)
  } finally {
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
