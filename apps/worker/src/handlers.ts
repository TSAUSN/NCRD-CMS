// One implementation of job execution (ADR 0003). The long-running worker and
// the one-shot `jobs:drain` command both call these functions; the only
// difference between the two roles is who decides when to call them.
//
// The shape every handler here follows is claim → process → settle, in **three
// separate short transactions**. The middle step does external I/O, and holding
// a database transaction open across a network call means one slow CDN pins a
// Postgres connection and its locks for as long as the timeout allows.
//
// Delivery is therefore at-least-once, and a crash between the external action
// and settlement leaves the lease to expire and the row to be retried. Every
// handler must be idempotent (see IDEMPOTENCY below).
import type { Pool, PoolClient } from 'pg'
import { executeReleaseSchedule } from './release-schedules.ts'
import { evaluateVersionReadiness, type CacheInvalidator } from '@cms/platform'
import { READINESS_POLICY_VERSION } from '@cms/domain'
import { SECTION_THUMBNAIL_EVENT, unconfiguredThumbnailHandler } from './thumbnails.ts'
import {
  MEDIA_DELETED_EVENT,
  MEDIA_PROCESS_EVENT,
  MEDIA_READY_EVENT,
  MEDIA_RESTORED_EVENT,
  mediaStateChangedHandler,
  unconfiguredMediaHandler,
} from './media.ts'
import { MEDIA_CLEANUP_EVENT, unconfiguredMediaCleanupHandler } from './media-cleanup.ts'
import { unconfiguredInvitationHandler } from './invitations.ts'

// ---------------------------------------------------------------- contracts

/**
 * IDEMPOTENCY CONVENTION
 *
 * At-least-once delivery means every handler will eventually run twice for the
 * same event. A handler satisfies this contract in one of two ways:
 *
 *   `natural`  — repeating it changes nothing. Cache invalidation is naturally
 *                idempotent: purging an already-purged key is a no-op.
 *   `guarded`  — repeating it would be visible, so the handler checks a durable
 *                marker first. An email send, a provider API call that creates
 *                something, or a counter increment must be `guarded`.
 *
 * Publication is NOT in the first category, and an earlier version of this
 * comment claimed it was. Publishing advances the head revision, appends an
 * audit row, and emits an outbox event, so doing it twice is plainly visible.
 * That is why a scheduled publish executes and settles in a single transaction
 * (app.execute_scheduled_action) rather than relying on repetition being
 * harmless — the outbox handlers below are the naturally idempotent part, and
 * they only invalidate caches.
 *
 * A handler must declare which it is. A new event type with no declaration is
 * treated as unhandled and dead-lettered rather than delivered on a guess.
 */
export type Idempotency = 'natural' | 'guarded'

export type OutboxEvent = {
  id: string
  site_id: string | null
  event_type: string
  payload: Record<string, unknown>
  attempts: number
  /**
   * The capability that authorizes settling this row. Minted by the claim and
   * returned only to the claimant, so a worker cannot settle work it did not
   * win — an identity a session asserts about itself authorizes nothing when
   * every worker shares one database role (migration 0009).
   */
  lease_token: string
}

export type EventHandler = {
  idempotency: Idempotency
  handle(event: OutboxEvent): Promise<void>
}

type Settlement = { ok: boolean; permanent: boolean; error: string | null }

export type DrainResult = {
  claimed: number
  delivered: number
  retrying: number
  dead: number
  /** Delivered, but the lease was gone before it could be settled. */
  lost: number
}

// A failure the handler knows cannot succeed on a retry.
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentJobError'
  }
}

/**
 * Domain refusals are permanent by definition: CMS01 (the revision moved),
 * CMS02 (the actor lost the capability), CMS03 (the content is gone), CMS04
 * (invalid state), CMS05 (raw markup is unapproved), 42501 (a grant or policy
 * refused it). None of those become true by waiting.
 *
 * Everything else — connection resets, deadlocks, timeouts, disk pressure — is
 * infrastructure and is worth another bounded attempt.
 */
const PERMANENT_SQLSTATES = new Set(['CMS01', 'CMS02', 'CMS03', 'CMS04', 'CMS05', '42501', '23514', '23505'])

