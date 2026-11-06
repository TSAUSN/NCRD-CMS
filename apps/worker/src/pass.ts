import { recordLocalChapterMail } from './chapter-mail.ts'
import type { Pool } from 'pg'
import type { WorkerConfig } from './config.ts'
import {
  drainOutbox,
  heartbeat,
  queueHealth,
  runDueSchedules,
  withWorkerSession,
  type EventHandler,
} from './handlers.ts'
import { requestDueDomainChecks } from './domains.ts'

export async function runWorkerPass(
  pool: Pool,
  config: WorkerConfig,
  handlers: Map<string, EventHandler>,
  options: {
    seconds?: number
    signal?: AbortSignal
    now?: () => number
  } = {},
) {
  const seconds = options.seconds ?? 35
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 120)
    throw new Error('Worker pass budget must be from 1 to 120 seconds')
  const now = options.now ?? Date.now
  const deadline = now() + seconds * 1_000
  const shouldContinue = () => !options.signal?.aborted && now() < deadline
  const beat = () =>
    withWorkerSession(pool, config.workerId, client => heartbeat(client, 'request-worker', config.version))
  await beat()
  await requestDueDomainChecks(pool, config.workerId)
  await recordLocalChapterMail(pool, config.workerId)
  // Recovery is idempotent: only missing thumbnails with no outstanding request.
  await withWorkerSession(pool, config.workerId, client =>
    client.query('SELECT app.request_missing_section_thumbnails()'),
  )
  // A busy image queue must not put timed publication behind all its thumbnails.
  const schedules = await runDueSchedules(pool, config.workerId, { leaseSeconds: config.leaseSeconds, shouldContinue })
  const outbox = { claimed: 0, delivered: 0, retrying: 0, dead: 0, lost: 0 }
  while (shouldContinue()) {
    const batch = await drainOutbox(pool, config.workerId, handlers, {
      limit: config.batchSize,
      leaseSeconds: config.leaseSeconds,
      shouldContinue,
    })
    for (const key of Object.keys(outbox) as (keyof typeof outbox)[]) outbox[key] += batch[key]
    if (batch.claimed < config.batchSize) break
  }
  // Always finish/settle the current item. Deadline/abort stops new claims,
  // leaving untouched work pending rather than stranded under a lease.
  await beat()
  return { outbox, schedules, health: await queueHealth(pool) }
}
