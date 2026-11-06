import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
let counter = 0
beforeAll(async () => {
  db = await TestDatabase.create('page_scheduling')
  s = await seedScenario(db)
  await db.asWorker('schedule-ui-worker', client => client.query("SELECT app.worker_heartbeat('worker','test')"))
  await db.asUser(s.editorA, async client => {
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId), '{}'])
    await client.query('SELECT app.publish_page($1,1,$2,$3,$4)', [s.pageA, ...CHECKED_CLEAN])
  })
})
afterAll(async () => {
  await db?.close()
})
async function page() {
  return db.asUser(s.editorA, async client => {
    const id = (
      await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
        s.siteA,
        `scheduled-${++counter}`,
        'Scheduled page',
      ])
    ).rows[0]!.id
    const draft = (
      await client.query<{ version_id: string; revision: string }>('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        heroContent(s.heroDefId, 'Pinned content'),
        '{}',
      ])
    ).rows[0]!
    return { id, ...draft }
  })
}
async function schedule(
  p: Awaited<ReturnType<typeof page>>,
  action: string,
  report = '[]',
  reason: string | null = null,
) {
  const runAt = new Date(Date.now() + 120_000),
    requestId = randomUUID()
  const args = [p.id, p.revision, p.version_id, action, runAt, 1, report, reason, requestId]
  const query = () =>
    db.asUser(
      s.editorA,
      async client =>
        (await client.query<{ id: string }>('SELECT app.schedule_page_action($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id', args))
          .rows[0]!.id,
    )
  return { id: await query(), again: query }
}
async function claim(id: string) {
  // Tests control due-time fixtures; wall-clock cadence remains a staging gate.
  await db.as('owner', client =>
    client.query("UPDATE scheduled_actions SET run_at=now()-interval '1 second' WHERE id=$1", [id]),
  )
  return db.asWorker(
    'schedule-ui-worker',
    async client =>
      (await client.query<{ id: string; lease_token: string }>('SELECT * FROM app.claim_scheduled_action(60)'))
        .rows[0]!,
  )
}

describe('page scheduling commands', () => {
  it('is idempotent on retry and cancellation', async () => {
    const job = await schedule(await page(), 'publish')
    expect(await job.again()).toBe(job.id)
    await db.asUser(s.editorA, client => client.query('SELECT app.cancel_page_schedule($1)', [job.id]))
    await db.asUser(s.editorA, client => client.query('SELECT app.cancel_page_schedule($1)', [job.id]))
    const audits = await db.as('owner', client =>
      client.query("SELECT id FROM audit_log WHERE action='schedule.cancel' AND item_id=$1", [job.id]),
    )
    expect(audits.rows).toHaveLength(1)
  })
  it('publishes the pinned version rather than a later draft', async () => {
    const p = await page(),
      job = await schedule(p, 'publish')
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        p.id,
        p.revision,
        heroContent(s.heroDefId, 'Later draft'),
        '{}',
      ]),
    )
    const leased = await claim(job.id)
    await db.asWorker('schedule-ui-worker', client =>
      client.query('SELECT app.execute_scheduled_action($1,$2,1,$3)', [leased.id, leased.lease_token, '[]']),
    )
    const head = (
      await db.asUser(s.editorA, client =>
        client.query('SELECT published_version_id,draft_version_id FROM pages WHERE id=$1', [p.id]),
      )
    ).rows[0]!
    expect(head.published_version_id).toBe(p.version_id)
    expect(head.draft_version_id).not.toBe(p.version_id)
  })
  it('refuses to unpublish a different version that went live later', async () => {
    const p = await page()
    p.revision = (
      await db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [p.id, p.revision, ...CHECKED_CLEAN]),
      )
    ).rows[0]!.revision
    const job = await schedule(p, 'unpublish')
    const newer = (
      await db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          p.id,
          p.revision,
          heroContent(s.heroDefId, 'New publication'),
          '{}',
        ]),
      )
    ).rows[0]!
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [p.id, newer.revision, ...CHECKED_CLEAN]),
    )
    const leased = await claim(job.id)
    await expectSqlState(
      db.asWorker('schedule-ui-worker', client =>
        client.query('SELECT app.execute_scheduled_action($1,$2,1,NULL)', [leased.id, leased.lease_token]),
      ),
      'CMS04',
    )
    await db.asUser(s.editorA, client => client.query('SELECT app.cancel_page_schedule($1)', [job.id]))
  })
  it('does not use an old override for a newly introduced readiness problem', async () => {
    const report = JSON.stringify([{ rule: 'missing_h1', severity: 'blocking', message: 'No heading' }])
    const job = await schedule(await page(), 'publish', report, 'Intentional short notice')
    const leased = await claim(job.id)
    const result = await db.asWorker('schedule-ui-worker', client =>
      client.query('SELECT * FROM app.execute_scheduled_action($1,$2,1,$3)', [
        leased.id,
        leased.lease_token,
        JSON.stringify([{ rule: 'broken_internal_link', severity: 'blocking', message: 'A new missing link' }]),
      ]),
    )
    expect(result.rows[0]!.outcome).toBe('blocked')
  })
  it('requires a healthy worker and refuses contributors', async () => {
    const p = await page()
    await expectSqlState(
      db.asUser(s.contributorA, client =>
        client.query('SELECT app.schedule_page_action($1,$2,$3,$4,$5,1,$6,NULL,$7)', [
          p.id,
          p.revision,
          p.version_id,
          'publish',
          new Date(Date.now() + 120_000),
          '[]',
          randomUUID(),
        ]),
      ),
      'CMS02',
    )
    await db.as('owner', client => client.query("UPDATE job_heartbeats SET last_seen_at=now()-interval '2 minutes'"))
    await expectSqlState(schedule(p, 'publish'), 'CMS04')
  })
})
