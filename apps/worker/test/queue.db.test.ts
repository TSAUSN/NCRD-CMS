// The job transport's hard guarantees (ADR 0003), each against real Postgres
// as the real worker role. These are the properties that make a hand-built
// queue defensible instead of a liability, so none of them is inferred from a
// unit test with a fake client.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createRecordingCacheInvalidator } from '@cms/platform'
import {
  PermanentJobError,
  defaultHandlers,
  drainOutbox,
  isPermanentFailure,
  queueHealth,
  type EventHandler,
} from '../src/handlers.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('queue')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

/** Put an event on the queue without going through a publish. */
async function enqueue(eventType: string, payload: Record<string, unknown>, maxAttempts?: number): Promise<string> {
  return db.as('owner', async c => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO outbox (site_id, event_type, payload${maxAttempts ? ', max_attempts' : ''})
       VALUES ($1,$2,$3${maxAttempts ? ',$4' : ''}) RETURNING id`,
      maxAttempts ? [s.siteA, eventType, payload, maxAttempts] : [s.siteA, eventType, payload],
    )
    return rows[0]!.id
  })
}

async function row(id: string) {
  return db.as(
    'owner',
    async c =>
      (
        await c.query<{
          status: string
          attempts: number
          next_attempt_at: Date
          leased_by: string | null
          leased_until: Date | null
          last_error: string | null
          failed_at: Date | null
        }>(
          'SELECT status, attempts, next_attempt_at, leased_by, leased_until, last_error, failed_at FROM outbox WHERE id = $1',
          [id],
        )
      ).rows[0]!,
  )
}

async function clearQueue(): Promise<void> {
  await db.as('owner', c => c.query('DELETE FROM outbox'))
}

describe('claiming is exclusive', () => {
  it('two concurrent workers never receive the same row', async () => {
    await clearQueue()
    const ids = await Promise.all(
      Array.from({ length: 20 }, (_, i) => enqueue('page.published', { path: `/p${i}`, revision: 1 })),
    )

    // Claims are one-at-a-time now (a lease must never outlive the work it
    // covers), so two workers race through the queue rather than splitting it
    // into two batches. The invariant is the same: no row twice.
    const claimOne = (worker: string) =>
      db.asWorker(
        worker,
        async c => (await c.query<{ id: string }>('SELECT id FROM app.claim_outbox($1)', [60])).rows[0]?.id ?? null,
      )

    const claimed: string[] = []
    for (let round = 0; round < ids.length; round += 1) {
      const [a, b] = await Promise.all([claimOne('w-a'), claimOne('w-b')])
      for (const id of [a, b]) if (id) claimed.push(id)
      if (!a && !b) break
    }

    expect(claimed.length).toBe(ids.length)
    expect(new Set(claimed).size).toBe(claimed.length) // no row claimed twice
  })

  it('an active lease cannot be stolen by another worker', async () => {
    await clearQueue()
    const id = await enqueue('page.published', { path: '/held', revision: 1 })
    await db.asWorker('holder', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))

    const thief = await db.asWorker('thief', c => c.query('SELECT id FROM app.claim_outbox($1)', [60]))
    expect(thief.rows).toHaveLength(0)
    expect((await row(id)).leased_by).toBe('holder')
  })

  it('an expired lease can be reclaimed — a crashed worker does not strand work', async () => {
    await clearQueue()
    const id = await enqueue('page.published', { path: '/stranded', revision: 1 })
    // A worker that claimed and then died: lease taken, never settled.
    await db.asWorker('dead-worker', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))
    await db.as('owner', c =>
      c.query("UPDATE outbox SET leased_until = now() - interval '1 second' WHERE id = $1", [id]),
    )

    const rescuer = await db.asWorker('rescuer', c =>
      c.query<{ id: string }>('SELECT id FROM app.claim_outbox($1)', [60]),
    )
    expect(rescuer.rows.map(r => r.id)).toEqual([id])
    expect((await row(id)).attempts).toBe(2)
  })

  it('refuses a claim from a session with no worker identity', async () => {
    // The worker id is no longer an argument at all — it comes from the session
    // GUC, so a connection that never identified itself simply cannot claim.
    await expectSqlState(
      db.as('worker', c => c.query('SELECT * FROM app.claim_outbox($1)', [60])),
      'CMS02',
    )
  })

  it('refuses a settlement without the lease token', async () => {
    await clearQueue()
    const id = await enqueue('page.published', { path: '/mine', revision: 1 })
    await db.asWorker('holder', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))
    await expectSqlState(
      db.asWorker('other', c =>
        c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [
          id,
          '00000000-0000-0000-0000-000000000000',
          true,
          null,
          false,
        ]),
      ),
      'CMS04',
    )
  })
})

describe('failures back off instead of spinning', () => {
  it('pushes next_attempt_at into the future rather than re-offering immediately', async () => {
    await clearQueue()
    const id = await enqueue('page.published', { path: '/flaky', revision: 1 })

    const cache = createRecordingCacheInvalidator()
    cache.failNext(1)
    const first = await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(cache))
    expect(first.retrying).toBe(1)

    const after = await row(id)
    expect(after.status).toBe('pending')
    expect(after.attempts).toBe(1)
    expect(after.next_attempt_at.getTime()).toBeGreaterThan(Date.now())
    expect(after.last_error).toMatch(/unavailable/)

    // The immediate next pass must not pick it back up.
    const second = await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(cache))
    expect(second.claimed).toBe(0)
  })

  it('grows the delay as attempts accumulate', async () => {
    const delays = await db.as(
      'owner',
      async c =>
        (
          await c.query<{ one: string; five: string }>(
            `SELECT EXTRACT(epoch FROM app.retry_delay(1)) AS one,
                EXTRACT(epoch FROM app.retry_delay(5)) AS five`,
          )
        ).rows[0]!,
    )
    expect(Number(delays.five)).toBeGreaterThan(Number(delays.one))
  })

  it('caps the delay so a long-failing row still retries eventually', async () => {
    const capped = await db.as('owner', async c =>
      Number((await c.query<{ s: string }>('SELECT EXTRACT(epoch FROM app.retry_delay(50)) AS s')).rows[0]!.s),
    )
    expect(capped).toBeLessThanOrEqual(600)
  })

  it('jitters, so simultaneous failures do not retry in lockstep', async () => {
    const samples = await db.as('owner', async c =>
      (
        await c.query<{ s: string }>('SELECT EXTRACT(epoch FROM app.retry_delay(6)) AS s FROM generate_series(1,25)')
      ).rows.map(r => Number(r.s)),
    )
    expect(new Set(samples).size).toBeGreaterThan(1)
  })
})

describe('poison events do not starve the queue', () => {
  it('lets later events through while a failing event is backed off', async () => {
    await clearQueue()
    // The poison arrives first, so without backoff it would head every batch.
    const poison = await enqueue('page.published', { revision: 1 }) // no path: permanently bad
    const good = await enqueue('page.published', { path: '/fine', revision: 1 })

    const cache = createRecordingCacheInvalidator()
    const result = await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(cache))

    expect(result.dead).toBe(1)
    expect(result.delivered).toBe(1)
    expect((await row(poison)).status).toBe('dead')
    expect((await row(good)).status).toBe('delivered')
    expect(cache.calls.some(call => call.paths.includes('/fine'))).toBe(true)
  })

  it('dead-letters an event type nobody handles instead of retrying forever', async () => {
    await clearQueue()
    const id = await enqueue('some.future.event', { path: '/x' })
    const result = await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(createRecordingCacheInvalidator()))

    expect(result.dead).toBe(1)
    const after = await row(id)
    expect(after.status).toBe('dead')
    expect(after.last_error).toMatch(/no handler for event type some\.future\.event/)
    expect(after.failed_at).not.toBeNull()
  })

  it('a dead event leaves the ready set entirely', async () => {
    const claimed = await db.asWorker('w1', c => c.query('SELECT id FROM app.claim_outbox($1)', [60]))
    expect(claimed.rows).toHaveLength(0)
  })
})

describe('max attempts produces a visible terminal result', () => {
  it('gives up after max_attempts and records why', async () => {
    await clearQueue()
    const id = await enqueue('page.published', { path: '/doomed', revision: 1 }, 3)

    const cache = createRecordingCacheInvalidator()
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      cache.failNext(1)
      // Backoff would otherwise make the next pass claim nothing.
      await db.as('owner', c => c.query('UPDATE outbox SET next_attempt_at = now() WHERE id = $1', [id]))
      await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(cache))
    }

    const after = await row(id)
    expect(after.status).toBe('dead')
    expect(after.attempts).toBe(3)
    expect(after.failed_at).not.toBeNull()
    expect(after.last_error).toMatch(/unavailable/)
  })

  it('counts the dead letter in queue health', async () => {
    const health = await queueHealth(db.pool('worker'))
    expect(Number(health.outbox_dead)).toBeGreaterThan(0)
  })
})

describe('crash safety', () => {
  it('redelivers work that completed externally but was never settled', async () => {
    await clearQueue()
    const id = await enqueue('page.published', { path: '/crashed', revision: 1 })
    const cache = createRecordingCacheInvalidator()

    // A worker that invalidated the cache and died before settling.
    const crashing: EventHandler = {
      idempotency: 'natural',
      async handle(event) {
        await cache.invalidate({ siteId: s.siteA, paths: [String(event.payload['path'])], revision: 1 })
        throw new Error('process died after the external call')
      },
    }
    await drainOutbox(db.pool('worker'), 'crash-worker', new Map([['page.published', crashing]]))

    expect(cache.calls).toHaveLength(1)
    await db.as('owner', c =>
      c.query("UPDATE outbox SET next_attempt_at = now(), leased_until = now() - interval '1s' WHERE id = $1", [id]),
    )

    // The retry does the same naturally-idempotent thing again and settles.
    const recovered = await drainOutbox(db.pool('worker'), 'w2', defaultHandlers(cache))
    expect(recovered.delivered).toBe(1)
    expect(cache.calls).toHaveLength(2) // at-least-once, and harmless because natural
    expect((await row(id)).status).toBe('delivered')
  })
})

describe('failure classification', () => {
  it.each([
    ['CMS01', 'a moved revision'],
    ['CMS02', 'lost authorization'],
    ['CMS03', 'deleted content'],
    ['CMS04', 'an invalid state'],
    ['CMS05', 'unapproved raw markup'],
    ['42501', 'a grant or policy refusal'],
  ])('treats %s (%s) as permanent', code => {
    expect(isPermanentFailure({ code })).toBe(true)
  })

  it.each([
    ['08006', 'a dropped connection'],
    ['40001', 'a serialization failure'],
    ['40P01', 'a deadlock'],
    ['57014', 'a statement timeout'],
  ])('treats %s (%s) as retryable', code => {
    expect(isPermanentFailure({ code })).toBe(false)
  })

  it('treats an explicit PermanentJobError as permanent', () => {
    expect(isPermanentFailure(new PermanentJobError('never going to work'))).toBe(true)
  })

  it('treats a bare infrastructure error as retryable', () => {
    expect(isPermanentFailure(new Error('ECONNRESET'))).toBe(false)
  })
})

describe('handlers declare how they are idempotent', () => {
  it('every registered handler carries a declaration', () => {
    for (const [type, handler] of defaultHandlers(createRecordingCacheInvalidator())) {
      expect(['natural', 'guarded'], `handler for ${type}`).toContain(handler.idempotency)
    }
  })
})

describe('publishing still reaches the queue end to end', () => {
  it('a publish enqueues an event that a drain delivers', async () => {
    await clearQueue()
    const revision = async () =>
      Number(
        (
          await db.asUser(s.editorA, c =>
            c.query<{ revision: string }>('SELECT revision FROM pages WHERE id=$1', [s.pageA]),
          )
        ).rows[0]!.revision,
      )

    const beforeSave = await revision()
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, beforeSave, heroContent(s.heroDefId), '{}']),
    )
    const beforePublish = await revision()
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, beforePublish, ...CHECKED_CLEAN]),
    )

    const cache = createRecordingCacheInvalidator()
    const result = await drainOutbox(db.pool('worker'), 'w1', defaultHandlers(cache))
    expect(result.delivered).toBe(2)
    expect(cache.calls).toHaveLength(2)
    expect(cache.calls.every(call => call.siteId === s.siteA)).toBe(true)
    expect(cache.calls.some(call => call.paths.includes('/'))).toBe(true)
  })
})
