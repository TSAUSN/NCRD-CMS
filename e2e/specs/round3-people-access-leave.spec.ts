import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'

test('People leave recovery cannot change access and restored stale revisions refuse explicit saves', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    email = 'access-' + f.site.slice(0, 8) + '@example.test',
    folder = resolve('../.r8-progress/round3/people-access-leave/' + info.project.name)
  const command = async (sql: string, values: unknown[]) => {
    const c = await f.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE cms_authenticated_user')
      const actor = (await f.pool.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
      await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
      const result = await c.query(sql, values)
      await c.query('COMMIT')
      return result.rows
    } finally {
      c.release()
    }
  }
  let user = ''
  try {
    user = (await command('SELECT app.provision_user($1,$2) AS id', [email, 'Access editor (sample)']))[0]!.id
    await command('SELECT app.set_site_membership($1,$2,$3)', [user, f.site, 'contributor'])
    const state = async () => ({
        user: (await f.pool.query('SELECT id,email,display_name,status,revision FROM app_users WHERE id=$1', [user]))
          .rows,
        memberships: (await f.pool.query('SELECT * FROM site_memberships WHERE user_id=$1 ORDER BY site_id', [user]))
          .rows,
        invitations: (
          await f.pool.query(
            "SELECT * FROM outbox WHERE event_type='user.invited' AND payload->>'user_id'=$1 ORDER BY id",
            [user],
          )
        ).rows,
      }),
      heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows
    await mkdir(folder, { recursive: true })
    const shot = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto('/people')
    await page.getByRole('searchbox', { name: 'Find a person', exact: true }).fill(email)
    const open = () => page.getByRole('button', { name: 'Edit access for ' + email, exact: true }).click(),
      editor = page.getByRole('region', { name: 'Edit account access', exact: true }),
      name = editor.getByRole('textbox', { name: 'Name', exact: true }),
      role = editor.locator('#person-site-' + f.site),
      status = editor.getByRole('combobox', { name: 'Account status', exact: true }),
      cancel = () => editor.getByRole('button', { name: 'Cancel', exact: true }).click(),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      baseline = await state()
    await open()
    await cancel()
    await expect(leave).toHaveCount(0)
    await open()
    await name.fill('Unsent access choices (sample)')
    await role.selectOption('editor')
    await status.selectOption('disabled')
    await shot('access-edited')
    await cancel()
    await expect(leave).toContainText('Account access choices (saved only in this browser)')
    await shot('access-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(status).toHaveValue('disabled')
    await cancel()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    expect(await state()).toEqual(baseline)
    await open()
    await expect(name).toHaveValue('Access editor (sample)')
    await name.fill('Recovered access choices (sample)')
    await role.selectOption('editor')
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      ;(window as any).originalStorageWrite = original
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('cms.people-access.')) throw new Error('Synthetic write refusal')
        return original.call(this, key, value)
      }
    })
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not save')
    await shot('access-storage-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(name).toHaveValue('Recovered access choices (sample)')
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as any).originalStorageWrite
    })
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect(await state()).toEqual(baseline)
    await open()
    await expect(name).toHaveValue('Recovered access choices (sample)')
    await expect(role).toHaveValue('editor')
    await shot('access-restored')
    const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const view = await isolated.newPage()
      await signIn(view, 'root@example.test')
      await view.goto('/people')
      await view.getByRole('searchbox', { name: 'Find a person', exact: true }).fill(email)
      await view.getByRole('button', { name: 'Edit access for ' + email, exact: true }).click()
      await expect(
        view
          .getByRole('region', { name: 'Edit account access', exact: true })
          .getByRole('textbox', { name: 'Name', exact: true }),
      ).toHaveValue('Access editor (sample)')
    } finally {
      await isolated.close()
    }
    let release!: () => void
    const waiting = new Promise<void>(resolve => {
      release = resolve
    })
    await page.route('**/people**', async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await waiting
        await route.fulfill({ status: 503, body: 'Synthetic unavailable' })
      } else await route.continue()
    })
    await editor.getByRole('button', { name: 'Save account access', exact: true }).click()
    await expect(name).toBeDisabled()
    await expect(editor.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await shot('access-pending')
    release()
    await expect(editor.getByRole('alert')).toContainText('could not be confirmed')
    await expect(name).toHaveValue('Recovered access choices (sample)')
    await shot('access-command-error')
    expect(await state()).toEqual(baseline)
    await page.unroute('**/people**')
    await command('SELECT app.update_person($1,$2,$3,$4,$5)', [
      user,
      baseline.user[0]!.revision,
      'Newer saved account (sample)',
      'active',
      JSON.stringify([{ siteId: f.site, role: 'contributor' }]),
    ])
    const concurrent = await state()
    await page.reload()
    await open()
    await expect(name).toHaveValue('Recovered access choices (sample)')
    await editor.getByRole('button', { name: 'Save account access', exact: true }).click()
    await expect(editor.getByRole('alert')).toBeVisible()
    await shot('access-stale')
    expect(await state()).toEqual(concurrent)
    await page.evaluate(() => {
      const original = Storage.prototype.removeItem
      ;(window as any).originalStorageRemove = original
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('cms.people-access.')) throw new Error('Synthetic clear refusal')
        return original.call(this, key)
      }
    })
    await editor.getByRole('button', { name: 'Clear saved access choices', exact: true }).click()
    await expect(editor.getByRole('alert').filter({ hasText: 'could not be cleared' })).toBeVisible()
    await expect(name).toHaveValue('Recovered access choices (sample)')
    await shot('access-clear-error')
    await page.evaluate(() => {
      Storage.prototype.removeItem = (window as any).originalStorageRemove
    })
    await editor.getByRole('button', { name: 'Clear saved access choices', exact: true }).click()
    await expect(name).toHaveValue('Newer saved account (sample)')
    await name.fill('Explicitly saved access (sample)')
    await role.selectOption('editor')
    await editor.getByRole('button', { name: 'Save account access', exact: true }).click()
    await expect(editor).toHaveCount(0)
    const applied = await state()
    expect(applied.user[0]!.display_name).toBe('Explicitly saved access (sample)')
    expect(applied.memberships[0]!.role).toBe('editor')
    expect(applied.invitations).toEqual([])
    await open()
    await status.selectOption('disabled')
    await cancel()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    expect(await state()).toEqual(applied)
    await open()
    await expect(status).toHaveValue('disabled')
    await editor.getByRole('button', { name: 'Save account access', exact: true }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Deactivate Explicitly saved access (sample)?', exact: true })
    await expect(confirm).toBeVisible()
    await shot('access-deactivate')
    expect(await state()).toEqual(applied)
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(status).toHaveValue('disabled')
    await editor.getByRole('button', { name: 'Save account access', exact: true }).click()
    await confirm.getByRole('button', { name: 'Deactivate account', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect((await state()).user[0]!.status).toBe('disabled')
    expect((await state()).invitations).toEqual([])
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

test('invitation leave saves private choices without creating an account or recording an invitation', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    email = 'invite-' + f.site.slice(0, 8) + '@example.test',
    folder = resolve('../.r8-progress/round3/people-access-leave/' + info.project.name),
    accounts = async () =>
      (await f.pool.query('SELECT id,email,display_name FROM app_users WHERE email=$1', [email])).rows
  try {
    await mkdir(folder, { recursive: true })
    const shot = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto('/people')
    const open = () => page.getByRole('button', { name: 'Invite a person', exact: true }).click(),
      editor = page.getByRole('region', { name: 'Invite a person', exact: true }),
      name = editor.getByRole('textbox', { name: 'Name', exact: true }),
      mail = editor.getByRole('textbox', { name: 'Email address', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await open()
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(leave).toHaveCount(0)
    await open()
    await name.fill('Unsent invitation (sample)')
    await mail.fill(email)
    await editor.locator('#person-site-' + f.site).selectOption('contributor')
    await shot('invite-edited')
    await page.getByRole('link', { name: 'Home', exact: true }).click()
    await expect(leave).toContainText('Invitation choices (saved only in this browser)')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    expect(await accounts()).toEqual([])
    await page.goto('/people')
    await open()
    await expect(name).toHaveValue('Unsent invitation (sample)')
    await expect(mail).toHaveValue(email)
    await expect(editor.locator('#person-site-' + f.site)).toHaveValue('contributor')
    await shot('invite-restored')
    await mail.fill('root@example.test')
    await editor.getByRole('button', { name: 'Create account & send invitation', exact: true }).click()
    await expect(editor.getByRole('alert')).toBeVisible()
    await expect(name).toHaveValue('Unsent invitation (sample)')
    await shot('invite-refused')
    expect(await accounts()).toEqual([])
    await mail.fill(email)
    await editor.getByRole('button', { name: 'Create account & send invitation', exact: true }).click()
    await expect(editor).toHaveCount(0)
    const users = await accounts()
    expect(users).toHaveLength(1)
    expect(users[0]!.display_name).toBe('Unsent invitation (sample)')
    expect(
      (await f.pool.query('SELECT role FROM site_memberships WHERE user_id=$1 AND site_id=$2', [users[0]!.id, f.site]))
        .rows,
    ).toEqual([{ role: 'contributor' }])
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM outbox WHERE event_type='user.invited' AND payload->>'user_id'=$1",
          [users[0]!.id],
        )
      ).rows[0]!.n,
    ).toBe(1)
    await open()
    await expect(name).toHaveValue('')
    await expect(mail).toHaveValue('')
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(leave).toHaveCount(0)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
