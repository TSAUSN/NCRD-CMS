import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloudRunManifests } from './prepare-cloud-run.mjs'

const reference = name => ({ name, version: '1' })
const config = {
  projectId: 'cms-example',
  projectNumber: '123456789012',
  region: 'us-east1',
  image: `us-east1-docker.pkg.dev/cms-example/app/cms-v2@sha256:${'a'.repeat(64)}`,
  adminOrigin: 'https://cms.example.test',
  supabaseUrl: 'https://auth.supabase.co',
  storageSupabaseUrl: 'https://storage.supabase.co',
  stagingBaseDomain: 'preview.example.test',
  storageBucket: 'cms-media',
  mailFrom: 'CMS <cms@example.test>',
  secrets: Object.fromEntries(
    [
      'adminDatabase',
      'publicDatabase',
      'workerDatabase',
      'migrationDatabase',
      'storage',
      'authPublishable',
      'mail',
      'databaseCa',
    ].map(name => [name, reference(name)]),
  ),
}

test('web roles receive their own runtime database only, and hosted auth has no local override', () => {
  const output = cloudRunManifests(config)
  for (const [role, name] of [
    ['admin', 'DATABASE_URL_AUTHENTICATED'],
    ['site', 'DATABASE_URL_PUBLIC'],
  ]) {
    const spec = output[role].spec.template.spec,
      names = spec.containers[0].env.map(item => item.name)
    assert.deepEqual(
      names.filter(item => item.startsWith('DATABASE_URL')),
      [name],
    )
    assert(!names.includes('CMS_LOCAL_TEST_MODE'))
    assert(!names.includes('AUTH_SECRET'))
    assert.equal(spec.containers[0].args[0], role)
    assert.equal(spec.containers[0].ports[0].containerPort, 8080)
    assert.equal(spec.volumes[0].secret.secretName, 'databaseCa')
  }
  assert.equal(
    output.admin.spec.template.spec.containers[0].env.find(item => item.name === 'AUTH_PROVIDER').value,
    'supabase',
  )
})
test('the worker is one finite task; owner credentials are reserved to an operator-only migration job', () => {
  const output = cloudRunManifests(config),
    job = output.drain.spec.template.spec
  assert.equal(job.taskCount, 1)
  assert.equal(job.parallelism, 1)
  assert.equal(job.template.spec.maxRetries, 0)
  const env = job.template.spec.containers[0].env
  assert.deepEqual(
    env.filter(item => item.name.startsWith('DATABASE_URL')).map(item => item.name),
    ['DATABASE_URL_WORKER'],
  )
  assert.equal(env.find(item => item.name === 'SCHEDULING_ENABLED').value, 'false')
  assert.match(output.migrate.spec.template.spec.template.spec.serviceAccountName, /^cms-operator@/)
  assert.deepEqual(
    output.migrate.spec.template.spec.template.spec.containers[0].env
      .filter(item => item.name.startsWith('DATABASE_URL'))
      .map(item => item.name),
    ['DATABASE_URL'],
  )
})
test('web scaling is bounded across revisions and bills requests without warm instances', () => {
  const output = cloudRunManifests(config)
  for (const role of ['admin', 'site']) {
    const service = output[role]
    assert.equal(service.metadata.annotations['run.googleapis.com/maxScale'], '1')
    const annotations = service.spec.template.metadata.annotations
    assert.equal(annotations['autoscaling.knative.dev/minScale'], '0')
    assert.equal(annotations['run.googleapis.com/cpu-throttling'], 'true')
    assert.equal(annotations['run.googleapis.com/startup-cpu-boost'], 'false')
  }
})
test('preparation rejects unverified origins, mutable images and unpinned secret versions', () => {
  assert.throws(() => cloudRunManifests({ ...config, adminOrigin: 'http://cms.example.test' }), /HTTPS/)
  assert.throws(() => cloudRunManifests({ ...config, image: 'example/app:latest' }), /immutable/)
  assert.throws(
    () => cloudRunManifests({ ...config, secrets: { ...config.secrets, mail: { name: 'mail', version: 'latest' } } }),
    /pinned/,
  )
})
test('Google on-demand uses the complete private HTTP worker and workload storage, never a database-bypass key', () => {
  const output = cloudRunManifests({
    ...config,
    profile: 'google-on-demand',
    stagingBaseDomain: 'web.app',
    firebaseSitePrefix: 'c123456789012',
    authPublishableKey: 'sb_publishable_public_key',
  })
  assert(!('drain' in output))
  const worker = output.worker.spec.template.spec
  assert.equal(worker.containerConcurrency, 1)
  assert.equal(output.site.spec.template.spec.containerConcurrency, 80)
  assert.equal(output.admin.spec.template.spec.containerConcurrency, 8)
  assert.equal(worker.containers[0].args[0], 'worker-http')
  assert.equal(output.worker.metadata.annotations['run.googleapis.com/invoker-iam-disabled'], 'false')
  const names = manifest => manifest.spec.template.spec.containers[0].env.map(item => item.name)
  for (const role of ['admin', 'site', 'worker']) {
    assert(!names(output[role]).includes('STORAGE_SUPABASE_KEY'))
    assert.equal(
      output[role].spec.template.spec.containers[0].env.find(item => item.name === 'MEDIA_PROVIDER').value,
      'google',
    )
  }
  assert.deepEqual(
    names(output.site).filter(name => name.startsWith('DATABASE_URL')),
    ['DATABASE_URL_PUBLIC'],
  )
  assert(!names(output.site).includes('RESEND_API_KEY'))
  assert(!names(output.admin).includes('RESEND_API_KEY'))
  assert.deepEqual(
    names(output.worker).filter(name => name.startsWith('DATABASE_URL')),
    ['DATABASE_URL_WORKER'],
  )
  assert.equal(worker.containers[0].env.find(item => item.name === 'SCHEDULING_ENABLED').value, 'false')
})
test('encrypted cloud backups run as the operator with the matching recovery image, separate from request workers', () => {
  const output = cloudRunManifests({
    ...config,
    profile: 'google-on-demand',
    stagingBaseDomain: 'web.app',
    firebaseSitePrefix: 'c123456789012',
    authPublishableKey: 'sb_publishable_public_key',
    recoveryImage: config.image,
    backupBucket: 'cms-private-backups',
    secrets: { ...config.secrets, backupKey: reference('backupKey') },
  })
  const spec = output.backup.spec.template.spec.template.spec
  assert.match(spec.serviceAccountName, /^cms-operator@/)
  assert.deepEqual(spec.containers[0].command, ['node'])
  assert(spec.containers[0].args.includes('src/google-backup-cli.ts'))
  assert.equal(spec.maxRetries, 0)
  assert.equal(spec.containers[0].env.filter(item => item.name === 'CMS_BACKUP_KEY').length, 1)
  assert.equal(
    output.worker.spec.template.spec.containers[0].env.filter(item => item.name === 'CMS_BACKUP_KEY').length,
    0,
  )
})
test('single-user pilots can omit invitation email without installing provider keys or pretending to deliver', () => {
  const { mail, ...secrets } = config.secrets
  const output = cloudRunManifests({
    ...config,
    secrets,
    mailFrom: undefined,
    profile: 'google-on-demand',
    stagingBaseDomain: 'web.app',
    firebaseSitePrefix: 'c123456789012',
    authPublishableKey: 'sb_publishable_public_key',
  })
  const admin = output.admin.spec.template.spec.containers[0].env
  const worker = output.worker.spec.template.spec.containers[0].env
  assert.equal(admin.find(item => item.name === 'AUTH_PROVIDER').value, 'supabase')
  assert.equal(admin.find(item => item.name === 'INVITATION_EMAIL_ENABLED').value, 'false')
  assert.equal(worker.find(item => item.name === 'MAILER_PROVIDER').value, 'disabled')
  assert(!worker.some(item => ['RESEND_API_KEY', 'MAIL_FROM'].includes(item.name)))
})