export function isPermanentFailure(error: unknown): boolean {
  if (error instanceof PermanentJobError) return true
  const code = (error as { code?: string })?.code
  const kind = (error as { kind?: string })?.kind
  if (code && PERMANENT_SQLSTATES.has(code)) return true
  // DomainError from @cms/domain carries `kind` rather than a SQLSTATE.
  return kind !== undefined && kind !== 'infrastructure'
}

// ------------------------------------------------------------------ outbox

function cacheInvalidationHandler(cache: CacheInvalidator): EventHandler {
  return {
    // Purging a key that is already absent is a no-op, so a duplicate delivery
    // costs one wasted call and changes nothing.
    idempotency: 'natural',
    async handle(event) {
      const siteId = event.site_id
      if (!siteId) throw new PermanentJobError('cache invalidation needs a site')
      const path = event.payload['path']
      const listed = event.payload['paths']
      const paths =
        typeof path === 'string'
          ? [path]
          : Array.isArray(listed) && listed.every(candidate => typeof candidate === 'string')
            ? (listed as string[])
            : null
      if (paths === null) throw new PermanentJobError(`event ${event.id} has no path to invalidate`)
      await cache.invalidate({ siteId, paths, revision: Number(event.payload['revision'] ?? 0) })
    },
  }
}

/**
 * The event types this process knows how to deliver.
 *
 * The thumbnail handler is a parameter rather than something built here because
 * building one needs a browser launcher and a media store, and the two roles
 * that call this function do not have the same access to either: the
 * long-running worker owns a Chromium, and `jobs:drain` is meant to run anywhere.
 * Absent, the event type is still registered — with a handler that refuses
 * retryably rather than a gap, because an unregistered type is dead-lettered on
 * sight and that would make a drain run the thing that destroys the thumbnail
 * work of every definition saved since the last one (SPEC §6.5).
 */
export function defaultHandlers(
  cache: CacheInvalidator,
  thumbnails?: EventHandler,
  media?: EventHandler,
  mediaCleanup?: EventHandler,
  invitations?: EventHandler,
  domains?: EventHandler,
  hosting?: EventHandler,
): Map<string, EventHandler> {
  const invalidate = cacheInvalidationHandler(cache)
  const mediaState = mediaStateChangedHandler(cache)
  return new Map<string, EventHandler>([
    [
      'site.hosting_requested',
      hosting ?? {
        idempotency: 'guarded',
        async handle() {
          throw new Error('Managed site hosting is not configured')
        },
      },
    ],
    ['user.invited', invitations ?? unconfiguredInvitationHandler()],
    [
      'domain.sync',
      domains ?? {
        idempotency: 'guarded',
        async handle() {
          throw new Error('Domain provider is not configured on this worker')
        },
      },
    ],
    ['page.published', invalidate],
    ['page.unpublished', invalidate],
    ['site_shell.published', invalidate],
    ['site.files.published', invalidate],
    // Migration 0048 puts the exact dependent route paths into these
    // transactional events. Reusing the page invalidator keeps delivery
    // naturally idempotent and avoids querying mutable collection state here.
    ['collection.schema.published', invalidate],
    ['collection.entries.published', invalidate],
    [SECTION_THUMBNAIL_EVENT, thumbnails ?? unconfiguredThumbnailHandler()],
    [MEDIA_PROCESS_EVENT, media ?? unconfiguredMediaHandler()],
    [MEDIA_READY_EVENT, mediaState],
    [MEDIA_DELETED_EVENT, mediaState],
    [MEDIA_RESTORED_EVENT, mediaState],
    [MEDIA_CLEANUP_EVENT, mediaCleanup ?? unconfiguredMediaCleanupHandler()],
  ])
}

/**
 * Claim ONE event, immediately before processing it. Short transaction:
 * nothing external happens inside it.
 *
 * This used to claim a whole batch and then work through it sequentially, which
 * meant the lease on the last row of a 50-row batch had to survive 49 slow
 * deliveries before its turn came. It often did not, another worker reclaimed
 * it, and at-least-once quietly became concurrently-twice. Claiming one at a
 * time costs a round trip per event and makes a lease impossible to outlive.
 */
