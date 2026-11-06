import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { drainOutbox, heartbeat, queueHealth, type EventHandler } from '../src/handlers.ts'

let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('request_worker')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
beforeEach(async () => {
  await db.as('owner', c => c.query('DELETE FROM outbox; DELETE FROM job_heartbeats'))
})

it('stops between items without claiming or attempting the next event', async () => {
  await db.as('owner', c =>
    c.query("INSERT INTO outbox(site_id,event_type,payload) VALUES($1,'test.request','{}'),($1,'test.request','{}')", [
      s.siteA,
    ]),
  )
  let remaining = true
  const handlers = new Map<string, EventHandler>([
    [
      'test.request',
      {
        idempotency: 'guarded',
        async handle() {
          remaining = false
        },
      },
    ],
  ])
  const result = await drainOutbox(db.pool('worker'), 'bounded', handlers, { shouldContinue: () => remaining })
  expect(result.delivered).toBe(1)
  const rows = (await db.as('owner', c => c.query('SELECT status,attempts,leased_until FROM outbox ORDER BY id'))).rows
  expect(rows[1]).toMatchObject({ status: 'pending', attempts: 0, leased_until: null })
})

it('allows normal one-minute trigger jitter, but closes scheduling and reports stale when it stops', async () => {
  await db.asWorker('request', c => heartbeat(c, 'request-worker', 'test'))
  await db.as('owner', c => c.query("UPDATE job_heartbeats SET last_seen_at=now()-interval '90 seconds'"))
  const available = () =>
    db.asUser(s.editorA, async c => (await c.query('SELECT app.scheduling_available() AS ready')).rows[0].ready)
  expect(await available()).toBe(true)
  expect(Number((await queueHealth(db.pool('worker'))).live_workers)).toBe(1)
  await db.as('owner', c => c.query("UPDATE job_heartbeats SET last_seen_at=now()-interval '151 seconds'"))
  expect(await available()).toBe(false)
  expect(Number((await queueHealth(db.pool('worker'))).live_workers)).toBe(0)
  await db.asWorker('request', c => heartbeat(c, 'worker', 'continuous'))
  await db.as('owner', c => c.query("UPDATE job_heartbeats SET last_seen_at=now()-interval '90 seconds'"))
  expect(await available()).toBe(false)
  await expectSqlState(
    db.as('public', c => c.query("SELECT app.worker_heartbeat('request-worker','forged')")),
    '42501',
  )
})
