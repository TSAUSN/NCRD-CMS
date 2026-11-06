import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
async function tomorrow(page: Page) {
  return page.evaluate(() => {
    const date = new Date(Date.now() + 86400000)
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
  })
}
function capture(page: Page, folder: string) {
  return async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
}

test('single-page intent stays private on leave and restored stale pins require explicit review', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    worker = 'single-leave-' + randomUUID(),
    folder = resolve('../.r8-progress/round3/page-schedule-leave/' + info.project.name),
    shot = capture(page, folder)
  let pulse: ReturnType<typeof setInterval> | undefined
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      key = 'cms.page-schedule.' + actor + '.' + f.site,
      address = '/sites/' + f.site + '/publishing?tab=scheduled',
      queue = async () =>
        (await f.pool.query('SELECT * FROM scheduled_actions WHERE site_id=$1 ORDER BY id', [f.site])).rows
    await f.pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      worker,
    ])
    pulse = setInterval(() => {
      void f.pool.query('UPDATE job_heartbeats SET last_seen_at=now() WHERE worker_id=$1', [worker]).catch(() => {})
    }, 5000)
    await signIn(page, 'root@example.test')
    await page.goto(address)
    const summary = page.getByText('Schedule a single page', { exact: true }),
      form = page.locator('form').filter({ has: page.getByLabel('Page', { exact: true }) }),
      time = form.getByLabel(/^Date and time/),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await summary.click()
    await summary.click()
    await expect(leave).toHaveCount(0)
    await summary.click()
    await form.getByLabel('Page', { exact: true }).selectOption(f.pages[0]!)
    const chosen = await tomorrow(page)
    await time.fill(chosen)
    await shot('single-edited')
    await summary.click()
    await expect(leave).toContainText('Single-page schedule choices')
    await shot('single-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(time).toHaveValue(chosen)
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
    expect(await queue()).toEqual([])
    await page.goto(address)
    await summary.click()
    await form.getByLabel('Page', { exact: true }).selectOption(f.pages[0]!)
    await time.fill(chosen)
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      ;(window as any).saveStorage = original
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('cms.page-schedule.')) throw new Error('Synthetic storage refusal')
        return original.call(this, key, value)
      }
    })
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not save')
    await shot('single-storage-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(time).toHaveValue(chosen)
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as any).saveStorage
    })
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
    expect(await queue()).toEqual([])
    await page.goto(address)
    await expect(time).toHaveValue(chosen)
    await expect(form).toContainText('Schedule choices restored or saved')
    await shot('single-restored')
    const other = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const view = await other.newPage()
      await signIn(view, 'root@example.test')
      await view.goto(address)
      await view.getByText('Schedule a single page', { exact: true }).click()
      await expect(view.getByLabel(/^Date and time/)).toHaveValue('')
    } finally {
      await other.close()
    }
    await page.evaluate(() => {
      const original = Storage.prototype.removeItem
      ;(window as any).removeStorage = original
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('cms.page-schedule.')) throw new Error('Synthetic storage refusal')
        return original.call(this, key)
      }
    })
    await form.getByRole('button', { name: 'Clear saved schedule choices', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('could not be cleared')
    await expect(time).toHaveValue(chosen)
    await shot('single-clear-error')
    await page.evaluate(() => {
      Storage.prototype.removeItem = (window as any).removeStorage
    })
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const row = (
        await c.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!,
      content = structuredClone(row.content)
    content[0].values.heading = '[Newer concurrent draft]'
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      f.pages[0],
      row.revision,
      JSON.stringify(content),
      JSON.stringify(row.meta),
    ])
    await c.query('COMMIT')
    const heads = (
      await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
        f.site,
      ])
    ).rows
    await page.goto(address)
    await expect(time).toHaveValue(chosen)
    await expect(form.getByRole('button', { name: 'Save schedule', exact: true })).toBeDisabled()
    await expect(form).toContainText('The page changed')
    await shot('single-stale')
    expect(await queue()).toEqual([])
    await form.getByRole('button', { name: 'Reload version', exact: true }).click()
    await expect(form.getByRole('button', { name: 'Save schedule', exact: true })).toBeEnabled()
    await form.getByRole('button', { name: 'Save schedule', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Schedule saved for this exact version' })).toBeVisible()
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    const jobs = await queue()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      version_id: heads.find(head => head.id === f.pages[0])!.draft_version_id,
      status: 'pending',
    })
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.cancel_page_schedule($1)', [jobs[0].id])
    await c.query('COMMIT')
  } finally {
    if (pulse) clearInterval(pulse)
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [worker])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})

