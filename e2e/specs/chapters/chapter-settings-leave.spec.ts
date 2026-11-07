import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from '../fixtures/echelon.ts'
import { signIn } from '../helpers.ts'

async function capture(page: Page, folder: string, name: string) {
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 950 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
  }
}
async function command(f: Awaited<ReturnType<typeof echelonFixture>>, sql: string, values: unknown[]) {
  const c = await f.pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const result = await c.query(sql, values)
    await c.query('COMMIT')
    return result.rows
  } finally {
    c.release()
  }
}

test('chapter defaults and division names leave as separate private intent and retain stale revisions', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/chapter-settings-leave/' + info.project.name),
    base = '/sites/' + f.site + '/settings',
    name = 'Recovered division (sample)'
  const state = async () => ({
    settings: (await f.pool.query('SELECT * FROM chapter_site_settings WHERE site_id=$1', [f.site])).rows,
    teams: (await f.pool.query('SELECT * FROM chapter_divisions WHERE site_id=$1 ORDER BY id', [f.site])).rows,
    messages: (await f.pool.query('SELECT * FROM local_chapter_outbox WHERE site_id=$1 ORDER BY id', [f.site])).rows,
  })
  try {
    await mkdir(folder, { recursive: true })
    const heads = (
      await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
        f.site,
      ])
    ).rows
    await signIn(page, 'root@example.test')
    await page.goto(base + '?tab=publishing')
    const mode = page.getByRole('radio', { name: /^Chapter editors sign in/ }),
      team = page.getByRole('textbox', { name: 'Division name', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      navigate = () => page.getByRole('link', { name: 'Review reminders', exact: true }).click(),
      baseline = await state()
    await mode.check()
    await team.fill(name)
    await team.scrollIntoViewIfNeeded()
    await capture(page, folder, 'division-name')
    await navigate()
    await expect(leave).toContainText('Chapter defaults')
    await expect(leave).toContainText('New division team')
    await capture(page, folder, 'multiple-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(team).toHaveValue(name)
    await navigate()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base + '?tab=reviews')
    expect(await state()).toEqual(baseline)
    await page.goto(base + '?tab=publishing')
    await mode.check()
    await team.fill(name)
    await navigate()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(base + '?tab=reviews')
    expect(await state()).toEqual(baseline)
    await page.goto(base + '?tab=publishing')
    await expect(mode).toBeChecked()
    await expect(team).toHaveValue(name)
    await page.getByRole('heading', { name: 'Publishing and approval', exact: true }).scrollIntoViewIfNeeded()
    await capture(page, folder, 'defaults-restored')
    let release!: () => void
    const waiting = new Promise<void>(resolve => {
        release = resolve
      }),
      pattern = '**/sites/' + f.site + '/settings**'
    await page.route(pattern, async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await waiting
        await route.fulfill({ status: 503, body: 'Synthetic unavailable' })
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Save chapter defaults', exact: true }).click()
    await expect(mode).toBeDisabled()
    await capture(page, folder, 'defaults-pending')
    release()
    await expect(page.getByRole('region', { name: 'Chapter defaults', exact: true }).getByRole('alert')).toContainText(
      'could not be confirmed',
    )
    expect(await state()).toEqual(baseline)
    await page.unroute(pattern)
    const revision = baseline.settings[0]?.revision ?? '0'
    await command(f, 'SELECT app.save_chapter_check_settings($1,$2,false,true)', [f.site, revision])
    const concurrent = await state()
    await page.reload()
    await page.getByRole('button', { name: 'Save chapter defaults', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Chapter defaults', exact: true }).getByRole('alert')).toContainText(
      'changed',
    )
    await page.getByRole('heading', { name: 'Publishing and approval', exact: true }).scrollIntoViewIfNeeded()
    await capture(page, folder, 'defaults-stale')
    expect(await state()).toEqual(concurrent)
    await page.getByRole('button', { name: 'Clear saved chapter defaults', exact: true }).click()
    await mode.check()
    await page.getByRole('button', { name: 'Save chapter defaults', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Chapter defaults saved' })).toBeVisible()
    await expect(team).toHaveValue(name)
    const saved = await state()
    expect(saved.settings[0]!.default_update_mode).toBe('chapter-editors')
    expect(saved.settings[0]!.checks_enabled).toBe(false)
    expect(saved.teams).toEqual([])
    await page.getByRole('button', { name: 'Add division team', exact: true }).click()
    await expect(page.locator('summary').filter({ hasText: name })).toBeVisible()
    await expect(team).toHaveValue('')
    expect((await state()).teams).toHaveLength(1)
    await team.fill('Another unsent division (sample)')
    await navigate()
    await expect(leave).toContainText('New division team')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(team).toHaveValue('Another unsent division (sample)')
    await navigate()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base + '?tab=reviews')
    expect((await state()).teams).toHaveLength(1)
    expect((await state()).messages).toEqual([])
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
  } finally {
    f.client.release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})

test('division staff recovery grants nothing and removing staff preserves another unfinished staff entry', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/chapter-settings-leave/' + info.project.name),
    base = '/sites/' + f.site + '/settings',
    email = 'staff-' + f.site.slice(0, 8) + '@example.test'
  try {
    await mkdir(folder, { recursive: true })
    const division = (
        await command(f, "SELECT app.create_chapter_division($1,'Division access (sample)') AS id", [f.site])
      )[0]!.id,
      heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      accounts = async () =>
        (await f.pool.query('SELECT id,display_name,email FROM app_users WHERE email=$1', [email])).rows
    await signIn(page, 'root@example.test')
    await page.goto(base + '?tab=publishing')
    const summary = page.locator('summary').filter({ hasText: 'Division access (sample)' }),
      details = summary.locator('..'),
      name = details.getByRole('textbox', { name: 'Staff name', exact: true }),
      mail = details.getByRole('textbox', { name: 'Staff email', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      navigate = () => page.getByRole('link', { name: 'Review reminders', exact: true }).click()
    await summary.click()
    await name.fill('Division staff (sample)')
    await mail.fill(email)
    await name.scrollIntoViewIfNeeded()
    await capture(page, folder, 'staff-edited')
    await navigate()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(base + '?tab=reviews')
    expect(await accounts()).toEqual([])
    expect(
      (await f.pool.query('SELECT * FROM chapter_division_memberships WHERE division_id=$1', [division])).rows,
    ).toEqual([])
    await page.goto(base + '?tab=publishing')
    await summary.click()
    await expect(name).toHaveValue('Division staff (sample)')
    await expect(mail).toHaveValue(email)
    await name.scrollIntoViewIfNeeded()
    await capture(page, folder, 'staff-restored')
    const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const view = await isolated.newPage()
      await signIn(view, 'root@example.test')
      await view.goto(base + '?tab=publishing')
      await view.locator('summary').filter({ hasText: 'Division access (sample)' }).click()
      await expect(view.getByRole('textbox', { name: 'Staff name', exact: true })).toHaveValue('')
    } finally {
      await isolated.close()
    }
    let release!: () => void
    const waiting = new Promise<void>(resolve => {
        release = resolve
      }),
      pattern = '**/sites/' + f.site + '/settings**'
    await page.route(pattern, async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await waiting
        await route.fulfill({ status: 503, body: 'Synthetic unavailable' })
      } else await route.continue()
    })
    await details.getByRole('button', { name: 'Add division staff', exact: true }).click()
    await expect(name).toBeDisabled()
    await capture(page, folder, 'staff-pending')
    release()
    await expect(details.getByRole('alert')).toContainText('could not be confirmed')
    await expect(mail).toHaveValue(email)
    await details.getByRole('alert').scrollIntoViewIfNeeded()
    await capture(page, folder, 'staff-refused')
    expect(await accounts()).toEqual([])
    await page.unroute(pattern)
    await details.getByRole('button', { name: 'Add division staff', exact: true }).click()
    await expect(details.getByText(email, { exact: true })).toBeVisible()
    await expect(name).toHaveValue('')
    await expect(mail).toHaveValue('')
    const users = await accounts()
    expect(users).toHaveLength(1)
    expect(
      (
        await f.pool.query('SELECT * FROM chapter_division_memberships WHERE division_id=$1 AND user_id=$2', [
          division,
          users[0]!.id,
        ])
      ).rows,
    ).toHaveLength(1)
    expect((await f.pool.query('SELECT * FROM site_memberships WHERE user_id=$1', [users[0]!.id])).rows).toEqual([])
    expect(
      (
        await f.pool.query("SELECT * FROM outbox WHERE event_type='user.invited' AND payload->>'user_id'=$1", [
          users[0]!.id,
        ])
      ).rows,
    ).toEqual([])
    await name.fill('Another unfinished staff member (sample)')
    await mail.fill('unsent-' + email)
    await details
      .getByRole('button', { name: 'Remove Division staff (sample) from Division access (sample)', exact: true })
      .click()
    await expect(details.getByText('No division staff yet.', { exact: true })).toBeVisible()
    await expect(name).toHaveValue('Another unfinished staff member (sample)')
    await navigate()
    await expect(leave).toContainText('staff choices')
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(base + '?tab=reviews')
    expect(
      (await f.pool.query('SELECT * FROM chapter_division_memberships WHERE division_id=$1', [division])).rows,
    ).toEqual([])
    expect((await f.pool.query('SELECT id FROM app_users WHERE email=$1', ['unsent-' + email])).rows).toEqual([])
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
  } finally {
    f.client.release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})

test('chapter reminder leave choices never record messages and stale settings require deliberate recovery', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/chapter-settings-leave/' + info.project.name),
    base = '/sites/' + f.site + '/settings',
    state = async () => ({
      settings: (await f.pool.query('SELECT * FROM chapter_site_settings WHERE site_id=$1', [f.site])).rows,
      messages: (await f.pool.query('SELECT * FROM local_chapter_outbox WHERE site_id=$1 ORDER BY id', [f.site])).rows,
    })
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await page.goto(base + '?tab=reviews')
    const tools = page.locator('summary').filter({ hasText: 'Test tools (this computer only)' }),
      checks = page.getByRole('switch', { name: 'January and July contact checks', exact: true }),
      reminders = page.getByRole('switch', {
        name: 'Remind the division and national team after five working days',
        exact: true,
      }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      navigate = () => page.getByRole('link', { name: 'Publishing & approval', exact: true }).click(),
      baseline = await state()
    await tools.click()
    await page.getByLabel('Check month', { exact: true }).selectOption('07')
    await page.getByLabel('Check year', { exact: true }).fill('2028')
    await page.getByRole('tab', { name: 'Division makes changes', exact: true }).click()
    await navigate()
    await expect(leave).toHaveCount(0)
    await expect(page).toHaveURL(base + '?tab=publishing')
    expect(await state()).toEqual(baseline)
    await page.goto(base + '?tab=reviews')
    await tools.click()
    await checks.uncheck()
    await reminders.uncheck()
    await checks.scrollIntoViewIfNeeded()
    await capture(page, folder, 'checks-edited')
    await navigate()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(checks).not.toBeChecked()
    await navigate()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page).toHaveURL(base + '?tab=publishing')
    expect(await state()).toEqual(baseline)
    await command(f, 'SELECT app.save_chapter_defaults($1,$2,$3)', [
      f.site,
      baseline.settings[0]?.revision ?? '0',
      'chapter-editors',
    ])
    const concurrent = await state()
    await page.goto(base + '?tab=reviews')
    await tools.click()
    await expect(checks).not.toBeChecked()
    await expect(reminders).not.toBeChecked()
    await checks.scrollIntoViewIfNeeded()
    await capture(page, folder, 'checks-restored')
    await page.getByRole('button', { name: 'Save check settings', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Chapter checks', exact: true }).getByRole('alert')).toContainText(
      'changed',
    )
    await page.getByRole('region', { name: 'Chapter checks', exact: true }).getByRole('alert').scrollIntoViewIfNeeded()
    await capture(page, folder, 'checks-stale')
    expect(await state()).toEqual(concurrent)
    await page.evaluate(() => {
      const original = Storage.prototype.removeItem
      ;(window as any).originalRemove = original
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('cms.chapter-checks.')) throw new Error('Synthetic clear refusal')
        return original.call(this, key)
      }
    })
    await page.getByRole('button', { name: 'Clear saved check settings', exact: true }).click()
    await expect(
      page
        .getByRole('region', { name: 'Chapter checks', exact: true })
        .getByRole('alert')
        .filter({ hasText: 'could not be cleared' }),
    ).toBeVisible()
    await expect(checks).not.toBeChecked()
    await checks.scrollIntoViewIfNeeded()
    await capture(page, folder, 'checks-clear-error')
    await page.evaluate(() => {
      Storage.prototype.removeItem = (window as any).originalRemove
    })
    await page.getByRole('button', { name: 'Clear saved check settings', exact: true }).click()
    await expect(checks).toBeChecked()
    await checks.uncheck()
    await reminders.uncheck()
    await page.getByRole('button', { name: 'Save check settings', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Chapter checks saved')
    const applied = await state()
    expect(applied.settings[0]!.checks_enabled).toBe(false)
    expect(applied.settings[0]!.review_reminders_enabled).toBe(false)
    expect(applied.settings[0]!.default_update_mode).toBe('chapter-editors')
    expect(applied.messages).toEqual([])
    await checks.check()
    await page.getByRole('button', { name: 'Record waiting review messages', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('No new messages')
    await expect(checks).toBeChecked()
    await navigate()
    await expect(leave).toContainText('Chapter check settings')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page).toHaveURL(base + '?tab=publishing')
    expect(await state()).toEqual(applied)
  } finally {
    f.client.release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