async function claimOneOutboxEvent(
  pool: Pool,
  workerId: string,
  leaseSeconds: number,
  exclude: Iterable<string>,
): Promise<OutboxEvent | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1,$2,true)', ['app.worker_id', workerId])
    const { rows } = await client.query<OutboxEvent>('SELECT * FROM app.claim_outbox($1, $2::bigint[])', [
      leaseSeconds,
      [...exclude],
    ])
    await client.query('COMMIT')
    return rows[0] ?? null
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Settle one event. Short transaction, and it fails loudly if the lease moved.
 *
 * Authorization is the lease token minted by the claim — not the worker's name,
 * which every worker can set for itself. Only a digest of the token is stored,
 * so a worker cannot read another's out of the table either (migration 0010).
 */
async function settleOutbox(pool: Pool, workerId: string, event: OutboxEvent, outcome: Settlement): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1,$2,true)', ['app.worker_id', workerId])
    const { rows } = await client.query<{ status: string }>('SELECT app.settle_outbox($1,$2,$3,$4,$5) AS status', [
      event.id,
      event.lease_token,
      outcome.ok,
      outcome.error,
      outcome.permanent,
    ])
    await client.query('COMMIT')
    return rows[0]!.status
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Consume the transactional outbox. A downstream failure backs the row off and
 * leaves it for a later pass; it never rolls back the publication that produced
 * it (SPEC §6.8).
 */
export async function drainOutbox(
  pool: Pool,
  workerId: string,
  handlers: Map<string, EventHandler>,
  options: {
    limit?: number
    leaseSeconds?: number
    shouldContinue?: () => boolean
    onLostLease?: (event: OutboxEvent, error: Error) => void
  } = {},
): Promise<DrainResult> {
  const onLostLease = options.onLostLease
  const leaseSeconds = options.leaseSeconds ?? 60
  const max = options.limit ?? 50
  const result: DrainResult = { claimed: 0, delivered: 0, retrying: 0, dead: 0, lost: 0 }
  // A row whose lease lapsed mid-delivery becomes claimable again immediately,
  // and without this the same pass would re-claim and re-deliver it. Claiming
  // one at a time removed concurrent duplication; this removes sequential
  // duplication by the same loop.
  //
  // The exclusion is applied by the claim itself rather than after the fact.
  // Detecting the duplicate here would mean the row had already been leased to
  // us — and then dropped, stranded under a lease nobody was working, until it
  // expired. Never handing it out has no such window (migration 0010).
  const seen = new Set<string>()

  for (let i = 0; i < max; i += 1) {
    if (options.shouldContinue && !options.shouldContinue()) break
    // Claimed one at a time, immediately before it is worked on.
    const event = await claimOneOutboxEvent(pool, workerId, leaseSeconds, seen)
    if (!event) break
    seen.add(event.id)
    result.claimed += 1

    let outcome: Settlement
    const handler = handlers.get(event.event_type)

    if (!handler) {
      // An event type nobody handles will never be handled by waiting. Dead-letter
      // it immediately so it stops occupying the ready set.
      outcome = { ok: false, permanent: true, error: `no handler for event type ${event.event_type}` }
    } else {
      try {
        // Deliberately outside any transaction of ours.
        await handler.handle(event)
        outcome = { ok: true, permanent: false, error: null }
      } catch (error) {
        outcome = {
          ok: false,
          permanent: isPermanentFailure(error),
          error: (error as Error).message,
        }
      }
    }

    // If the process dies here — after the external action, before settlement —
    // the lease expires and the event is redelivered. That is exactly why the
    // idempotency contract above is a requirement and not advice.
    //
    // A settlement that itself fails must not abandon the rest of the queue:
    // this row's lease will lapse and it will be retried, and the loop carries
    // on with the next event rather than unwinding the whole pass.
    try {
      const status = await settleOutbox(pool, workerId, event, outcome)
      if (status === 'delivered') result.delivered += 1
      else if (status === 'dead') result.dead += 1
      else result.retrying += 1
    } catch (error) {
      // The lease was lost or expired before the settlement landed. The row
      // will be retried by whoever holds it now; what matters is that this pass
      // continues and that the loss is counted rather than silently swallowed.
      result.lost += 1
      onLostLease?.(event, error as Error)
    }
  }

  return result
}