test('a Cloud SQL instance is mounted in every service and job, and is optional', () => {
  const onDemand = {
    ...config,
    profile: 'google-on-demand',
    stagingBaseDomain: 'web.app',
    firebaseSitePrefix: 'cms-review',
    authPublishableKey: 'sb_publishable_example',
    cloudSqlInstance: 'cms-example:us-east1:cms-db',
    recoveryImage: config.image,
    backupBucket: 'cms-backups',
    secrets: { ...config.secrets, backupKey: reference('backupKey') },
  }
  const output = cloudRunManifests(onDemand)
  for (const role of ['admin', 'site', 'worker']) {
    assert.equal(
      output[role].spec.template.metadata.annotations['run.googleapis.com/cloudsql-instances'],
      'cms-example:us-east1:cms-db',
    )
  }
  for (const role of ['migrate', 'backup']) {
    assert.equal(
      output[role].spec.template.metadata.annotations['run.googleapis.com/cloudsql-instances'],
      'cms-example:us-east1:cms-db',
    )
  }
  const without = cloudRunManifests(config)
  assert(!('run.googleapis.com/cloudsql-instances' in without.admin.spec.template.metadata.annotations))
  assert.throws(() => cloudRunManifests({ ...onDemand, cloudSqlInstance: 'cms-db' }), /PROJECT:REGION:INSTANCE/)
})
