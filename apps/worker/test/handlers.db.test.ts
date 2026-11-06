// The worker against a real database as the real worker role (SPEC §9). The
// point of these is that "the worker works" is not inferable from a unit test
// with a fake client: leases, privileges, and fail-closed behaviour are all
// database facts. Transport-level guarantees live in queue.db.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createRecordingCacheInvalidator } from '@cms/platform'
import { defaultHandlers, drainOutbox, heartbeat, queueHealth, runDueSchedules } from '../src/handlers.ts'
import { READINESS_POLICY_VERSION } from '@cms/domain'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('worker')
  s = await seedScenario(db)
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, 0, heroContent(s.heroDefId), '{}']),
  )
})
afterAll(async () => {
  await db?.close()
})

describe('heartbeat', () => {
  it('records a timestamp the product can show', async () => {
    const at = await db.asWorker('w1', c => heartbeat(c, 'worker', '1.2.3'))
    expect(at).toBeInstanceOf(Date)
    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ worker_id: string; version: string }>('SELECT worker_id, version FROM job_heartbeats'),
    )
    expect(rows).toEqual([{ worker_id: 'w1', version: '1.2.3' }])
  })

  it('updates last_seen_at rather than adding a second row on restart', async () => {
    await db.asWorker('w1', c => heartbeat(c, 'worker', '1.2.4'))
    const { rows } = await db.asUser(s.editorA, c => c.query('SELECT worker_id FROM job_heartbeats'))
    expect(rows).toHaveLength(1)
  })
})

describe('outbox drain', () => {
  it('delivers both real collection publication events, including an intentional empty dependency set', async () => {
    await db.as('owner', client =>
      client.query(
        "DELETE FROM outbox WHERE event_type IN ('collection.schema.published','collection.entries.published')",
      ),
    )
    const created = await db.asUser(
      s.superAdmin,
      async client =>
        (
          await client.query<{
            collection_id: string
            revision: string
          }>('SELECT * FROM app.create_collection($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [
            s.siteA,
            'worker-speakers',
            'Worker speakers',
            'worker_speakers',
            JSON.stringify([{ key: 'name', label: 'Name', required: true, type: 'text' }]),
            JSON.stringify({
              schemaVersion: 1,
              titleField: 'name',
              subtitleField: null,
              imageField: null,
              groupField: null,
            }),
          ])
        ).rows[0]!,
    )
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [created.collection_id, created.revision]),
    )
    const saved = await db.asUser(
      s.contributorA,
      async client =>
        (
          await client.query<{ entry_revision: string }>('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
            created.collection_id,
            JSON.stringify([{ id: null, stableKey: 'one', values: { name: 'One' } }]),
          ])
        ).rows[0]!,
    )
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.publish_collection_entries($1,$2)', [
        created.collection_id,
        saved.entry_revision,
      ]),
    )

    const cache = createRecordingCacheInvalidator()
    const result = await drainOutbox(db.pool('worker'), 'collection-publications', defaultHandlers(cache))
    expect(result.dead).toBe(0)
    expect(result.delivered).toBe(2)
    expect(cache.calls).toEqual([
      { siteId: s.siteA, paths: [], revision: 2 },
      { siteId: s.siteA, paths: [], revision: 2 },
    ])
  })

  it('invalidates the published path and marks the event delivered', async () => {
    await db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN]))
    const cache = createRecordingCacheInvalidator()
    const result = await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(cache))

    expect(result.delivered).toBeGreaterThan(0)
    expect(result.dead).toBe(0)
    expect(cache.calls.some(call => call.siteId === s.siteA && call.paths.includes('/'))).toBe(true)
    expect(cache.calls.some(call => call.siteId === s.siteA && call.paths.length > 0)).toBe(true)

    // Scoped to the invalidation work this drain is about. A section thumbnail
    // request is deliberately *left* by a process with no screenshotter — that
    // is what `unconfiguredThumbnailHandler` is for — and asserting an empty
    // queue would forbid the behaviour rather than test it. The two are counted
    // apart so neither can hide the other.
    const pending = await db.as('owner', c =>
      c.query<{ event_type: string }>("SELECT event_type FROM outbox WHERE status IN ('pending','running')"),
    )
    expect(pending.rows.filter(row => row.event_type.startsWith('page.'))).toHaveLength(0)
    expect(pending.rows.every(row => row.event_type === 'section_def.thumbnail_requested')).toBe(true)
  })

  it('leaves a failed event for a later pass — the publish is not undone', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'retry', 'Retry'])).rows[0]!
          .id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
    )
    await db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, 1, ...CHECKED_CLEAN]))

    const cache = createRecordingCacheInvalidator()
    // A page publication changes both the route and, in automatic mode, the
    // shared navigation shell. They are two idempotent invalidations because a
    // retry of one must not hide or duplicate the other.
    cache.failNext(2)
    const failedPass = await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(cache))
    expect(failedPass.retrying).toBe(2)

    // The published route is still there: invalidation failure never rolls back a publish.
    const route = await db.asUser(s.editorA, c =>
      c.query('SELECT path FROM published_routes WHERE site_id = $1 AND path = $2', [s.siteA, '/retry']),
    )
    expect(route.rows).toHaveLength(1)

    // Backoff holds it back, so the retry needs the clock moved forward.
    await db.as('owner', c =>
      c.query(
        "UPDATE outbox SET next_attempt_at = now() WHERE site_id = $1 AND event_type IN ('page.published','site_shell.published')",
        [s.siteA],
      ),
    )
    const retried = await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(cache))
    expect(retried.delivered).toBe(2)
    expect(cache.calls.some(call => call.paths.includes('/retry'))).toBe(true)

    const { rows } = await db.as('owner', c =>
      c.query<{ attempts: number; status: string }>(
        "SELECT attempts, status FROM outbox WHERE payload->>'path' = '/retry'",
      ),
    )
    expect(rows[0]!.attempts).toBe(2)
    expect(rows[0]!.status).toBe('delivered')
  })
})

