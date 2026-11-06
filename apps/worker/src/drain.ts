import { recordLocalChapterMail } from './chapter-mail.ts'
import { reportQueueHealth } from './monitoring.ts'
import { createDomainHandler, requestDueDomainChecks } from './domains.ts'
// `jobs:drain` — one monitored pass, for hosts that cannot keep a process
// running. Identical handlers to `start:worker`; the exit code and the printed
// summary are what a cron monitor watches (ADR 0003).
import { asWorker, closePools, poolFor, configuredMonitor } from '@cms/platform'
import { createCacheInvalidator, createMediaStore, readConfig } from './config.ts'
import { defaultHandlers, drainOutbox, heartbeat, queueHealth, runDueSchedules } from './handlers.ts'
import { mediaCleanupHandler } from './media-cleanup.ts'
import { createPostgresMediaCleanupRepository } from './media-cleanup-repository.ts'
import { createInvitationHandler } from './invitations.ts'
import { mediaProcessingHandler } from './media.ts'
import { createPostgresMediaProcessingRepository } from './media-repository.ts'
import { createSiteHostingHandler } from './site-hosting.ts'

const config = readConfig()
const monitor = configuredMonitor()
const pool = poolFor('worker')
const media = createMediaStore(config)
const handlers = defaultHandlers(
  createCacheInvalidator(),
  undefined,
  mediaProcessingHandler({
    repository: createPostgresMediaProcessingRepository(pool, config.workerId),
    media,
    limits: {
      maxInputBytes: config.mediaMaxInputBytes,
      maxInputPixels: config.mediaMaxInputPixels,
      maxDimension: config.mediaMaxDimension,
    },
  }),
  mediaCleanupHandler({
    repository: createPostgresMediaCleanupRepository(pool, config.workerId),
    media,
  }),
  createInvitationHandler(pool, config.workerId),
  createDomainHandler(pool, config.workerId),
  createSiteHostingHandler(pool, config.workerId),
)

try {
  const at = await asWorker(config.workerId, client => heartbeat(client, 'drain', config.version))

  await requestDueDomainChecks(pool, config.workerId)
  await recordLocalChapterMail(pool, config.workerId)
  // A scheduled drain (the hosted pilot runs one every few minutes) empties the
  // queue rather than taking one batch of the oldest work: an editor's upload
  // must not wait behind several runs of thumbnails. It stops when a batch
  // comes back short or the time budget is spent, so a run always ends.
  const deadline = Date.now() + Number(process.env['WORKER_DRAIN_SECONDS'] ?? 50) * 1000
  const outbox = { claimed: 0, delivered: 0, retrying: 0, dead: 0, lost: 0 }
  for (;;) {
    const batch = await drainOutbox(pool, config.workerId, handlers, {
      limit: config.batchSize,
      leaseSeconds: config.leaseSeconds,
    })
    for (const key of Object.keys(outbox) as (keyof typeof outbox)[]) outbox[key] += batch[key]
    if (batch.claimed < config.batchSize || Date.now() >= deadline) break
  }
  const schedules = await runDueSchedules(pool, config.workerId, { leaseSeconds: config.leaseSeconds })
  const health = await queueHealth(pool)
  await reportQueueHealth(monitor, health)

  console.log(
    JSON.stringify({
      event: 'drain.complete',
      role: 'drain',
      workerId: config.workerId,
      heartbeatAt: at,
      outbox,
      schedules,
      health,
    }),
  )
  await closePools()

  // Non-zero when something needs a person: an event gave up permanently, or a
  // schedule failed for good. A row that merely backed off is normal operation
  // and the next pass will take it, so it is not an alert.
  process.exit(outbox.dead > 0 || schedules.failed > 0 ? 1 : 0)
} catch (error) {
  console.error(JSON.stringify({ event: 'drain.failed', error: (error as Error).message }))
  await closePools().catch(() => {})
  process.exit(1)
}
