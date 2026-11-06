import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { Pool } from 'pg'
import { canvas, clickOnCanvas, fetchPublic, openSeededPage, publish, savedState, signIn } from './helpers.ts'
import { runDueSchedules } from '../../apps/worker/src/handlers.ts'
import { READINESS_POLICY_VERSION } from '../../packages/domain/src/readiness.ts'
import { readConfig } from '../../apps/worker/src/config.ts'

const target = (role: string, password: string) =>
  `postgres://${role}:${password}@${process.env['E2E_PG_HOST'] ?? '127.0.0.1'}:${process.env['E2E_PG_PORT'] ?? '54329'}/${process.env['E2E_DATABASE'] ?? 'cms_e2e'}`

// SPEC §9.3 / QA-04, measured locally against the production builds this suite
// runs. Each test attaches its measurements; the limits asserted are the SPEC's
// budgets. Local timing on one machine is not hosted evidence.
test.describe('performance budgets (local)', () => {
  test('selection feedback stays within 100ms on the canvas and in the inspector', async ({ page }, testInfo) => {
    await signIn(page, 'editor@example.test')
    await openSeededPage(page)
    await canvas(page).locator('[data-cms-slot]').first().waitFor()
    const samples: number[] = []
    for (let round = 0; round < 12; round += 1) {
      for (const slot of ['heading', 'intro']) {
        samples.push(
          await page.evaluate(async name => {
            const doc = document.querySelector<HTMLIFrameElement>('iframe[title="Page canvas"]')!.contentDocument!
            const el = doc.querySelector(`[data-cms-slot="${name}"]`)!
            const start = performance.now()
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
            return new Promise<number>(resolve => {
              const check = () =>
                el.hasAttribute('data-cms-selected') && document.querySelector(`#slot-0-${name}`)
                  ? resolve(performance.now() - start)
                  : requestAnimationFrame(check)
              requestAnimationFrame(check)
            })
          }, slot),
        )
        await page.waitForTimeout(50)
      }
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!,
      p90 = sorted[Math.floor(sorted.length * 0.9)]!
    const selection = JSON.stringify({ samples: samples.map(sample => Math.round(sample * 10) / 10), median, p90 })
    await testInfo.attach('selection-feedback.json', { body: selection, contentType: 'application/json' })
    console.log(`BUDGET selection-feedback ${selection}`)
    expect(median).toBeLessThanOrEqual(100)
    expect(p90).toBeLessThanOrEqual(100)
  })

  test('an edit is acknowledged within 2s and published content is visible within 2s', async ({ page }, testInfo) => {
    await signIn(page, 'editor@example.test')
    await openSeededPage(page)
    await clickOnCanvas(page, 'heading')
    const heading = `Budget ${Date.now()}`
    const typed = Date.now()
    await page.locator('#slot-0-heading').fill(heading)
    await expect(savedState(page)).toHaveText('All changes saved', { timeout: 10_000 })
    const acknowledged = Date.now() - typed
    await publish(page)
    const published = Date.now()
    let visible = Number.POSITIVE_INFINITY
    for (;;) {
      if ((await fetchPublic()).body.includes(heading)) {
        visible = Date.now() - published
        break
      }
      if (Date.now() - published > 10_000) break
      await page.waitForTimeout(25)
    }
    const timings = JSON.stringify({ acknowledgedMs: acknowledged, visibleAfterPublishMs: visible })
    await testInfo.attach('save-and-publish.json', { body: timings, contentType: 'application/json' })
    console.log(`BUDGET save-and-publish ${timings}`)
    expect(acknowledged).toBeLessThanOrEqual(2_000)
    expect(visible).toBeLessThanOrEqual(2_000)
  })

  test('a due schedule publishes within 60s with the worker polling at its configured interval', async ({}, testInfo) => {
    test.setTimeout(90_000)
    // The worker's own schedule pass, on its configured poll interval, as `apps/worker/src/main.ts` runs it.
    const pollMs = readConfig({
      ...process.env,
      DATABASE_URL_WORKER: target('cms_worker_app', 'devpassword'),
    } as NodeJS.ProcessEnv).pollMs
    const fixtures = new Pool({ connectionString: target('cms', 'cms') }),
      worker = new Pool({ connectionString: target('cms_worker_app', 'devpassword') })
    const workerId = `budget-${randomUUID()}`,
      title = `Scheduled ${randomUUID().slice(0, 8)}`
    let pageId = ''
    try {
      const client = await fixtures.connect()
      try {
        await client.query('BEGIN')
        const editor = (await client.query("SELECT id FROM app_users WHERE email='editor@example.test'")).rows[0]!.id
        const site = (await client.query("SELECT id FROM sites WHERE slug='demo'")).rows[0]!.id
        const def = (
          await client.query(
            "SELECT d.id, max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug='hero' AND d.site_id IS NULL GROUP BY d.id",
          )
        ).rows[0]!
        await client.query("SELECT set_config('app.user_id',$1,true)", [editor])
        // A heartbeat makes scheduling available; this test's own loop is the worker that consumes it.
        await client.query("INSERT INTO job_heartbeats(worker_id,role,version) VALUES($1,'worker','budget-e2e')", [
          workerId,
        ])
        pageId = (
          await client.query('SELECT app.create_page($1,$2,$3) AS id', [
            site,
            `scheduled-${randomUUID().slice(0, 8)}`,
            title,
          ])
        ).rows[0]!.id
        const draft = (
          await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
            pageId,
            JSON.stringify([
              {
                section_def_id: def.id,
                section_def_version: def.version,
                values: { heading: title, intro: 'Published by the schedule budget test.' },
                hidden: false,
                hidden_at: [],
                label: 'Hero',
              },
            ]),
            '{}',
          ])
        ).rows[0]!
        const job = (
          await client.query("SELECT app.schedule_page_action($1,$2,$3,'publish',$4,$5,'[]',NULL,$6) AS id", [
            pageId,
            draft.revision,
            draft.version_id,
            new Date(Date.now() + 120_000),
            READINESS_POLICY_VERSION,
            randomUUID(),
          ])
        ).rows[0]!.id
        // The product requires at least a minute's notice; the fixture then makes this one row due in two seconds.
        await client.query("UPDATE scheduled_actions SET run_at=clock_timestamp()+interval '2 seconds' WHERE id=$1", [
          job,
        ])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
      const due = (await fixtures.query('SELECT run_at FROM scheduled_actions WHERE item_id=$1', [pageId])).rows[0]!
        .run_at as Date
      let finished: Date | null = null
      while (!finished && Date.now() - due.getTime() < 60_000) {
        await runDueSchedules(worker, workerId, { leaseSeconds: 60 })
        const state = (
          await fixtures.query('SELECT status,finished_at,last_error FROM scheduled_actions WHERE item_id=$1', [pageId])
        ).rows[0]
        expect(state?.status, state?.last_error ?? 'The scheduled job must not fail.').not.toBe('failed')
        finished = state?.status === 'succeeded' ? state.finished_at : null
        if (!finished) await new Promise(resolve => setTimeout(resolve, pollMs))
      }
      expect(finished).not.toBeNull()
      const live = await fetchPublic(
        `/${(await fixtures.query('SELECT slug FROM pages WHERE id=$1', [pageId])).rows[0]!.slug}`,
      )
      const timings = JSON.stringify({
        pollMs,
        dueToExecutedMs: finished!.getTime() - due.getTime(),
        liveStatus: live.status,
      })
      await testInfo.attach('due-schedule.json', { body: timings, contentType: 'application/json' })
      console.log(`BUDGET due-schedule ${timings}`)
      expect(live.status).toBe(200)
      expect(live.body).toContain(title)
      expect(finished!.getTime() - due.getTime()).toBeLessThanOrEqual(60_000)
    } finally {
      await fixtures.query('DELETE FROM job_heartbeats WHERE worker_id=$1', [workerId]).catch(() => undefined)
      await fixtures.end()
      await worker.end()
    }
  })
})
