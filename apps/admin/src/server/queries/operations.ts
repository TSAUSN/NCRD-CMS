import 'server-only'
import { asUser } from '@cms/platform'

export type HeartbeatRow = { worker_id: string; role: string; last_seen_at: Date; version: string }

/** M0 exit criterion: the worker's heartbeat is visible in the product. */
export function latestHeartbeats(userId: string): Promise<HeartbeatRow[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<HeartbeatRow>(
          'SELECT worker_id, role, last_seen_at, version FROM job_heartbeats ORDER BY last_seen_at DESC',
        )
      ).rows,
  )
}

export type QueueHealthRow = {
  outbox_waiting: string
  outbox_running: string
  outbox_stalled: string
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

/**
 * Queue health, so an operator learns about a stalled queue from the app rather
 * than from a user asking why their scheduled post never went out (ADR 0003).
 */
export function jobQueueHealth(userId: string): Promise<QueueHealthRow> {
  return asUser(
    { userId },
    async client => (await client.query<QueueHealthRow>('SELECT * FROM app.job_queue_health()')).rows[0]!,
  )
}
