import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cloud, assertActiveScope } from './scope.mjs'
import { operatorConnection, pg } from './database.mjs'
import { cloudRunManifests } from '../prepare-cloud-run.mjs'
import { local, receipt, readReceipt, name, identity, bucket, imageRoot, origin, root, kept, wait } from './common.mjs'
export async function build(c) {
  if (
    local('git', ['rev-parse', 'HEAD']) !== c.revision ||
    local('git', ['status', '--porcelain', '--untracked-files=no'])
  )
    throw Error('Build requires the exact clean committed revision.')
  const archive = join(c.privateDirectory, 'committed-source.tar.gz')
  local('git', ['archive', '--format=tar.gz', '--output=' + archive, c.revision])
  const start = cloud(
    c,
    [
      'builds',
      'submit',
      archive,
      '--config=' + join(root, 'deploy/google/cloudbuild.yaml'),
      '--gcs-source-staging-dir=gs://' + bucket(c, 'build-source') + '/submissions',
      '--service-account=projects/' + c.projectId + '/serviceAccounts/' + identity(c, 'builder'),
      '--substitutions=_REVISION=' + c.revision.slice(0, 7) + ',_POSTGRES_MAJOR=16',
      '--async',
      '--format=json',
    ],
    { json: true },
  )
  receipt(c, 'build-start', { id: start.id, revision: c.revision })
  let result = start
  while (['QUEUED', 'WORKING', 'PENDING'].includes(result.status)) {
    console.log('Build ' + start.id + ': ' + result.status)
    await wait(15000)
    result = cloud(c, ['builds', 'describe', start.id, '--format=json(status,results.images)'], { json: true })
  }
  if (result.status !== 'SUCCESS') throw Error('Build did not succeed. Previous deployment remains available.')
  const pin = suffix => {
    const image = result.results.images.find(x => x.name === imageRoot(c) + suffix + ':' + c.revision.slice(0, 7))
    if (!image?.digest?.match(/^sha256:[a-f0-9]{64}$/)) throw Error('Build returned no expected immutable digest.')
    return imageRoot(c) + suffix + '@' + image.digest
  }
  const runtime = pin(''),
    recovery = pin('-recovery')
  for (const image of [runtime, recovery])
    cloud(c, [
      'artifacts',
      'docker',
      'tags',
      'add',
      image,
      image.split('@')[0] + ':deployed-' + c.revision.slice(0, 7),
      '--quiet',
    ])
  receipt(c, 'images', { runtime, recovery, revision: c.revision })
}

export function installationManifests(c, images, references, scheduling = false) {
  if (images.revision !== c.revision) throw Error('Image receipt revision differs from configured freeze.')
  const profile = {
    profile: 'google-on-demand',
    projectId: c.projectId,
    projectNumber: c.projectNumber,
    region: c.region,
    image: images.runtime,
    recoveryImage: images.recovery,
    adminOrigin: origin(c, 'admin'),
    supabaseUrl: c.supabaseUrl,
    authPublishableKey: c.authPublishableKey,
    stagingBaseDomain: 'web.app',
    firebaseSitePrefix: c.firebaseSitePrefix,
    storageBucket: bucket(c, 'media'),
    backupBucket: bucket(c, 'backups'),
    cloudSqlInstance: `${c.projectId}:${c.region}:${c.sqlInstance}`,
    schedulingVerified: scheduling,
    secrets: references,
  }
  const manifests = cloudRunManifests(profile)
  for (const [role, manifest] of Object.entries(manifests)) {
    manifest.metadata.name = name(c, role)
    const spec = manifest.kind === 'Service' ? manifest.spec.template.spec : manifest.spec.template.spec.template.spec
    const version = spec.containers[0].env.find(x => x.name === 'APP_VERSION')
    if (version) version.value = c.revision.slice(0, 7)
    if (manifest.kind === 'Service') {
      if (role !== 'worker' && c.publicInvocation === 'disable-invoker-check')
        manifest.metadata.annotations['run.googleapis.com/invoker-iam-disabled'] = 'true'
      const env = manifest.spec.template.spec.containers[0].env
      const hosting = env.find(x => x.name === 'FIREBASE_PUBLIC_SERVICE')
      if (hosting) hosting.value = name(c, 'site')
      env.push({ name: 'DATABASE_POOL_MAX', value: '2' })
      if (c.licensedBrandFontsApproved === true && ['admin', 'site'].includes(role))
        env.push({ name: 'CMS_SERVE_LICENSED_BRAND_FONTS', value: 'true' })
    }
  }
  return manifests
}

