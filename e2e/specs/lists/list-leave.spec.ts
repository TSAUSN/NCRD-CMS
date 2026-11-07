import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'
test('list item leave keeps fields, refuses invalid saves, saves privately and protects list navigation', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    folder = resolve('../.r8-progress/round3/list-leave/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let release = () => {},
    native = 0
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
  try {
    await c.query('BEGIN')
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const lists: string[] = []
    for (const [slug, label, name] of [
      ['list-one', '[List one]', '[Opening item]'],
      ['list-two', '[List two]', '[Destination item]'],
    ]) {
      const id = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          f.site,
          slug,
          label,
          slug === 'list-one' ? 'speakers' : 'resources',
          JSON.stringify([
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'description', label: 'Description', type: 'richtext', required: false },
          ]),
          JSON.stringify({
            schemaVersion: 1,
            titleField: 'name',
            subtitleField: 'description',
            imageField: null,
            groupField: null,
          }),
        ])
      ).rows[0]!.collection_id
      lists.push(id)
      await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
        id,
        JSON.stringify([{ id: null, stableKey: slug, values: { name, description: '<p>[Keep description]</p>' } }]),
      ])
    }
    await c.query('COMMIT')
    const one = lists[0]!,
      two = lists[1]!,
      base = '/sites/' + f.site + '/content',
      read = async () =>
        (
          await f.pool.query(
            'SELECT e.id,e.draft_version_id,e.published_version_id,e.archived_at,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
            [one],
          )
        ).rows[0]!,
      before = await read(),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      search = page.getByRole('dialog', { name: 'Search or jump to', exact: true })
    const capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 900 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      },
      attempt = async () => {
        await page.keyboard.press('Control+k')
        await search.getByRole('combobox').fill('[Destination item]')
        await search.getByRole('option').filter({ hasText: '[Destination item]' }).click()
        await expect(search).toHaveCount(0)
        await expect(leave).toBeVisible()
      }
    await signIn(page, 'root@example.test')
    await page.goto(base + '?collection=' + one)
    await page.getByRole('button', { name: 'Edit [Opening item]', exact: true }).click()
    const name = page.getByRole('dialog', { name: /^Edit / }).getByLabel(/^Name/)
    await name.fill('[Unsaved item]')
    await attempt()
    await capture('choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Unsaved item]')
    await attempt()
    await page.keyboard.press('Escape')
    await expect(leave).toHaveCount(0)
    await expect(name).toHaveValue('[Unsaved item]')
    await attempt()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('collection')).toBe(two)
    expect(await read()).toEqual(before)
    await page.goto(base + '?collection=' + one)
    await page.getByRole('button', { name: 'Edit [Opening item]', exact: true }).click()
    await name.fill('')
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toHaveText('Name is required.')
    await capture('validation-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await name.fill('[Saved item]')
    let fail = true
    await page.route('**/sites/' + f.site + '/content*', async route => {
      if (fail && route.request().method() === 'POST' && route.request().postData()?.includes('entryRevision')) {
        fail = false
        await route.abort('failed')
      } else await route.continue()
    })
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('list draft could not be saved')
    await capture('save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('[Saved item]')
    expect(await read()).toEqual(before)
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let waiting = false
    await page.route('**/sites/' + f.site + '/content*', async route => {
      if (!waiting && route.request().method() === 'POST' && route.request().postData()?.includes('entryRevision')) {
        waiting = true
        await gate
      }
      await route.fallback()
    })
    await attempt()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toContainText('Saving your draft')
    await capture('saving-before-leaving')
    release()
    await expect.poll(() => new URL(page.url()).searchParams.get('collection')).toBe(two)
    const saved = await read()
    expect(saved.values).toEqual({ ...before.values, name: '[Saved item]' })
    expect(saved.published_version_id).toBe(before.published_version_id)
    await page.goto(base + '?collection=' + one)
    await page.getByRole('checkbox', { name: 'Select [Saved item]', exact: true }).check()
    await page.getByRole('button', { name: 'Hide', exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Site lists', exact: true })
      .getByRole('link', { name: /\[List two\]/ })
      .click()
    await expect(leave).toBeVisible()
    await capture('switcher-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(
      page.getByRole('navigation', { name: 'Site lists', exact: true }).getByRole('link', { name: /\[List one\]/ }),
    ).toHaveAttribute('aria-current', 'page')
    await page
      .getByRole('navigation', { name: 'Site lists', exact: true })
      .getByRole('link', { name: /\[List two\]/ })
      .click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('collection')).toBe(two)
    expect(await read()).toEqual(saved)
    expect(native).toBe(0)
  } finally {
    release()
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
