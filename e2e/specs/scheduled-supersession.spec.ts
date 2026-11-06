import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { READINESS_POLICY_VERSION } from '../../packages/domain/src/index.ts'
import { e2eTarget } from '../test-target.ts'
import { signIn, saveDraft, publish } from './helpers.ts'

const run = promisify(execFile)
test('an older page schedule explains its refusal and keeps a newer manual publication live', async ({
  page,
  browser,
}, info) => {
  const target = e2eTarget(),
    pool = new Pool({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` }),
    client = await pool.connect()
  const worker = 'supersession-' + randomUUID(),
    slug = 'scheduled-' + randomUUID().slice(0, 8),
    folder = resolve('../.r8-progress/scheduled-supersession/' + info.project.name)
  let id = '',
    jobId = ''
  try {
    await mkdir(folder, { recursive: true })
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const def = (
      await client.query(
        "SELECT d.id,max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    await client.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      worker,
    ])
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, '[Scheduled page]'])).rows[0]!.id
    const draft = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify([
          {
            section_def_id: def.id,
            section_def_version: def.version,
            values: { heading: '[Scheduled version A]', intro: '[Local scheduling check]' },
          },
        ]),
        JSON.stringify({ description: '[Local scheduling check]' }),
      ])
    ).rows[0]!
    jobId = (
      await client.query("SELECT app.schedule_page_action($1,$2,$3,'publish',$4,$5,'[]',NULL,$6) AS id", [
        id,
        draft.revision,
        draft.version_id,
        new Date(Date.now() + 3600000),
        READINESS_POLICY_VERSION,
        randomUUID(),
      ])
    ).rows[0]!.id
    await client.query('COMMIT')

    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + id + '?section=0')
    await page.getByLabel('Heading', { exact: true }).fill('[Newer manual publication]')
    await saveDraft(page)
    await publish(page)
    const live = (await pool.query('SELECT revision,published_version_id FROM pages WHERE id=$1', [id])).rows[0]!
    await pool.query("UPDATE scheduled_actions SET run_at=now()-interval '1 second' WHERE id=$1", [jobId])
    const result = await run(
      process.execPath,
      [
        '--conditions=react-server',
        '--experimental-strip-types',
        '--no-warnings',
        'e2e/fixtures/scheduled-drain-runner.ts',
      ],
      { cwd: resolve('..'), timeout: 20000 },
    )
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ran: 0, failed: 1, retrying: 0 })
    expect((await pool.query('SELECT revision,published_version_id FROM pages WHERE id=$1', [id])).rows[0]).toEqual(
      live,
    )

    await page.goto('/sites/' + site + '/publishing?tab=scheduled')
    const job = page.locator('#schedule-' + jobId)
    await expect(job).toContainText('Status: failed')
    await expect(job).toContainText(
      'A newer version is already live. This schedule was skipped; review the page before scheduling again.',
    )
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await job.scrollIntoViewIfNeeded()
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(folder, 'recorded-failure-' + width + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await job.getByRole('button', { name: 'Retry failed schedule', exact: true }).click()
    const retry = page.getByRole('alertdialog', { name: 'Retry this failed schedule?', exact: true })
    const future = await page.evaluate(() => {
      const date = new Date(Date.now() + 3600000)
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
      return date.toISOString().slice(0, 16)
    })
    await retry.getByLabel(/Retry date and time/).fill(future)
    await retry.getByRole('button', { name: 'Schedule new attempt', exact: true }).click()
    await expect(retry.getByRole('alert')).toContainText(
      'A newer version is already live. Review the page and schedule its current version.',
    )
    expect((await pool.query('SELECT id FROM scheduled_actions WHERE retry_of_id=$1', [jobId])).rows).toHaveLength(0)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.screenshot({ path: resolve(folder, 'retry-needs-current-version-' + width + '.png') })
    }
    await retry.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Before you leave', exact: true })
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    const context = await browser.newContext({ javaScriptEnabled: false }),
      view = await context.newPage()
    try {
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 1000 })
        await view.goto(`http://demo.staging.localhost:${E2E_PORTS.site}/` + slug)
        await expect(view.getByRole('heading', { name: '[Newer manual publication]', exact: true })).toBeVisible()
        await expect(view.getByRole('heading', { name: '[Scheduled version A]', exact: true })).toHaveCount(0)
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.evaluate(() => document.fonts.ready)
        await view.screenshot({ path: resolve(folder, 'newer-publication-' + width + '.png'), fullPage: true })
      }
    } finally {
      await context.close()
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (jobId) await pool.query('DELETE FROM scheduled_actions WHERE id=$1', [jobId])
    await pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [worker])
    if (id) await pool.query('UPDATE pages SET archived_at=now() WHERE id=$1', [id])
    client.release()
    await pool.end()
  }
})

