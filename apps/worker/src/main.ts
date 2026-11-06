import { recordLocalChapterMail } from './chapter-mail.ts'
import { reportQueueHealth } from './monitoring.ts'
import { requestDueDomainChecks } from './domains.ts'
// `start:worker` — the long-running role. The same handlers run in `drain`.
import { asWorker, closePools, poolFor, configuredMonitor } from '@cms/platform'
import { readConfig } from './config.ts'
import { drainOutbox, heartbeat, queueHealth, runDueSchedules } from './handlers.ts'
import { createWorkerRuntime } from './runtime.ts'
import { startHealthServer, type HealthState } from './health.ts'

const config = readConfig()
const monitor = configuredMonitor()
const { handlers, screenshots } = createWorkerRuntime(config)
const state: HealthState = { startedAt: new Date(), lastHeartbeatAt: null, lastError: null, lastQueueHealth: null }
const server = startHealthServer(config.healthPort, state, config.workerId)

let stopping = false
const log = (event: string, detail: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, role: 'worker', workerId: config.workerId, ...detail }))

async function beat(): Promise<void> {
  try {
    const at = await asWorker(config.workerId, client => heartbeat(client, 'worker', config.version))
    state.lastHeartbeatAt = at
    state.lastError = null
  } catch (error) {
    state.lastError = (error as Error).message
    log('heartbeat.failed', { error: state.lastError })
  }
}

/**
 * Ask again for the pictures nothing is going to ask for.
 *
 * Once, on start, and only in the role that has a browser. The case it exists
 * for is a deploy where the migration that requested the estate's thumbnails ran
 * against a worker that had never heard of the event type: that worker
 * dead-lettered every request, dead is terminal, and each of those definitions
 * would have shown a blank card forever. `app.request_missing_section_thumbnails`
 * asks only for versions with no picture and nothing already asking, so this is
 * safe to run on every start and does nothing at all on a healthy database.
 *
 * A failure here is logged and not fatal. A worker that would not start because
 * it could not backfill thumbnails would be a worker that stops publishing over
 * a cosmetic concern.
 */
async function requestMissingThumbnails(): Promise<void> {
  try {
    const requested = await asWorker(config.workerId, async client =>
      Number((await client.query<{ n: number }>('SELECT app.request_missing_section_thumbnails() AS n')).rows[0]!.n),
    )
    if (requested > 0) log('thumbnails.requested', { versions: requested })
  } catch (error) {
    log('thumbnails.request_failed', { error: (error as Error).message })
  }
}

async function tick(): Promise<void> {
  const pool = poolFor('worker')
  try {
    await requestDueDomainChecks(pool, config.workerId)
    await recordLocalChapterMail(pool, config.workerId)
    const outbox = await drainOutbox(pool, config.workerId, handlers, {
      limit: config.batchSize,
      leaseSeconds: config.leaseSeconds,
    })
    const schedules = await runDueSchedules(pool, config.workerId, { leaseSeconds: config.leaseSeconds })

    if (outbox.claimed > 0 || schedules.ran > 0 || schedules.failed > 0 || schedules.retrying > 0) {
      log('tick', { outbox, schedules })
    }
    // Dead-lettering is not a quiet event: it means something will never be
    // delivered unless a person intervenes.
    if (outbox.dead > 0) log('outbox.dead_letter', { count: outbox.dead })
  } catch (error) {
    state.lastError = (error as Error).message
    log('tick.failed', { error: state.lastError })
  }
}

async function sampleQueueHealth(): Promise<void> {
  try {
    state.lastQueueHealth = await queueHealth(poolFor('worker'))
    await reportQueueHealth(monitor, state.lastQueueHealth)
  } catch {
    log('monitoring.failed', { error: 'Queue health or monitoring delivery unavailable' })
    // Health sampling must never be the thing that stops the worker working.
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  log('shutdown', { signal })
  server.close()
  // The browser is a child process and does not die with a SIGTERM addressed to
  // this one. Left alone it becomes a Chromium nobody owns, holding a profile
  // directory, on every restart.
  await screenshots.close().catch(() => {})
  // Leases are not released on the way out: an interrupted delivery must be
  // redelivered, and letting the lease lapse is what guarantees that.
  await closePools().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

log('start', { healthPort: config.healthPort, version: config.version })
await beat()
setInterval(() => void beat(), config.heartbeatMs).unref()
setInterval(() => void sampleQueueHealth(), config.healthSampleMs).unref()
await sampleQueueHealth()

await requestMissingThumbnails()

while (!stopping) {
  await tick()
  await new Promise(resolve => setTimeout(resolve, config.pollMs))
}