describe('scheduled publication', () => {
  async function schedule(pageId: string, createdBy: string, action: 'publish' | 'unpublish' = 'publish') {
    return db.as('owner', async c => {
      const version = (
        await c.query<{ id: string }>('SELECT draft_version_id AS id FROM pages WHERE id = $1', [pageId])
      ).rows[0]!.id
      return (
        await c.query<{ id: string }>(
          `INSERT INTO scheduled_actions (site_id, item_type, item_id, version_id, action, run_at, created_by, readiness_policy_version)
         VALUES ($1,'page',$2,$3,$4, now() - interval '1 second', $5, $6) RETURNING id`,
          [s.siteA, pageId, version, action, createdBy, READINESS_POLICY_VERSION],
        )
      ).rows[0]!.id
    })
  }

  it('runs a due schedule through the same publication command and records the outcome', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'scheduled', 'Scheduled']))
          .rows[0]!.id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
    )
    const id = await schedule(page, s.editorA)

    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary.ran).toBe(1)

    const route = await db.asUser(s.editorA, c =>
      c.query('SELECT path FROM published_routes WHERE site_id = $1 AND path = $2', [s.siteA, '/scheduled']),
    )
    expect(route.rows).toHaveLength(1)

    const status = await db.as('owner', c =>
      c.query<{ status: string }>('SELECT status FROM scheduled_actions WHERE id = $1', [id]),
    )
    expect(status.rows[0]!.status).toBe('succeeded')
  })

  it('fires once — a second pass finds nothing due', async () => {
    expect((await runDueSchedules(db.pool('worker'), 'w1')).ran).toBe(0)
  })

  it('records the scheduled publication as the scheduler, not as a user', async () => {
    // One row for the publication, attributed to the scheduler. There is no
    // longer a second 'schedule.succeeded' row for the same event; the
    // schedule's own terminal state carries that (SPEC §6.13).
    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ actor_type: string; detail: Record<string, unknown> }>(
        `SELECT actor_type, detail FROM audit_log
          WHERE action = 'page.publish' AND actor_type = 'scheduler'
          ORDER BY id DESC LIMIT 1`,
      ),
    )
    expect(rows[0]!.actor_type).toBe('scheduler')
    expect(rows[0]!.detail['authorized_by']).toBe(s.editorA)
  })

  it('fails permanently — not retryably — when the creator has been disabled', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteA,
            'failclosed',
            'Fail closed',
          ])
        ).rows[0]!.id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
    )

    const doomed = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', ['leaving@example.test', 'Leaving']))
          .rows[0]!.id,
    )
    await db.asUser(s.superAdmin, c => c.query('SELECT app.set_site_membership($1,$2,$3)', [doomed, s.siteA, 'editor']))
    const id = await schedule(page, doomed)
    await db.asUser(s.superAdmin, c => c.query("SELECT app.set_user_status($1,'disabled')", [doomed]))

    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary.ran).toBe(0)
    // Losing authorization is not a transient condition, so it must not consume
    // five attempts before admitting it.
    expect(summary.failed).toBe(1)
    expect(summary.retrying).toBe(0)

    const row = await db.as('owner', c =>
      c.query<{ status: string; last_error: string; failure_kind: string; attempt_count: number }>(
        'SELECT status, last_error, failure_kind, attempt_count FROM scheduled_actions WHERE id = $1',
        [id],
      ),
    )
    expect(row.rows[0]!.status).toBe('failed')
    expect(row.rows[0]!.failure_kind).toBe('permanent')
    expect(row.rows[0]!.attempt_count).toBe(1)
    expect(row.rows[0]!.last_error).toMatch(/no active product user|not permitted/)

    const route = await db.asUser(s.editorA, c =>
      c.query('SELECT path FROM published_routes WHERE site_id = $1 AND path = $2', [s.siteA, '/failclosed']),
    )
    expect(route.rows).toHaveLength(0)
  })

  it('fails permanently when the pinned content is gone', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'vanishing', 'Vanishing']))
          .rows[0]!.id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
    )
    const id = await schedule(page, s.editorA)
    await db.as('owner', c => c.query('DELETE FROM pages WHERE id = $1', [page]))

    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary.failed).toBe(1)
    const row = await db.as('owner', c =>
      c.query<{ failure_kind: string }>('SELECT failure_kind FROM scheduled_actions WHERE id = $1', [id]),
    )
    expect(row.rows[0]!.failure_kind).toBe('permanent')
  })

  it('leases a due schedule to exactly one runner', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'contended', 'Contended']))
          .rows[0]!.id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
    )
    await schedule(page, s.editorA)

    const [a, b] = await Promise.all([
      db.asWorker('runner-a', c => c.query('SELECT id FROM app.claim_scheduled_action($1)', [60])),
      db.asWorker('runner-b', c => c.query('SELECT id FROM app.claim_scheduled_action($1)', [60])),
    ])
    expect(a!.rows.length + b!.rows.length).toBe(1)
  })
})