export async function deploy(c, scheduling = false) {
  const manifests = installationManifests(c, readReceipt(c, 'images'), readReceipt(c, 'secret-references'), scheduling)
  for (const [role, manifest] of Object.entries(manifests)) {
    const path = join(c.privateDirectory, role + '.yaml')
    writeFileSync(path, JSON.stringify(manifest, null, 2), { mode: 0o600 })
  }
  for (const role of ['site', 'admin', 'worker']) {
    cloud(c, [
      'run',
      'services',
      'replace',
      join(c.privateDirectory, role + '.yaml'),
      '--region=' + c.region,
      '--quiet',
    ])
    if (role !== 'worker' && c.publicInvocation === 'allUsers')
      cloud(c, [
        'run',
        'services',
        'add-iam-policy-binding',
        name(c, role),
        '--region=' + c.region,
        '--member=allUsers',
        '--role=roles/run.invoker',
        '--condition=None',
        '--quiet',
      ])
  }
  cloud(c, ['run', 'jobs', 'replace', join(c.privateDirectory, 'backup.yaml'), '--region=' + c.region, '--quiet'])
  cloud(c, [
    'run',
    'services',
    'add-iam-policy-binding',
    name(c, 'site'),
    '--region=' + c.region,
    '--member=serviceAccount:' + identity(c, 'worker'),
    '--role=roles/run.viewer',
    '--condition=None',
    '--quiet',
  ])
  cloud(c, [
    'run',
    'services',
    'add-iam-policy-binding',
    name(c, 'worker'),
    '--region=' + c.region,
    '--member=serviceAccount:' + identity(c, 'scheduler'),
    '--role=roles/run.invoker',
    '--condition=None',
    '--quiet',
  ])
  cloud(c, [
    'run',
    'jobs',
    'add-iam-policy-binding',
    name(c, 'backup'),
    '--region=' + c.region,
    '--member=serviceAccount:' + identity(c, 'scheduler'),
    '--role=roles/run.invoker',
    '--condition=None',
    '--quiet',
  ])
}

export async function hosting(c) {
  const require = createRequire(new URL('../../packages/schema/package.json', import.meta.url)),
    { Client } = require('pg')
  const operator = operatorConnection(c)
  pg(c, operator, 'pg_dump', ['--format=custom', '--file=' + join(c.privateDirectory, 'before-host-binding.dump')])
  const db = new Client(operator)
  await db.connect()
  const sites = []
  try {
    await db.query('BEGIN')
    const owner = (await db.query("SELECT id FROM app_users WHERE email=$1 AND status='active'", [c.ownerEmail]))
      .rows[0]
    if (!owner) throw Error('Expected active configured owner.')
    await db.query("SELECT set_config('app.user_id',$1,true)", [owner.id])
    if ((await db.query('SELECT count(*)::int AS n FROM domains')).rows[0].n)
      throw Error('A bootstrap archive cannot carry custom domains.')
    for (const slug of kept) {
      const site = (
        await db.query("SELECT id,staging_hostname FROM sites WHERE slug=$1 AND status<>'archived'", [slug])
      ).rows[0]
      const host =
        c.firebaseSitePrefix + '-' + createHash('sha256').update(slug).digest('hex').slice(0, 16) + '.web.app'
      if (!site) throw Error('Cleaned content is missing a kept site: ' + slug)
      if (site.staging_hostname !== host) {
        if (!site.staging_hostname.endsWith('.staging.localhost') && site.staging_hostname !== c.sourceHosts?.[slug])
          throw Error('Refusing to replace a pre-existing public hostname.')
        await db.query('UPDATE sites SET staging_hostname=$2,revision=revision+1 WHERE id=$1', [site.id, host])
        await db.query('SELECT app.rebuild_site_shell($1)', [site.id])
      }
      sites.push({ id: site.id, slug, host })
    }
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await db.end()
  }
  const { createFirebaseHostingClient } = await import('../../packages/platform/src/firebase-hosting.ts')
  const client = createFirebaseHostingClient({
    projectId: c.projectId,
    sitePrefix: c.firebaseSitePrefix,
    serviceId: name(c, 'site'),
    region: c.region,
    accessToken: async () => cloud(c, ['auth', 'print-access-token']),
  })
  for (const site of sites) {
    assertActiveScope(c)
    await client.ensureSite(site.host)
  }
  receipt(c, 'hosted-sites', sites)
}
