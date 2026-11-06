import { readFile } from 'node:fs/promises'

/** Safe, bounded operational data only: no payload, email, URL, token or raw
 * exception is accepted by the monitoring transport. */
export type MonitoringSnapshot = {
  outboxDead: number
  schedulesFailed: number
  stalled: number
  oldestWaitingSeconds: number
  overdueSeconds: number
  liveWorkers: number
  backupAgeSeconds?: number
  backupFailed?: boolean
  domainErrors?: number
}
export type MonitoringEvent = { event: 'cms.operations'; status: 'healthy' | 'degraded'; issues: string[]; at: string }
export type Monitor = { report(snapshot: MonitoringSnapshot): Promise<void> }
export function monitoringIssues(snapshot: MonitoringSnapshot): string[] {
  const issues: string[] = []
  if (snapshot.liveWorkers < 1 || !Number.isFinite(snapshot.liveWorkers)) issues.push('worker_missing')
  if ((snapshot.domainErrors ?? 0) > 0) issues.push('domain_error')
  if (snapshot.outboxDead > 0) issues.push('outbox_dead')
  if (snapshot.schedulesFailed > 0) issues.push('schedule_failed')
  if (snapshot.stalled > 0) issues.push('lease_stalled')
  if (snapshot.oldestWaitingSeconds > 300) issues.push('outbox_lagging')
  if (snapshot.overdueSeconds > 300) issues.push('schedule_overdue')
  if (snapshot.backupFailed) issues.push('backup_failed')
  if (
    snapshot.backupAgeSeconds !== undefined &&
    (!Number.isFinite(snapshot.backupAgeSeconds) || snapshot.backupAgeSeconds > 26 * 3600)
  )
    issues.push('backup_stale')
  return issues
}
export function createMonitor(
  deliver: (event: MonitoringEvent) => Promise<void>,
  now: () => Date = () => new Date(),
): Monitor {
  let previous: string | null = null
  let lastDelivered = 0
  return {
    async report(snapshot) {
      const issues = monitoringIssues(snapshot)
      const signature = issues.join(',')
      const at = now()
      if (signature === previous && (!issues.length || at.getTime() - lastDelivered < 15 * 60_000)) return
      await deliver({
        event: 'cms.operations',
        status: issues.length ? 'degraded' : 'healthy',
        issues,
        at: at.toISOString(),
      })
      previous = signature
      lastDelivered = at.getTime()
    },
  }
}
export function configuredMonitor(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Monitor {
  if (env['MONITORING_PROVIDER'] === 'webhook') {
    let url: URL
    try {
      url = new URL(env['MONITORING_WEBHOOK_URL'] ?? '')
    } catch {
      throw new Error('Configure MONITORING_WEBHOOK_URL')
    }
    const token = env['MONITORING_WEBHOOK_TOKEN']
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !token ||
      /\s/.test(token)
    ) {
      throw new Error('Monitoring requires HTTPS and a separate MONITORING_WEBHOOK_TOKEN')
    }
    return createMonitor(async event => {
      let response: Response
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
        })
      } catch {
        throw new Error('Monitoring delivery is unavailable')
      }
      if (!response.ok) throw new Error(`Monitoring delivery returned HTTP ${response.status}`)
    })
  }
  if (env['MONITORING_PROVIDER'] && env['MONITORING_PROVIDER'] !== 'stdout')
    throw new Error('Unknown MONITORING_PROVIDER')
  // Stdout is an explicit production integration when the host collects logs.
  // Its alert routing/silence checks still need an external activation drill.
  return createMonitor(async event => {
    console.log(JSON.stringify(event))
  })
}
export async function backupMonitoringSnapshot(
  path: string | undefined,
  now = new Date(),
): Promise<Pick<MonitoringSnapshot, 'backupAgeSeconds' | 'backupFailed'>> {
  if (!path) return {}
  try {
    const status = JSON.parse(await readFile(path, 'utf8')) as { status?: string; createdAt?: string }
    const timestamp = Date.parse(status.createdAt ?? '')
    return {
      backupFailed: status.status !== 'complete',
      backupAgeSeconds: Math.max(0, (now.getTime() - timestamp) / 1000),
    }
  } catch {
    return { backupFailed: true, backupAgeSeconds: Infinity }
  }
}