describe('operational visibility', () => {
  it('reports queue depth, retries, dead letters, and worker liveness in one call', async () => {
    const health = await queueHealth(db.pool('worker'))
    for (const key of [
      'outbox_waiting',
      'outbox_running',
      'outbox_retrying',
      'outbox_dead',
      'schedules_waiting',
      'schedules_running',
      'schedules_retrying',
      'schedules_failed',
      'live_workers',
      'stale_workers',
    ] as const) {
      expect(Number(health[key]), key).not.toBeNaN()
    }
    expect(Number(health.schedules_failed)).toBeGreaterThan(0)
    expect(health.last_heartbeat_at).not.toBeNull()
  })

  it('counts a worker whose heartbeat has gone quiet as stale, not live', async () => {
    await db.asWorker('quiet', c => heartbeat(c, 'worker', 'dev'))
    await db.as('owner', c =>
      c.query("UPDATE job_heartbeats SET last_seen_at = now() - interval '5 minutes' WHERE worker_id = 'quiet'"),
    )
    const health = await queueHealth(db.pool('worker'))
    expect(Number(health.stale_workers)).toBeGreaterThan(0)
  })

  it('surfaces the age of the oldest waiting event so a stalled queue is visible', async () => {
    await db.as('owner', c =>
      c.query(
        `INSERT INTO outbox (site_id, event_type, payload, created_at, next_attempt_at)
               VALUES ($1,'page.published','{"path":"/old"}', now() - interval '10 minutes', now() - interval '10 minutes')`,
        [s.siteA],
      ),
    )
    const health = await queueHealth(db.pool('worker'))
    expect(Number(health.outbox_oldest_waiting_seconds)).toBeGreaterThan(300)
  })

  it('is readable by the product, so an operator learns from the app', async () => {
    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ outbox_dead: string }>('SELECT outbox_dead FROM app.job_queue_health()'),
    )
    expect(rows).toHaveLength(1)
  })
})

it('delivers a reviewed-file publication with the owned routes captured in its transaction', async () => {
  const inserted = await db.as(
    'owner',
    async c =>
      (
        await c.query(
          "INSERT INTO outbox(site_id,event_type,payload) VALUES($1,'site.files.published',$2) RETURNING id,payload",
          [s.siteA, JSON.stringify({ version_id: s.pageA })],
        )
      ).rows[0]!,
  )
  expect(inserted.payload.paths).toContain('/')
  expect(Number.isSafeInteger(inserted.payload.revision)).toBe(true)
  const cache = createRecordingCacheInvalidator(),
    result = await drainOutbox(db.pool('worker'), 'site-file-publications', defaultHandlers(cache))
  expect(result.dead).toBe(0)
  expect(cache.calls).toContainEqual({
    siteId: s.siteA,
    revision: inserted.payload.revision,
    paths: inserted.payload.paths,
  })
  expect(
    (await db.as('owner', c => c.query('SELECT status FROM outbox WHERE id=$1', [inserted.id]))).rows[0]!.status,
  ).toBe('delivered')
})