// ------------------------------------------------------- scheduled actions

export type ScheduleRow = {
  id: string
  site_id: string
  item_type: string
  item_id: string
  version_id: string
  action: 'publish' | 'unpublish'
  created_by: string
  attempt_count: number
  max_attempts: number
  /** The policy this schedule was created under, pinned then (SPEC §6.8). */
  readiness_policy_version: number
  lease_token: string
}

/**
 * Execute due schedules.
 *
 * Each is leased in one transaction, then executed and settled together in a
 * second. That pairing is the point: publication is NOT idempotent — it
 * advances the head revision, appends audit, and inserts an outbox event — so
 * committing the publication and the "this schedule is done" mark separately
 * meant a crash between them republished on the next pass.
 * `app.execute_scheduled_action` does both or neither (migration 0008).
 *
 * The version published is the one the schedule pinned, not whatever the draft
 * pointer says at execution time, and every authorization question is re-asked
 * against the schedule's creator inside that transaction.
 *
 * Readiness is re-asked too. It used to be skipped entirely — the schedule sent
 * policy version 1 and an empty report and nothing ever ran the checks — so a
 * version the editor refused published fine on a timer. Now the same evaluation
 * the editor runs is applied to the pinned version, and a blocking finding ends
 * the schedule with a recorded reason instead of going live (SPEC §6.8).
 *
 * The worker is inside the trust boundary for that report — it holds a
 * credential that can publish — so the database validates the report's shape,
 * its pinned policy version, and the override rule, but cannot confirm the
 * findings were actually computed. That is why this calls the shared evaluator
 * rather than constructing a report of its own: being trusted is exactly the
 * reason not to improvise (threat model §7a).
 */
export async function runDueSchedules(
  pool: Pool,
  workerId: string,
  options: { leaseSeconds?: number; max?: number; shouldContinue?: () => boolean } = {},
): Promise<{ ran: number; retrying: number; failed: number; blocked: number; lost: number }> {
  const leaseSeconds = options.leaseSeconds ?? 60
  const summary = { ran: 0, retrying: 0, failed: 0, blocked: 0, lost: 0 }

  for (let i = 0; i < (options.max ?? 10); i += 1) {
    if (options.shouldContinue && !options.shouldContinue()) break
    const job = await claimSchedule(pool, workerId, leaseSeconds)
    if (!job) break

    try {
      // 'blocked' is not an error: the database refused the publication on
      // readiness grounds and recorded why, in the same transaction. Counting
      // it separately keeps "the queue is broken" distinct from "this page is
      // not ready", which are different problems for an operator.
      if ((await executeSchedule(pool, workerId, job)) === 'blocked') summary.blocked += 1
      else summary.ran += 1
    } catch (error) {
      const permanent = isPermanentFailure(error)
      try {
        const status = await failSchedule(pool, workerId, job, (error as Error).message, permanent)
        if (status === 'failed') summary.failed += 1
        else summary.retrying += 1
      } catch {
        // The lease moved on, or the execution actually committed and only its
        // acknowledgement was lost. Either way this pass must not abort — the
        // row's own terminal state is the truth.
        summary.lost += 1
      }
    }
  }

  return summary
}

async function claimSchedule(pool: Pool, workerId: string, leaseSeconds: number): Promise<ScheduleRow | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1,$2,true)', ['app.worker_id', workerId])
    const { rows } = await client.query<ScheduleRow>('SELECT * FROM app.claim_scheduled_action($1)', [leaseSeconds])
    await client.query('COMMIT')
    return rows[0] ?? null
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Evaluate readiness for the pinned version, then publish and settle in ONE
 * transaction. If the process dies before the COMMIT, nothing happened: no
 * publication, no audit, no outbox event, and the schedule is still claimable
 * once its lease lapses.
 *
 * Readiness runs first and outside that transaction on purpose. It is a read of
 * an immutable version plus a pure function — it cannot change what it is
 * judging — and rendering a page inside the publishing transaction would hold
 * the page's row lock for the duration of work that does not need it. The
 * atomicity that matters is publication-with-settlement, and that is untouched.
 */
