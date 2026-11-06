import { backupMonitoringSnapshot, poolFor, type Monitor } from '@cms/platform'
import type { QueueHealth } from './handlers.ts'
export async function reportQueueHealth(monitor: Monitor, health: QueueHealth): Promise<void> {
  const domains = await poolFor('worker').query<{ count: string }>(
    "SELECT count(*)::text AS count FROM domains WHERE status='error' AND removed_at IS NULL",
  )
  await monitor.report({
    domainErrors: Number(domains.rows[0]!.count),
    outboxDead: Number(health.outbox_dead),
    schedulesFailed: Number(health.schedules_failed),
    stalled: Number(health.outbox_stalled) + Number(health.schedules_stalled),
    oldestWaitingSeconds: Number(health.outbox_oldest_waiting_seconds ?? 0),
    overdueSeconds: Number(health.schedules_overdue_seconds ?? 0),
    liveWorkers: Number(health.live_workers),
    ...(await backupMonitoringSnapshot(process.env['BACKUP_STATUS_PATH'])),
  })
}
