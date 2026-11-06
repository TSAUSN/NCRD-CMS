// Prepare reviewable Cloud Run manifests locally. This command never deploys,
// creates accounts, grants access, or reads a database connection/secret value.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dns = value => typeof value === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)
const origin = value => {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash
  } catch {
    return false
  }
}

export function cloudRunManifests(config) {
  const onDemand = config.profile === 'google-on-demand'
  const mailEnabled = !onDemand || !!config.secrets?.mail
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId ?? '') || !/^\d{6,}$/.test(config.projectNumber ?? ''))
    throw Error('Supply the project ID and numeric project number.')
  if (!/^[a-z]+-[a-z]+\d$/.test(config.region ?? '')) throw Error('Supply a Cloud Run region.')
  if (!/^[a-z0-9.-]+\.pkg\.dev\/[a-zA-Z0-9/._-]+@sha256:[a-f0-9]{64}$/.test(config.image ?? ''))
    throw Error('Use an immutable Artifact Registry image digest.')
  for (const key of ['adminOrigin', 'supabaseUrl', ...(onDemand ? [] : ['storageSupabaseUrl'])])
    if (!origin(config[key])) throw Error(`${key} must be a credential-free HTTPS origin.`)
  if (!dns(config.stagingBaseDomain) || !dns(config.storageBucket))
    throw Error('Supply the staging base domain and private storage bucket.')
  if (
    mailEnabled &&
    (typeof config.mailFrom !== 'string' || !config.mailFrom.includes('@') || /[\r\n]/.test(config.mailFrom))
  )
    throw Error('Supply the verified sender address.')
  if (
    onDemand &&
    (config.stagingBaseDomain !== 'web.app' ||
      !/^[a-z][a-z0-9-]{1,11}[a-z0-9]$/.test(config.firebaseSitePrefix ?? '') ||
      !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(config.authPublishableKey ?? ''))
  )
    throw Error('Supply the Firebase site prefix, web.app base and Supabase public publishable key.')
  // Optional Cloud SQL for PostgreSQL. Cloud Run mounts the instance socket at
  // /cloudsql/<connection name> in every service and job that names it.
  if (
    config.cloudSqlInstance !== undefined &&
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z]+-[a-z]+\d+:[a-z][a-z0-9-]{0,96}$/.test(config.cloudSqlInstance)
  ) {
    throw Error('Supply the Cloud SQL connection name as PROJECT:REGION:INSTANCE.')
  }
  const cloudSql = config.cloudSqlInstance ? { 'run.googleapis.com/cloudsql-instances': config.cloudSqlInstance } : {}
  const secret = (name, key) => {
    const ref = config.secrets?.[key]
    if (!ref || !/^[a-zA-Z0-9_-]{1,255}$/.test(ref.name ?? '') || !/^[1-9]\d*$/.test(ref.version ?? ''))
      throw Error(`Supply a pinned Secret Manager reference for ${key}.`)
    return { name, valueFrom: { secretKeyRef: { name: ref.name, key: ref.version } } }
  }
  const env = (name, value) => ({ name, value: String(value) })
  const shared = [
    env('APP_VERSION', config.image.split('@')[1]),
    env('STORAGE_BUCKET', config.storageBucket),
    ...(onDemand
      ? [
          env('MEDIA_PROVIDER', 'google'),
          env('GOOGLE_CLOUD_PROJECT', config.projectId),
          env('GOOGLE_CLOUD_REGION', config.region),
          env('FIREBASE_HOSTING_SITE_PREFIX', config.firebaseSitePrefix),
          env('FIREBASE_PUBLIC_SERVICE', 'cms-site'),
          env('DOMAIN_PROVIDER', 'firebase'),
        ]
      : [
          env('MEDIA_PROVIDER', 'supabase'),
          env('STORAGE_SUPABASE_URL', config.storageSupabaseUrl),
          secret('STORAGE_SUPABASE_KEY', 'storage'),
        ]),
    env('SCHEDULING_ENABLED', onDemand && config.schedulingVerified === true),
    env('SCHEDULING_MONITORING_READY', onDemand && config.schedulingVerified === true),
  ]
  const identity = role => `cms-${role}@${config.projectId}.iam.gserviceaccount.com`
  const service = (role, variables) => ({
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: {
      name: `cms-${role}`,
      namespace: config.projectNumber,
      labels: { 'cloud.googleapis.com/location': config.region },
      annotations: { 'run.googleapis.com/maxScale': '1', 'run.googleapis.com/invoker-iam-disabled': 'false' },
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            'autoscaling.knative.dev/minScale': '0',
            'autoscaling.knative.dev/maxScale': '1',
            'run.googleapis.com/cpu-throttling': 'true',
            'run.googleapis.com/startup-cpu-boost': 'false',
            ...cloudSql,
          },
        },
        spec: {
          serviceAccountName: identity(role),
          // One page can request dozens of pictures and fonts at once. Keep the
          // public instance available for those requests while its DB pool stays bounded.
          containerConcurrency: role === 'worker' ? 1 : role === 'site' ? 80 : 8,
          timeoutSeconds: role === 'worker' ? 180 : 300,
          containers: [
            {
              image: config.image,
              args: [role === 'worker' ? 'worker-http' : role],
              ports: [{ name: 'http1', containerPort: 8080 }],
              env: [...shared, ...variables],
              resources: { limits: { cpu: '1', memory: role === 'worker' ? '2Gi' : '512Mi' } },
              startupProbe: { httpGet: { path: '/health', port: 8080 }, periodSeconds: 5, failureThreshold: 24 },
            },
          ],
        },
      },
      traffic: [{ latestRevision: true, percent: 100 }],
    },
  })
  const job = (role, variables, account = role) => ({
    apiVersion: 'run.googleapis.com/v1',
    kind: 'Job',
    metadata: {
      name: `cms-${role}`,
      namespace: config.projectNumber,
      labels: { 'cloud.googleapis.com/location': config.region },
    },
    spec: {
      template: {
        metadata: { annotations: { ...cloudSql } },
        spec: {
          taskCount: 1,
          parallelism: 1,
          template: {
            spec: {
              serviceAccountName: identity(account),
              maxRetries: 0,
              timeoutSeconds: 600,
              containers: [
                {
                  image: config.image,
                  args: [role],
                  env: variables,
                  resources: { limits: { cpu: '1', memory: '1Gi' } },
                },
              ],
            },
          },
        },
      },
    },
  })
  const admin = service('admin', [
    secret('DATABASE_URL_AUTHENTICATED', 'adminDatabase'),
    env('AUTH_PROVIDER', 'supabase'),
    env('ADMIN_ORIGIN', config.adminOrigin),
    env('SUPABASE_URL', config.supabaseUrl),
    onDemand
      ? env('SUPABASE_PUBLISHABLE_KEY', config.authPublishableKey)
      : secret('SUPABASE_PUBLISHABLE_KEY', 'authPublishable'),
    env('STAGING_BASE_DOMAIN', config.stagingBaseDomain),
    env('INVITATION_EMAIL_ENABLED', mailEnabled),
    env('TRUST_PROXY_HEADERS', 'true'),
  ])
  const site = service('site', [secret('DATABASE_URL_PUBLIC', 'publicDatabase'), env('TRUST_PROXY_HEADERS', 'true')])
  const workerVariables = [
    secret('DATABASE_URL_WORKER', 'workerDatabase'),
    env('ADMIN_ORIGIN', config.adminOrigin),
    env('MONITORING_PROVIDER', 'stdout'),
    ...(mailEnabled
      ? [env('MAILER_PROVIDER', 'resend'), secret('RESEND_API_KEY', 'mail'), env('MAIL_FROM', config.mailFrom)]
      : [env('MAILER_PROVIDER', 'disabled')]),
  ]
  const work = onDemand
    ? service('worker', [
        ...workerVariables,
        env('WORKER_PASS_SECONDS', 35),
        env('WORKER_LEASE_SECONDS', 120),
        env('WORKER_BATCH_SIZE', 20),
      ])
    : job('drain', [...shared, ...workerVariables, env('WORKER_DRAIN_SECONDS', 240)], 'worker')
  const migrate = job(
    'migrate',
    [secret('DATABASE_URL', 'migrationDatabase'), env('APP_VERSION', config.image.split('@')[1])],
    'operator',
  )
  let backup
  if (onDemand && config.recoveryImage) {
    if (
      !/^[a-z0-9.-]+\.pkg\.dev\/[a-zA-Z0-9/._-]+@sha256:[a-f0-9]{64}$/.test(config.recoveryImage) ||
      !dns(config.backupBucket)
    )
      throw Error('Supply an immutable recovery image and private backup bucket.')
    backup = job(
      'backup',
      [
        ...shared,
        secret('DATABASE_URL', 'migrationDatabase'),
        secret('CMS_BACKUP_KEY', 'backupKey'),
        env('BACKUP_BUCKET', config.backupBucket),
      ],
      'operator',
    )
    const spec = backup.spec.template.spec.template.spec
    spec.timeoutSeconds = 900
    spec.containers[0].image = config.recoveryImage
    spec.containers[0].command = ['node']
    spec.containers[0].args = ['--experimental-strip-types', 'src/google-backup-cli.ts']
  }
  // Mount the database trust root at the path named inside each connection
  // secret, if the provider certificate needs its own CA. Never disable TLS.
  if (config.secrets.databaseCa) {
    const ref = secret('CA', 'databaseCa').valueFrom.secretKeyRef
    for (const manifest of [admin, site, work, migrate, ...(backup ? [backup] : [])]) {
      const spec = manifest.kind === 'Service' ? manifest.spec.template.spec : manifest.spec.template.spec.template.spec
      spec.volumes = [
        { name: 'database-ca', secret: { secretName: ref.name, items: [{ key: ref.key, path: 'database-ca.crt' }] } },
      ]
      spec.containers[0].volumeMounts = [{ name: 'database-ca', mountPath: '/secrets/cms-db' }]
    }
  }
  return onDemand
    ? { admin, site, worker: work, migrate, ...(backup ? { backup } : {}) }
    : { admin, site, drain: work, migrate }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [configPath, out] = process.argv.slice(2)
  if (!configPath || !out) throw Error('Usage: node scripts/prepare-cloud-run.mjs CONFIG_JSON NEW_OUTPUT_DIRECTORY')
  const manifests = cloudRunManifests(JSON.parse(readFileSync(configPath, 'utf8')))
  const directory = resolve(out)
  mkdirSync(directory, { recursive: false, mode: 0o700 })
  for (const [role, manifest] of Object.entries(manifests))
    writeFileSync(join(directory, `${role}.yaml`), JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
  console.log(
    JSON.stringify({ status: 'prepared-locally', directory, manifests: Object.keys(manifests), deployed: false }),
  )
}
