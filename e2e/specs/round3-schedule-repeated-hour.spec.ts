import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
test('repeated-hour scheduling names and saves the next future occurrence through both existing forms', async ({
  browser,
  baseURL,
}, info) => {
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    worker = 'repeated-hour-' + randomUUID(),
    folder = resolve('../.r8-progress/round3/schedule-repeated-hour/' + info.project.name),
    context = await browser.newContext({
      baseURL: baseURL ?? `http://127.0.0.1:${E2E_PORTS.admin}`,
      timezoneId: 'America/New_York',
    }),
    page = await context.newPage()
  let pulse: ReturnType<typeof setInterval> | undefined
  try {
    await mkdir(folder, { recursive: true })
    const actor = (await c.query("SELECT id FROM app_users WHERE email='root@example.test'")).rows[0]!.id,
      head = (
        await c.query(
          'SELECT p.revision,p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [f.pages[0]],
        )
      ).rows[0]!
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE cms_authenticated_user')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    const content = structuredClone(head.content)
    content[0].values.heading = '[Scheduled words]'
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      f.pages[0],
      head.revision,
      JSON.stringify(content),
      JSON.stringify(head.meta),
    ])
    await c.query('COMMIT')
    await f.pool.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      worker,
    ])
    pulse = setInterval(() => {
      void f.pool.query('UPDATE job_heartbeats SET last_seen_at=now() WHERE worker_id=$1', [worker]).catch(() => {})
    }, 5000)
    const year = new Date().getUTCFullYear() + 1,
      day = 1 + ((7 - new Date(Date.UTC(year, 10, 1)).getUTCDay()) % 7),
      date = year + '-11-' + String(day).padStart(2, '0')
    await signIn(page, 'root@example.test')
    await page.clock.setFixedTime(new Date(date + 'T06:00:00Z'))
    await page.goto('/pages/' + f.pages[0])
    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: 'Publish later', exact: true })
    await expect(drawer).toBeVisible()
    await drawer.getByLabel('Date and time (America/New_York)', { exact: true }).fill(date + 'T01:53')
    await expect(drawer.getByText(/This clock time happens twice/)).toContainText('EST')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'reviewed-second-occurrence-' + width + '.png') })
    }
    await drawer.getByRole('button', { name: 'Schedule selected changes', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Scheduling request saved')
    const first = (
      await f.pool.query(
        "SELECT id,run_at FROM scheduled_actions WHERE site_id=$1 AND item_type='release' ORDER BY created_at DESC LIMIT 1",
        [f.site],
      )
    ).rows[0]!
    expect(first.run_at.toISOString()).toBe(date + 'T06:53:00.000Z')
    expect(
      (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pages[0]])).rows[0]!.published_version_id,
    ).toBe(head.published_version_id)
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.cancel_page_schedule($1)', [first.id])
    await c.query('COMMIT')
    await page.goto('/sites/' + f.site + '/publishing?tab=scheduled')
    await page.getByText('Schedule a single page', { exact: true }).click()
    const form = page.locator('form').filter({ has: page.getByLabel('Page', { exact: true }) })
    await form.getByLabel('Page', { exact: true }).selectOption(f.pages[0]!)
    await form.getByLabel('Date and time (America/New_York)', { exact: true }).fill(date + 'T01:54')
    await expect(form.getByText(/This clock time happens twice/)).toContainText('EST')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await form.scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(folder, 'single-page-second-occurrence-' + width + '.png') })
    }
    await form.getByRole('button', { name: 'Save schedule', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Schedule saved for this exact version')
    const second = (
      await f.pool.query(
        "SELECT id,run_at FROM scheduled_actions WHERE site_id=$1 AND item_type='page' ORDER BY created_at DESC LIMIT 1",
        [f.site],
      )
    ).rows[0]!
    expect(second.run_at.toISOString()).toBe(date + 'T06:54:00.000Z')
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.user_id',$1,true)", [actor])
    await c.query('SELECT app.cancel_page_schedule($1)', [second.id])
    await c.query('COMMIT')
  } finally {
    if (pulse) clearInterval(pulse)
    await context.close()
    await c.query('ROLLBACK').catch(() => {})
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [worker])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    c.release()
    await f.pool.end()
  }
})
