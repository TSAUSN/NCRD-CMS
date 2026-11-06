// Liveness, readiness, and queue health for the worker role (SPEC §3.1, §6.15).
// A web deployment is not complete while the worker health check is absent, so
// the worker serves its own endpoints rather than being inferred from the web
// process.
import { createServer, type Server } from 'node:http'
import { asWorker } from '@cms/platform'
import type { QueueHealth } from './handlers.ts'

export type HealthState = {
  startedAt: Date
  lastHeartbeatAt: Date | null
  lastError: string | null
  lastQueueHealth: QueueHealth | null
}

export function startHealthServer(port: number, state: HealthState, workerId: string): Server {
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }

    if (request.url === '/health') {
      send(200, { status: 'ok', role: 'worker', workerId, startedAt: state.startedAt })
      return
    }

    if (request.url === '/ready') {
      // Ready means the database answered and a heartbeat has landed — not
      // merely that the process is listening.
      void asWorker(workerId, async client => client.query('SELECT 1'))
        .then(() => {
          const stale = !state.lastHeartbeatAt || Date.now() - state.lastHeartbeatAt.getTime() > 60_000
          send(stale ? 503 : 200, {
            status: stale ? 'stale' : 'ready',
            lastHeartbeatAt: state.lastHeartbeatAt,
            lastError: state.lastError,
          })
        })
        .catch((error: Error) => send(503, { status: 'unavailable', error: error.message }))
      return
    }

    if (request.url === '/queue') {
      // What an operator needs to answer "is anything stuck": depth, age of the
      // oldest waiting item, how much is retrying, and what has given up.
      const health = state.lastQueueHealth
      if (!health) {
        send(503, { status: 'unknown', reason: 'no sample taken yet' })
        return
      }
      const dead = Number(health.outbox_dead)
      const failed = Number(health.schedules_failed)
      const stalled = Number(health.outbox_stalled) + Number(health.schedules_stalled)
      const oldest = Number(health.outbox_oldest_waiting_seconds ?? 0)
      send(200, {
        // Degraded is deliberately visible in the status field: a queue that is
        // draining but has dead letters is not "ok".
        status: dead > 0 || failed > 0 || stalled > 0 ? 'degraded' : oldest > 300 ? 'lagging' : 'ok',
        outbox: {
          // Waiting and running are separate because they mean different
          // things: nothing has picked this up, versus this is in flight now.
          waiting: Number(health.outbox_waiting),
          running: Number(health.outbox_running),
          // Claimed and abandoned. A persistently non-zero value means a
          // worker is dying mid-delivery; 0008 dropped these rows from every
          // bucket, so the queue looked empty while work was stranded.
          stalled: Number(health.outbox_stalled),
          // Failed at least once and still trying — not merely "claimed once".
          retrying: Number(health.outbox_retrying),
          dead,
          oldestWaitingSeconds: health.outbox_oldest_waiting_seconds === null ? null : oldest,
        },
        schedules: {
          waiting: Number(health.schedules_waiting),
          running: Number(health.schedules_running),
          stalled: Number(health.schedules_stalled),
          retrying: Number(health.schedules_retrying),
          failed,
          overdueSeconds: health.schedules_overdue_seconds === null ? null : Number(health.schedules_overdue_seconds),
        },
        workers: {
          live: Number(health.live_workers),
          stale: Number(health.stale_workers),
          lastHeartbeatAt: health.last_heartbeat_at,
        },
      })
      return
    }

    send(404, { error: 'not found' })
  })
  server.listen(port)
  return server
}