test('repeated worker interruptions stop at the limit with a visible failure and preserve the live page', async ({
  page,
  browser,
}, info) => {
  const target = e2eTarget(),
    pool = new Pool({ connectionString: `postgres://cms:cms@${target.host}:${target.port}/${target.database}` }),
    client = await pool.connect()
  const worker = 'supersession-' + randomUUID(),
    slug = 'scheduled-' + randomUUID().slice(0, 8),
    folder = resolve('../.r8-progress/crash-exhaustion/' + info.project.name)
  let id = '',
    jobId = ''
  try {
    await mkdir(folder, { recursive: true })
    await client.query('BEGIN')
    const actor = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
    const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
    const def = (
      await client.query(
        "SELECT d.id,max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
      )
    ).rows[0]!
    await client.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','synthetic-e2e')", [
      worker,
    ])
    await client.query('SET LOCAL ROLE cms_authenticated_user')
    await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
    id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site, slug, '[Scheduled page]'])).rows[0]!.id
    const draft = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify([
          {
            section_def_id: def.id,
            section_def_version: def.version,
            values: { heading: '[Scheduled version A]', intro: '[Local scheduling check]' },
          },
        ]),
        JSON.stringify({ description: '[Local scheduling check]' }),
      ])
    ).rows[0]!
    jobId = (
      await client.query("SELECT app.schedule_page_action($1,$2,$3,'publish',$4,$5,'[]',NULL,$6) AS id", [
        id,
        draft.revision,
        draft.version_id,
        new Date(Date.now() + 3600000),
        READINESS_POLICY_VERSION,
        randomUUID(),
      ])
    ).rows[0]!.id
    await client.query('COMMIT')

    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + id + '?section=0')
    await publish(page)
    const live = (await pool.query('SELECT revision,published_version_id FROM pages WHERE id=$1', [id])).rows[0]!
    await pool.query("UPDATE scheduled_actions SET run_at=now()-interval '1 second',max_attempts=2 WHERE id=$1", [
      jobId,
    ])
    // A committed lease with no settlement represents a worker process that stopped.
    // Expire only this fixture's lease; no general worker runs against review data.
    for (let attempt = 0; attempt < 2; attempt++) {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE cms_worker')
      await client.query("SELECT set_config('app.worker_id',$1,true)", [worker])
      expect((await client.query('SELECT id FROM app.claim_scheduled_action(60)')).rows[0]!.id).toBe(jobId)
      await client.query('COMMIT')
      await pool.query("UPDATE scheduled_actions SET leased_until=now()-interval '1 second' WHERE id=$1", [jobId])
    }
    const result = await run(
      process.execPath,
      [
        '--conditions=react-server',
        '--experimental-strip-types',
        '--no-warnings',
        'e2e/fixtures/scheduled-drain-runner.ts',
      ],
      { cwd: resolve('..'), timeout: 20000 },
    )
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ran: 0, failed: 0, retrying: 0 })
    expect((await pool.query('SELECT revision,published_version_id FROM pages WHERE id=$1', [id])).rows[0]).toEqual(
      live,
    )
    expect(
      (
        await pool.query('SELECT status,attempt_count,failure_kind,leased_until FROM scheduled_actions WHERE id=$1', [
          jobId,
        ])
      ).rows[0],
    ).toMatchObject({ status: 'failed', attempt_count: 2, failure_kind: 'attempts_exhausted', leased_until: null })

    await page.goto('/sites/' + site + '/publishing?tab=scheduled')
    const job = page.locator('#schedule-' + jobId)
    await expect(job).toContainText('Status: failed')
    await expect(job).toContainText(
      'This schedule could not finish after repeated interruptions. Review the page before trying again.',
    )
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await job.scrollIntoViewIfNeeded()
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: resolve(folder, 'recorded-failure-' + width + '.png') })
    }
    const context = await browser.newContext({ javaScriptEnabled: false }),
      view = await context.newPage()
    try {
      for (const width of [1440, 1024, 390]) {
        await view.setViewportSize({ width, height: 1000 })
        await view.goto(`http://demo.staging.localhost:${E2E_PORTS.site}/` + slug)
        await expect(view.getByRole('heading', { name: '[Scheduled version A]', exact: true })).toBeVisible()
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await view.evaluate(() => document.fonts.ready)
        await view.screenshot({ path: resolve(folder, 'preserved-publication-' + width + '.png'), fullPage: true })
      }
    } finally {
      await context.close()
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    if (jobId) await pool.query('DELETE FROM scheduled_actions WHERE id=$1', [jobId])
    await pool.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [worker])
    if (id) await pool.query('UPDATE pages SET archived_at=now() WHERE id=$1', [id])
    client.release()
    await pool.end()
  }
})
