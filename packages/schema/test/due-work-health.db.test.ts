import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'

let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('due_work_health')
  s = await seedScenario(db)
  // The shared definition seed also requests a thumbnail. Complete fixture
  // setup before measuring the eligibility of the work this test creates.
  await db.as('owner', client =>
    client.query("UPDATE outbox SET status='delivered',processed_at=now() WHERE status='pending'"),
  )
})
afterAll(async () => {
  await db?.close()
})
const health = () =>
  db.asUser(s.superAdmin, async client => (await client.query('SELECT * FROM app.job_queue_health()')).rows[0]!)

it('measures due waiting time while keeping intentionally deferred cleanup quiet', async () => {
  const id = (
    await db.as('owner', client =>
      client.query(
        `INSERT INTO outbox(site_id,event_type,payload,created_at,next_attempt_at)
    VALUES($1,'media.cleanup_requested','{}',now()-interval '29 days',now()+interval '1 day') RETURNING id`,
        [s.siteA],
      ),
    )
  ).rows[0]!.id
  expect(await health()).toMatchObject({ outbox_waiting: '0', outbox_oldest_waiting_seconds: null })
  await db.as('owner', client =>
    client.query("UPDATE outbox SET next_attempt_at=now()-interval '2 seconds' WHERE id=$1", [id]),
  )
  const eligible = await health()
  expect(eligible.outbox_waiting).toBe('1')
  expect(Number(eligible.outbox_oldest_waiting_seconds)).toBeLessThan(10)
  await db.as('owner', client =>
    client.query("UPDATE outbox SET next_attempt_at=now()-interval '10 minutes' WHERE id=$1", [id]),
  )
  expect(Number((await health()).outbox_oldest_waiting_seconds)).toBeGreaterThanOrEqual(600)
})

it('retains archived preview failures as history without hiding active delivery failures', async () => {
  const ids = (
    await db.as('owner', client =>
      client.query(
        `INSERT INTO outbox(site_id,event_type,payload,status,last_error,failed_at)
    VALUES($1,'section_def.thumbnail_requested','{}','dead','thumbnail-renders-nothing',now()),
      ($1,'page.published','{}','dead','delivery-failed',now()) RETURNING id`,
        [s.siteA],
      ),
    )
  ).rows
  await db.as('owner', client =>
    client.query("UPDATE sites SET archived_at=now(),status='archived' WHERE id=$1", [s.siteA]),
  )
  expect((await health()).outbox_dead).toBe('1')
  expect(
    (await db.as('owner', client => client.query('SELECT status,last_error FROM outbox WHERE id=$1', [ids[0]!.id])))
      .rows[0],
  ).toEqual({ status: 'dead', last_error: 'thumbnail-renders-nothing' })
})
