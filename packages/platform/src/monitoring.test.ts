import { expect, it, vi } from 'vitest'
import { createMonitor, configuredMonitor, monitoringIssues, type MonitoringSnapshot } from './monitoring.ts'
const healthy: MonitoringSnapshot = {
  liveWorkers: 1,
  outboxDead: 0,
  schedulesFailed: 0,
  stalled: 0,
  oldestWaitingSeconds: 0,
  overdueSeconds: 0,
}
it('detects missing workers, lag, failed jobs and stale backups', () => {
  expect(
    monitoringIssues({
      ...healthy,
      liveWorkers: 0,
      outboxDead: 2,
      schedulesFailed: 1,
      stalled: 1,
      oldestWaitingSeconds: 301,
      overdueSeconds: 500,
      backupAgeSeconds: Infinity,
      backupFailed: true,
    }),
  ).toEqual([
    'worker_missing',
    'outbox_dead',
    'schedule_failed',
    'lease_stalled',
    'outbox_lagging',
    'schedule_overdue',
    'backup_failed',
    'backup_stale',
  ])
})
it('suppresses identical samples, retries failed delivery, and reports recovery', async () => {
  let ms = 0
  const deliver = vi.fn().mockResolvedValue(undefined)
  const monitor = createMonitor(deliver, () => new Date(ms))
  await monitor.report(healthy)
  await monitor.report(healthy)
  expect(deliver).toHaveBeenCalledTimes(1)
  await monitor.report({ ...healthy, outboxDead: 1 })
  await monitor.report({ ...healthy, outboxDead: 1 })
  expect(deliver).toHaveBeenCalledTimes(2)
  ms = 16 * 60_000
  deliver.mockRejectedValueOnce(new Error('unavailable'))
  await expect(monitor.report({ ...healthy, outboxDead: 1 })).rejects.toThrow()
  await monitor.report({ ...healthy, outboxDead: 1 })
  await monitor.report(healthy)
  expect(deliver.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'healthy', issues: [] })
})
it('sends only issue identifiers and HTTPS header credentials without redirects', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
  const monitor = configuredMonitor(
    {
      MONITORING_PROVIDER: 'webhook',
      MONITORING_WEBHOOK_URL: 'https://alerts.example.org/cms',
      MONITORING_WEBHOOK_TOKEN: 'secret',
    },
    fetcher,
  )
  await monitor.report({ ...healthy, outboxDead: 1 })
  const init = fetcher.mock.calls[0]![1]!
  expect(init.redirect).toBe('error')
  expect(init.body).not.toContain('secret')
  expect(() =>
    configuredMonitor({
      MONITORING_PROVIDER: 'webhook',
      MONITORING_WEBHOOK_URL: 'https://alerts.example.org?token=secret',
      MONITORING_WEBHOOK_TOKEN: 'secret',
    }),
  ).toThrow()
})
