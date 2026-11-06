// Lease safety under slow delivery, and honest queue metrics.
//
// drainOutbox used to lease a whole batch and then work through it
// sequentially. With slow handlers the lease on later rows expired before their
// turn came, a second worker reclaimed them, and at-least-once quietly became
// concurrently-twice. The design chosen instead — claim one immediately before
// processing it — is asserted here with a lease deliberately shorter than the
// time a full batch would take.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { drainOutbox, queueHealth, type EventHandler } from '../src/handlers.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('lease')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.as('owner', c => c.query('DELETE FROM outbox'))
})

async function enqueue(path: string): Promise<string> {
  return db.as(
    'owner',
    async c =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO outbox (site_id, event_type, payload)
       VALUES ($1,'page.published',$2) RETURNING id`,
          [s.siteA, { path, revision: 1 }],
        )
      ).rows[0]!.id,
  )
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Claim one event as a worker and keep the lease token it minted. */
async function claim(worker = 'w1', leaseSeconds = 60) {
  return db.asWorker(
    worker,
    async c =>
      (
        await c.query<{ id: string; lease_token: string }>('SELECT id, lease_token FROM app.claim_outbox($1)', [
          leaseSeconds,
        ])
      ).rows[0] ?? null,
  )
}

/** A handler slow enough that a batch of these would outlive a short lease. */
function slowHandler(ms: number, seen: string[]): EventHandler {
  return {
    idempotency: 'natural',
    async handle(event) {
      seen.push(`${event.id}`)
      await sleep(ms)
    },
  }
}

describe('a lease never has to outlive the work it covers', () => {
  it('two workers with a short lease still deliver each event exactly once', async () => {
    // Six events, ~120ms each: a batch would take ~720ms against a 1s lease,
    // and the tail of that batch would be reclaimable before it was reached.
    const ids = await Promise.all(['/a', '/b', '/c', '/d', '/e', '/f'].map(enqueue))
    const seenByA: string[] = []
    const seenByB: string[] = []

    const [a, b] = await Promise.all([
      drainOutbox(db.pool('worker'), 'slow-a', new Map([['page.published', slowHandler(120, seenByA)]]), {
        leaseSeconds: 1,
        limit: 10,
      }),
      drainOutbox(db.pool('worker'), 'slow-b', new Map([['page.published', slowHandler(120, seenByB)]]), {
        leaseSeconds: 1,
        limit: 10,
      }),
    ])

    // Between them they delivered every event...
    expect(a.delivered + b.delivered).toBe(ids.length)
    // ...and no event was handled by both, which is what a batch lease could
    // not guarantee once processing outran the lease.
    const everything = [...seenByA, ...seenByB]
    expect(new Set(everything).size).toBe(everything.length)

    const remaining = await db.as('owner', c => c.query("SELECT id FROM outbox WHERE status <> 'delivered'"))
    expect(remaining.rows).toHaveLength(0)
  })

  it('an event is claimed only when it is about to be worked on', async () => {
    await Promise.all(['/x', '/y', '/z'].map(enqueue))
    const seen: string[] = []
    let observedRunning = -1

    const watcher: EventHandler = {
      idempotency: 'natural',
      async handle(event) {
        seen.push(event.id)
        // While the first event is in flight, how many rows are leased?
        const { rows } = await db.as('owner', c =>
          c.query<{ n: string }>("SELECT count(*) AS n FROM outbox WHERE status = 'running'"),
        )
        observedRunning = Math.max(observedRunning, Number(rows[0]!.n))
      },
    }

    await drainOutbox(db.pool('worker'), 'w1', new Map([['page.published', watcher]]), { limit: 10 })
    expect(seen).toHaveLength(3)
    // Exactly one row leased at a time. Under the old batch claim this was 3.
    expect(observedRunning).toBe(1)
  })

  it('a settlement failure does not abandon the rest of the queue', async () => {
    await Promise.all(['/one', '/two', '/three'].map(enqueue))
    const handled: string[] = []

    const stealingHandler: EventHandler = {
      idempotency: 'natural',
      async handle(event) {
        handled.push(event.id)
        // Simulate losing the lease mid-delivery: another worker reclaims it and
        // the token this worker holds stops being the current one, so its
        // settlement is refused. Rotating the stored digest is exactly what a
        // re-claim does — leased_by is only a label now (migration 0009), and
        // only the digest is ever stored (migration 0010).
        if (handled.length === 1) {
          await db.as('owner', c =>
            c.query('UPDATE outbox SET lease_token_hash = app.lease_digest(gen_random_uuid()) WHERE id = $1', [
              event.id,
            ]),
          )
        }
      },
    }

    const result = await drainOutbox(db.pool('worker'), 'w1', new Map([['page.published', stealingHandler]]), {
      limit: 10,
    })

    // The lost row did not unwind the pass: the other two were still delivered,
    // and the loss is counted rather than silently swallowed.
    expect(handled).toHaveLength(3)
    expect(result.delivered).toBe(2)
    expect(result.lost).toBe(1)
    expect(result.claimed).toBe(3)
  })
})

describe('a pass never re-claims what it already delivered', () => {
  it('excludes it at the claim, rather than leasing it and dropping it', async () => {
    // Two events. While the first is in flight its lease lapses, so it becomes
    // claimable again immediately — and it sorts first, so the very next claim
    // would hand it straight back.
    // Commit the first row before the second: concurrent inserts do not promise
    // which event sorts first on a different PostgreSQL host.
    const first = await enqueue('/lapses')
    const second = await enqueue('/second')
    const handled: string[] = []

    const expiring: EventHandler = {
      idempotency: 'natural',
      async handle(event) {
        handled.push(event.id)
        if (event.id === first) {
          await db.as('owner', c =>
            c.query("UPDATE outbox SET leased_until = now() - interval '1 second' WHERE id = $1", [event.id]),
          )
        }
      },
    }

    const result = await drainOutbox(db.pool('worker'), 'w1', new Map([['page.published', expiring]]), { limit: 10 })

    // Delivered once each, and the second event was still reached.
    expect(handled).toEqual([first, second])
    expect(new Set(handled).size).toBe(2)
    expect(result.delivered).toBe(1)
    expect(result.lost).toBe(1)

    const row = await db.as('owner', c =>
      c.query<{ attempts: number; status: string; expired: boolean }>(
        `SELECT attempts, status, leased_until < now() AS expired
           FROM outbox WHERE id = $1`,
        [first],
      ),
    )

    // Claimed exactly once by this pass. Under the previous handling the loop
    // re-claimed it — taking a second attempt and a fresh 60-second lease — and
    // then abandoned it on discovering it was a duplicate, so the row sat
    // leased to nobody until that lease ran out. It is instead left exactly as
    // the lapse left it: immediately available to whoever comes next.
    expect(row.rows[0]!.attempts).toBe(1)
    expect(row.rows[0]!.status).toBe('running')
    expect(row.rows[0]!.expired).toBe(true)
  })
})

describe('queue metrics say what a reader assumes they say', () => {
  it('a healthy first-attempt job is not reported as retrying', async () => {
    await enqueue('/first-attempt')
    // Claim it: attempts becomes 1 while nothing has gone wrong.
    await db.asWorker('w1', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))

    const health = await queueHealth(db.pool('worker'))
    // The old definition (attempts > 0) counted this as a retry, so the figure
    // was never zero while the queue was simply busy.
    expect(Number(health.outbox_retrying)).toBe(0)
    expect(Number(health.outbox_running)).toBe(1)
    expect(Number(health.outbox_waiting)).toBe(0)
  })

  it('counts a job as retrying only after it has actually failed', async () => {
    await enqueue('/will-fail')
    const held = (await claim())!
    await db.asWorker('w1', c =>
      c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [
        held.id,
        held.lease_token,
        false,
        'cache unavailable',
        false,
      ]),
    )

    const health = await queueHealth(db.pool('worker'))
    expect(Number(health.outbox_retrying)).toBe(1)
    // It is backing off: still retrying, but not due waiting work yet.
    expect(Number(health.outbox_running)).toBe(0)
    expect(Number(health.outbox_waiting)).toBe(0)
  })

  it('separates waiting from running', async () => {
    await Promise.all(['/w1', '/w2', '/w3'].map(enqueue))
    await db.asWorker('w1', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))

    const health = await queueHealth(db.pool('worker'))
    expect(Number(health.outbox_running)).toBe(1)
    expect(Number(health.outbox_waiting)).toBe(2)
    expect(Number(health.outbox_retrying)).toBe(0)
  })

  it('reports an abandoned row as stalled, not as running and not as nothing', async () => {
    const id = await enqueue('/abandoned')
    await claim()
    await db.as('owner', c =>
      c.query("UPDATE outbox SET leased_until = now() - interval '1 minute' WHERE id = $1", [id]),
    )

    const health = await queueHealth(db.pool('worker'))
    // Nobody is working on it, so it is not running...
    expect(Number(health.outbox_running)).toBe(0)
    // ...but it must not vanish either. Before migration 0009 a row claimed by
    // a worker that then died was in NO bucket at all, so a queue full of
    // stranded work read as completely empty on the dashboard.
    expect(Number(health.outbox_stalled)).toBe(1)
  })

  it('the three undelivered buckets are exhaustive', async () => {
    await db.as('owner', c => c.query('DELETE FROM outbox'))
    await Promise.all(['/p1', '/p2', '/p3'].map(enqueue))

    await claim() // one running
    // One stranded by a worker that died holding it.
    await db.as('owner', c =>
      c.query(`UPDATE outbox SET status = 'running',
                      lease_token_hash = app.lease_digest(gen_random_uuid()),
                      leased_until = now() - interval '1 minute'
                WHERE id = (SELECT min(id) FROM outbox WHERE status = 'pending')`),
    )

    const health = await queueHealth(db.pool('worker'))
    const undelivered = await db.as('owner', async c =>
      Number(
        (await c.query<{ n: string }>(`SELECT count(*) AS n FROM outbox WHERE status IN ('pending','running')`))
          .rows[0]!.n,
      ),
    )

    // Every undelivered row lands in exactly one bucket. The point is that none
    // can fall between them and disappear from the dashboard.
    expect(Number(health.outbox_waiting) + Number(health.outbox_running) + Number(health.outbox_stalled)).toBe(
      undelivered,
    )
    expect(Number(health.outbox_stalled)).toBe(1)
    expect(Number(health.outbox_running)).toBe(1)
    expect(Number(health.outbox_waiting)).toBe(1)
  })

  it('a dead letter leaves the waiting, running, and retrying buckets', async () => {
    await enqueue('/doomed')
    const held = (await claim())!
    await db.asWorker('w1', c =>
      c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [held.id, held.lease_token, false, 'gave up', true]),
    )

    const health = await queueHealth(db.pool('worker'))
    expect(Number(health.outbox_dead)).toBe(1)
    expect(Number(health.outbox_waiting)).toBe(0)
    expect(Number(health.outbox_running)).toBe(0)
    expect(Number(health.outbox_retrying)).toBe(0)
  })
})
