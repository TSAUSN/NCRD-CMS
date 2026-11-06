import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers.ts'

function database() {
  return new Pool({
    connectionString: `postgres://cms:cms@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`,
  })
}
async function failureFixture(missingHeading = false) {
  const pool = database()
  const workerId = `retry-browser-${randomUUID()}`
  const client = await pool.connect()
  let failed = false
  try {
    await client.query('BEGIN')
    const user = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const def = (
      await client.query(
        "SELECT d.id,max(v.version) AS current_version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    await client.query("SELECT set_config('app.user_id',$1,true)", [user])
    // A test-owned heartbeat activates the product UI, but no process consumes
    // schedules. All retry times are future and cleanup removes only this fixture.
    await client.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      workerId,
    ])
    const title = `Retry fixture ${randomUUID().slice(0, 8)}`
    const id = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, `retry-${randomUUID().slice(0, 8)}`, title])
    ).rows[0]!.id
    const draft = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify(
          missingHeading
            ? []
            : [
                {
                  section_def_id: def.id,
                  section_def_version: def.current_version,
                  values: { heading: title, intro: 'A synthetic local scheduling test.' },
                  hidden: false,
                  hidden_at: [],
                  label: 'Hero',
                },
              ],
        ),
        '{}',
      ])
    ).rows[0]!
    const job = (
      await client.query("SELECT app.schedule_page_action($1,$2,$3,'publish',$4,2,'[]',NULL,$5) AS id", [
        id,
        draft.revision,
        draft.version_id,
        new Date(Date.now() + 3600000),
        randomUUID(),
      ])
    ).rows[0]!.id
    await client.query(
      "UPDATE scheduled_actions SET status='failed',last_error='Synthetic provider failure',failure_kind='attempts_exhausted',attempt_count=5,finished_at=now(),override_reason=$2 WHERE id=$1",
      [job, missingHeading ? 'An earlier exception' : null],
    )
    await client.query('COMMIT')
    return { pool, siteId: site, pageId: id, jobId: job, versionId: draft.version_id as string, title, workerId }
  } catch (error) {
    await client.query('ROLLBACK')
    failed = true
    throw error
  } finally {
    client.release()
    if (failed) await pool.end()
  }
}
async function cleanup(f: Awaited<ReturnType<typeof failureFixture>>) {
  try {
    await f.pool.query('DELETE FROM scheduled_actions WHERE item_id=$1', [f.pageId])
    await f.pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [f.workerId])
  } finally {
    await f.pool.end()
  }
}
async function nextHour(page: Page) {
  return page.evaluate(() => {
    const date = new Date(Date.now() + 3600000)
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
  })
}

test('retries a failed schedule as a separate future attempt and preserves its recorded failure', async ({
  page,
  browserName,
}) => {
  const f = await failureFixture()
  try {
    await signIn(page, 'editor@example.test')
    await page.goto(`/sites/${f.siteId}/publishing?tab=scheduled`)
    const failed = page.locator(`#schedule-${f.jobId}`)
    await failed.getByRole('button', { name: 'Retry failed schedule', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Retry this failed schedule?' })
    await dialog.getByRole('button', { name: 'Schedule new attempt' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Choose a valid date')
    const time = dialog.getByLabel(/Retry date and time/)
    await time.fill(await nextHour(page))
    await time.focus()
    // Native date/time controls expose several internal keyboard segments.
    // Traverse them, then require focus to reach the next dialog control.
    // Safari on macOS uses Option-Tab to include buttons in keyboard navigation.
    for (let step = 0; step < 12 && (await time.evaluate(element => element === document.activeElement)); step++)
      await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Schedule new attempt' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('status')).toContainText('A new attempt is scheduled')
    await expect(failed).toContainText('Status: failed')
    await expect(failed).toContainText('Synthetic provider failure')
    await expect(failed.getByRole('link', { name: 'pending attempt' })).toBeVisible()
    const rows = (
      await f.pool.query('SELECT id,status,version_id,created_by,retry_of_id FROM scheduled_actions WHERE item_id=$1', [
        f.pageId,
      ])
    ).rows
    expect(rows).toHaveLength(2)
    const retry = rows.find(row => row.retry_of_id === f.jobId)!
    expect(retry).toMatchObject({ status: 'pending', version_id: f.versionId })
    expect(
      (await f.pool.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pageId])).rows[0]!
        .published_version_id,
    ).toBeNull()
    await page.locator(`#schedule-${retry.id}`).getByRole('button', { name: 'Cancel schedule' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel schedule' }).click()
    await expect(page.locator(`#schedule-${retry.id}`)).toContainText('Status: cancelled')
  } finally {
    await cleanup(f)
  }
})

test('shows fresh readiness failures and does not silently reuse an old exception', async ({ page }) => {
  const f = await failureFixture(true)
  try {
    await signIn(page, 'editor@example.test')
    await page.goto(`/sites/${f.siteId}/publishing?tab=scheduled`)
    await page.locator(`#schedule-${f.jobId}`).getByRole('button', { name: 'Retry failed schedule' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Retry this failed schedule?' })
    await dialog.getByLabel(/Retry date and time/).fill(await nextHour(page))
    await dialog.getByRole('button', { name: 'Schedule new attempt' }).click()
    await expect(dialog.getByRole('alert')).toContainText('still needs attention')
    await expect(dialog.getByLabel('Reason for the new publishing exception')).toHaveValue('')
    expect((await f.pool.query('SELECT id FROM scheduled_actions WHERE retry_of_id=$1', [f.jobId])).rows).toHaveLength(
      0,
    )
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Before you leave', exact: true })
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
  } finally {
    await cleanup(f)
  }
})