async function executeSchedule(pool: Pool, workerId: string, job: ScheduleRow): Promise<string> {
  if (job.item_type === 'release') {
    await executeReleaseSchedule(job.id, job.lease_token)
    return 'published'
  }
  // Unpublishing is not gated on readiness: taking a page down cannot be
  // blocked by the quality of what it contained.
  const readiness =
    job.action === 'publish'
      ? await withWorkerSession(pool, workerId, client => evaluateVersionReadiness(client, job.version_id, 'worker'))
      : null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1,$2,true)', ['app.worker_id', workerId])
    const { rows } = await client.query<{ outcome: string }>(
      'SELECT outcome FROM app.execute_scheduled_action($1,$2,$3,$4)',
      [job.id, job.lease_token, READINESS_POLICY_VERSION, readiness ? JSON.stringify(readiness.findings) : null],
    )
    await client.query('COMMIT')
    return rows[0]!.outcome
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * One transaction carrying this worker's identity, which is what every `app.*`
 * function that calls `app.require_worker()` needs to see.
 *
 * Exported so sibling job modules use this one rather than each growing its own
 * BEGIN/set_config/COMMIT. Readiness uses it to read and writes nothing; the
 * thumbnail job uses it to read and then, separately, to record — deliberately
 * two short transactions with the screenshot between them, which is the same
 * claim → process → settle shape the header at the top of this file describes
 * and for the same reason: a browser is a network call, and holding a Postgres
 * transaction open across one pins a connection for as long as the timeout
 * allows.
 */
export async function withWorkerSession<T>(
  pool: Pool,
  workerId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1,$2,true)', ['app.worker_id', workerId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function failSchedule(
  pool: Pool,
  workerId: string,
  job: ScheduleRow,
  error: string,
  permanent: boolean,
): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1,$2,true)', ['app.worker_id', workerId])
    const { rows } = await client.query<{ status: string }>('SELECT app.fail_scheduled_action($1,$2,$3,$4) AS status', [
      job.id,
      job.lease_token,
      error,
      permanent,
    ])
    await client.query('COMMIT')
    return rows[0]!.status
  } catch (settleError) {
    await client.query('ROLLBACK').catch(() => {})
    throw settleError
  } finally {
    client.release()
  }
}

// ----------------------------------------------------------- heartbeat

/**
 * The worker id is not a parameter — it comes from the session GUC asWorker()
 * sets — but be precise about what that buys: the GUC is set by the same client
 * in the same round trip, and every worker authenticates as one database role,
 * so the id here is self-asserted. A worker that wants to write a heartbeat
 * under another name can.
 *
 * That is a misleading operator display, not an authorization bypass: no work
 * can be claimed, settled, or published through a heartbeat. Closing it needs a
 * distinct database login per worker, which is a deployment decision (threat
 * model §9a, V2-SETUP-07).
 */
export async function heartbeat(client: PoolClient, role: string, version: string): Promise<Date> {
  const { rows } = await client.query<{ at: Date }>('SELECT app.worker_heartbeat($1,$2) AS at', [role, version])
  return rows[0]!.at
}

export type QueueHealth = {
  /** Queued, nothing has picked it up yet. */
  outbox_waiting: string
  /** Being delivered right now by a worker holding an unexpired lease. */
  outbox_running: string
  /** Claimed and then abandoned — a worker died mid-delivery. */
  outbox_stalled: string
  /** Has failed at least once and has not given up. */
  outbox_retrying: string
  outbox_dead: string
  outbox_oldest_waiting_seconds: string | null
  schedules_waiting: string
  schedules_running: string
  schedules_stalled: string
  schedules_retrying: string
  schedules_failed: string
  schedules_overdue_seconds: string | null
  live_workers: string
  stale_workers: string
  last_heartbeat_at: Date | null
}

export async function queueHealth(pool: Pool): Promise<QueueHealth> {
  const client = await pool.connect()
  try {
    const { rows } = await client.query<QueueHealth>('SELECT * FROM app.job_queue_health()')
    return rows[0]!
  } finally {
    client.release()
  }
}