test('retry leave saves no attempt and keeps an independent single-page draft and fresh finding review', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    worker = 'retry-leave-' + randomUUID(),
    folder = resolve('../.r8-progress/round3/page-schedule-leave/' + info.project.name),
    shot = capture(page, folder)
  let pulse: ReturnType<typeof setInterval> | undefined
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id
    await f.pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      worker,
    ])
    pulse = setInterval(() => {
      void f.pool.query('UPDATE job_heartbeats SET last_seen_at=now() WHERE worker_id=$1', [worker]).catch(() => {})
    }, 5000)
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const old = (
        await c.query(
          'SELECT p.revision,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!,
      draft = (
        await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          f.pages[0],
          old.revision,
          '[]',
          JSON.stringify(old.meta),
        ])
      ).rows[0]!,
      job = (
        await c.query("SELECT app.schedule_page_action($1,$2,$3,'publish',$4,2,'[]',NULL,$5) AS id", [
          f.pages[0],
          draft.revision,
          draft.version_id,
          new Date(Date.now() + 7200000),
          randomUUID(),
        ])
      ).rows[0]!.id
    await c.query('COMMIT')
    await f.pool.query(
      "UPDATE scheduled_actions SET status='failed',last_error='[Local test failure]',failure_kind='attempts_exhausted',attempt_count=5,finished_at=now(),override_reason='[Earlier attempt reason]' WHERE id=$1",
      [job],
    )
    const failed = (await f.pool.query('SELECT * FROM scheduled_actions WHERE id=$1', [job])).rows[0],
      heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      key = 'cms.page-schedule.' + actor + '.' + f.site + '.retry.' + job,
      retries = async () => (await f.pool.query('SELECT * FROM scheduled_actions WHERE retry_of_id=$1', [job])).rows
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/publishing?tab=scheduled')
    await page.getByText('Schedule a single page', { exact: true }).click()
    const main = page.locator('form').filter({ has: page.getByLabel('Page', { exact: true }) }),
      mainTime = main.getByLabel(/^Date and time/),
      chosen = await tomorrow(page)
    await mainTime.fill(chosen)
    const open = () =>
        page
          .locator('#schedule-' + job)
          .getByRole('button', { name: 'Retry failed schedule', exact: true })
          .click(),
      dialog = page.getByRole('alertdialog', { name: 'Retry this failed schedule?', exact: true }),
      time = dialog.getByLabel(/^Retry date and time/),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await open()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(leave).toHaveCount(0)
    await expect(mainTime).toHaveValue(chosen)
    await open()
    await time.fill(chosen)
    await dialog.getByRole('button', { name: 'Schedule new attempt', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('still needs attention')
    const reason = dialog.getByLabel('Reason for the new publishing exception', { exact: true })
    await expect(reason).toHaveValue('')
    await reason.fill('[New reviewed local reason]')
    await shot('retry-edited')
    await page.keyboard.press('Escape')
    await expect(leave).toContainText('Retry schedule choices')
    await expect(leave).not.toContainText('Single-page schedule choices')
    await shot('retry-leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(reason).toHaveValue('[New reviewed local reason]')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(mainTime).toHaveValue(chosen)
    expect(await retries()).toEqual([])
    expect((await f.pool.query('SELECT * FROM scheduled_actions WHERE id=$1', [job])).rows[0]).toEqual(failed)
    await open()
    await expect(time).toHaveValue(chosen)
    await expect(reason).toHaveValue('[New reviewed local reason]')
    await shot('retry-restored')
    await page.evaluate(() => {
      const original = Storage.prototype.removeItem
      ;(window as any).removeStorage = original
      Storage.prototype.removeItem = function (key) {
        if (key.includes('.retry.')) throw new Error('Synthetic storage refusal')
        return original.call(this, key)
      }
    })
    await dialog.getByRole('button', { name: 'Clear saved retry choices', exact: true }).click()
    await expect(dialog.getByRole('alert').filter({ hasText: 'could not be cleared' })).toBeVisible()
    await expect(reason).toHaveValue('[New reviewed local reason]')
    await shot('retry-clear-error')
    await page.evaluate(() => {
      Storage.prototype.removeItem = (window as any).removeStorage
    })
    await dialog.getByRole('button', { name: 'Schedule new attempt', exact: true }).click()
    await expect(dialog.getByRole('alert').filter({ hasText: 'findings changed' })).toBeVisible()
    expect(await retries()).toEqual([])
    await dialog.getByRole('button', { name: 'Schedule new attempt', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'A new attempt is scheduled' })).toBeVisible()
    await expect(mainTime).toHaveValue(chosen)
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    const attempts = await retries()
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      version_id: draft.version_id,
      override_reason: '[New reviewed local reason]',
      status: 'pending',
    })
    expect((await f.pool.query('SELECT * FROM scheduled_actions WHERE id=$1', [job])).rows[0]).toEqual(failed)
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.cancel_page_schedule($1)', [attempts[0].id])
    await c.query('COMMIT')
  } finally {
    if (pulse) clearInterval(pulse)
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [worker])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
