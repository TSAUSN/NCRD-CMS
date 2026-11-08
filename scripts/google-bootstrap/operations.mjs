import { createRequire } from 'node:module'
import { join } from 'node:path'
import { operatorConnection, pg } from './database.mjs'
import { cloud, google } from './scope.mjs'
import { monitoringPolicies } from './monitoring.mjs'
import { deploy } from './deployment.mjs'
import { name, identity, origin } from './common.mjs'
export function containsReviewed(actual, reviewed) {
  if (Array.isArray(reviewed))
    return (
      Array.isArray(actual) &&
      actual.length === reviewed.length &&
      reviewed.every((v, i) => containsReviewed(actual[i], v))
    )
  if (reviewed && typeof reviewed === 'object')
    return (
      actual && typeof actual === 'object' && Object.entries(reviewed).every(([k, v]) => containsReviewed(actual[k], v))
    )
  return actual === reviewed
}

export async function operations(c) {
  const metric = name(c, 'backup-success')
  const metrics = cloud(c, ['logging', 'metrics', 'list', '--format=json'], { json: true })
  if (!metrics.some(x => x.name === metric))
    cloud(c, [
      'logging',
      'metrics',
      'create',
      metric,
      '--log-filter=resource.type="cloud_run_job" AND resource.labels.job_name="' +
        name(c, 'backup') +
        '" AND jsonPayload.event="backup.complete"',
    ])
  const existing = (await google(c, 'monitoring', `v3/projects/${c.projectId}/alertPolicies`)).alertPolicies ?? []
  for (const policy of monitoringPolicies(c, name(c, 'worker'), name(c, 'admin'), name(c, 'site'))) {
    const found = existing.find(x => x.displayName === policy.displayName)
    if (found) {
      if (!containsReviewed(found, policy))
        throw Error('Existing alert differs from reviewed channel/conditions: ' + policy.displayName)
    } else await google(c, 'monitoring', `v3/projects/${c.projectId}/alertPolicies`, 'POST', policy)
  }
  // Scheduler starts delivering immediately after creation. Capture before any trigger exists.
  pg(c, operatorConnection(c), 'pg_dump', [
    '--format=custom',
    '--file=' + join(c.privateDirectory, 'before-first-worker.dump'),
  ])
  const scheduler =
    (await google(c, 'cloudscheduler', `v1/projects/${c.projectId}/locations/${c.region}/jobs`)).jobs ?? []
  for (const [suffix, schedule, httpTarget] of [
    [
      'worker-pass',
      '* * * * *',
      {
        uri: origin(c, 'worker') + '/run',
        httpMethod: 'POST',
        oidcToken: { serviceAccountEmail: identity(c, 'scheduler'), audience: origin(c, 'worker') },
      },
    ],
    [
      'backup-every-12h',
      '0 */12 * * *',
      {
        uri: `https://run.googleapis.com/v2/projects/${c.projectId}/locations/${c.region}/jobs/${name(c, 'backup')}:run`,
        httpMethod: 'POST',
        oauthToken: {
          serviceAccountEmail: identity(c, 'scheduler'),
          scope: 'https://www.googleapis.com/auth/cloud-platform',
        },
        headers: { 'Content-Type': 'application/json' },
        body: 'e30=',
      },
    ],
  ]) {
    const job = {
      name: `projects/${c.projectId}/locations/${c.region}/jobs/${name(c, suffix)}`,
      schedule,
      timeZone: 'Etc/UTC',
      attemptDeadline: '180s',
      retryConfig: { retryCount: 1 },
      httpTarget,
    }
    const found = scheduler.find(x => x.name === job.name)
    if (found) {
      if (!containsReviewed(found, job)) throw Error('Existing Scheduler job differs from reviewed target/identity.')
    } else await google(c, 'cloudscheduler', `v1/projects/${c.projectId}/locations/${c.region}/jobs`, 'POST', job)
  }
  cloud(c, ['scheduler', 'jobs', 'run', name(c, 'worker-pass'), '--location=' + c.region])
  cloud(c, ['run', 'jobs', 'execute', name(c, 'backup'), '--region=' + c.region, '--wait'])
  const require = createRequire(new URL('../../packages/schema/package.json', import.meta.url))
  const { Client } = require('pg')
  const db = new Client(operatorConnection(c))
  await db.connect()
  try {
    const fresh = (
      await db.query(
        "SELECT EXISTS(SELECT 1 FROM job_heartbeats WHERE last_seen_at>now()-interval '5 minutes' AND version=$1) AS fresh",
        [c.revision.slice(0, 7)],
      )
    ).rows[0].fresh
    if (!fresh) throw Error('Worker trigger has not produced a fresh heartbeat. Scheduling stays off.')
  } finally {
    await db.end()
  }
  if (c.monitoringDeliveryConfirmed === true) await deploy(c, true)
  else
    console.log(
      'Worker/backup installed. Scheduling remains OFF until the administrator confirms notification delivery and reruns --phase operations; matching existing policies/jobs are reused.',
    )
}
