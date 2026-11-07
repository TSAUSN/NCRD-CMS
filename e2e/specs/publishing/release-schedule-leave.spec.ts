import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('Publish later preserves private intent on leave without implicitly scheduling', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    worker = 'schedule-leave-' + randomUUID(),
    folder = resolve('../.r8-progress/round3/release-schedule-leave/' + info.project.name)
  let pulse: ReturnType<typeof setInterval> | undefined
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      id = f.pages[0]!
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const row = (
        await c.query(
          'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [id],
        )
      ).rows[0]!,
      content = structuredClone(row.content)
    content.length = 0
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      id,
      row.revision,
      JSON.stringify(content),
      JSON.stringify(row.meta),
    ])
    await c.query('COMMIT')
    await f.pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      worker,
    ])
    pulse = setInterval(() => {
      void f.pool.query('UPDATE job_heartbeats SET last_seen_at=now() WHERE worker_id=$1', [worker]).catch(() => {})
    }, 5000)
    const heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      queue = async () =>
        (await f.pool.query('SELECT * FROM scheduled_actions WHERE site_id=$1 ORDER BY id', [f.site])).rows,
      base = '/sites/' + f.site + '/publishing'
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + id)
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Publish later', exact: true })).toBeVisible()
    const address = page.url(),
      releaseId = new URL(address).searchParams.get('release')!,
      key = 'cms.release-schedule.' + actor + '.' + f.site + '.' + releaseId,
      reasonText = '[Reviewed local schedule exception]',
      drawer = page.getByRole('dialog', { name: 'Publish later', exact: true }),
      time = drawer.getByLabel(/^Date and time/),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(leave).toHaveCount(0)
    await page.getByLabel('Reason for publishing despite these findings', { exact: true }).fill(reasonText)
    await page.getByRole('button', { name: 'Publish later…', exact: true }).click()
    const chosen = await page.evaluate(() => {
      const value = new Date(Date.now() + 86400000)
      value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
      return value.toISOString().slice(0, 16)
    })
    const reason = drawer.getByLabel('Reason for publishing despite these findings', { exact: true })
    await expect(reason).toBeVisible()
    await reason.fill(reasonText)
    await time.fill(chosen)
    await capture('edited')
    await page.keyboard.press('Escape')
    await expect(leave).toContainText('Publish later choices (saved only in this browser)')
    await capture('leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(time).toHaveValue(chosen)
    await drawer.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(drawer).toHaveCount(0)
    await expect(page.getByLabel('Reason for publishing despite these findings', { exact: true })).toHaveValue('')
    await page.getByLabel('Reason for publishing despite these findings', { exact: true }).fill(reasonText)
    await page.getByRole('button', { name: 'Publish later…', exact: true }).click()
    await expect(time).toHaveValue('')
    await expect(reason).toHaveValue(reasonText)
    expect(await queue()).toEqual([])
    await reason.fill(reasonText)
    await time.fill(chosen)
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      ;(window as any).storageWrite = original
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('cms.release-schedule.')) throw new Error('Synthetic storage refusal')
        return original.call(this, key, value)
      }
    })
    await drawer.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not save')
    await capture('storage-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(time).toHaveValue(chosen)
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as any).storageWrite
    })
    await drawer.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(drawer).toHaveCount(0)
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).time, key)).toBe(chosen)
    expect(await queue()).toEqual([])
    await page.goto(address)
    await expect(drawer).toBeVisible()
    await expect(time).toHaveValue(chosen)
    await expect(reason).toHaveValue(reasonText)
    await expect(drawer).toContainText('confirm any required approvals again')
    await capture('restored')
    await reason.scrollIntoViewIfNeeded()
    await capture('reason')
    const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const view = await isolated.newPage()
      await signIn(view, 'root@example.test')
      await view.goto(address)
      await expect(
        view.getByRole('dialog', { name: 'Publish later', exact: true }).getByLabel(/^Date and time/),
      ).toHaveValue('')
      await expect(
        view
          .getByRole('dialog', { name: 'Publish later', exact: true })
          .getByLabel('Reason for publishing despite these findings', { exact: true }),
      ).toHaveValue('')
    } finally {
      await isolated.close()
    }
    await page.evaluate(() => {
      const original = Storage.prototype.removeItem
      ;(window as any).storageRemove = original
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('cms.release-schedule.')) throw new Error('Synthetic storage refusal')
        return original.call(this, key)
      }
    })
    await drawer.getByRole('button', { name: 'Clear saved choices', exact: true }).click()
    await expect(drawer.getByRole('alert')).toContainText('could not be cleared')
    await expect(time).toHaveValue(chosen)
    await capture('clear-error')
    await page.evaluate(() => {
      Storage.prototype.removeItem = (window as any).storageRemove
    })
    await drawer.getByRole('button', { name: 'Clear saved choices', exact: true }).click()
    await expect(time).toHaveValue('')
    await expect(reason).toHaveValue('')
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    await reason.fill(reasonText)
    await time.fill(chosen)
    const intercept = '**/sites/' + f.site + '/publishing**'
    await page.route(intercept, async route => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action'])
        await route.fulfill({ status: 503, body: 'Synthetic unavailable' })
      else await route.continue()
    })
    await drawer.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(drawer.getByRole('alert')).toContainText('could not be confirmed')
    await expect(time).toHaveValue(chosen)
    await capture('command-error')
    expect(await queue()).toEqual([])
    await page.unroute(intercept)
    await drawer.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await page
      .getByLabel('Reason for publishing despite these findings', { exact: true })
      .fill(reasonText + ' Updated.')
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Save draft and leave', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible()
    expect(await queue()).toEqual([])
    await page.goto(address)
    await expect(time).toHaveValue(chosen)
    await drawer.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(drawer).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Scheduling request saved' })).toBeVisible()
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    const jobs = await queue()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ status: 'pending', item_type: 'release', item_id: releaseId })
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
