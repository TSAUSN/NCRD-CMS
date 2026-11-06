import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { cloud, google } from './scope.mjs'
import { apis, roles, identity, bucket, wait, sqlMachineArgs } from './common.mjs'
async function sqlOperation(c, result) {
  while (result.status !== 'DONE') {
    await wait(5000)
    result = await google(c, 'sqladmin', `sql/v1beta4/projects/${c.projectId}/operations/${result.name}`)
  }
  if (result.error) throw Error('SQL operation failed; inspect the project operation without exposing credentials.')
}

export async function infrastructure(c, options) {
  cloud(c, ['services', 'enable', ...apis.map(x => x + '.googleapis.com')])
  const accounts = cloud(c, ['iam', 'service-accounts', 'list', '--format=json'], { json: true })
  for (const role of roles)
    if (accounts.some(x => x.email === identity(c, role) && x.disabled))
      throw Error('Expected service identity is disabled: ' + role)
    else if (!accounts.some(x => x.email === identity(c, role)))
      cloud(c, ['iam', 'service-accounts', 'create', 'cms-' + role, '--display-name=CMS ' + role])
  for (const role of ['media', 'backups', 'build-source']) {
    const store = await google(c, 'storage', `storage/v1/b/${bucket(c, role)}`, 'GET', undefined, [404])
    if (!store)
      cloud(c, [
        'storage',
        'buckets',
        'create',
        'gs://' + bucket(c, role),
        '--location=' + c.region,
        '--uniform-bucket-level-access',
        '--public-access-prevention',
      ])
    else if (
      String(store.projectNumber) !== c.projectNumber ||
      store.location?.replaceAll('-', '').toLowerCase() !== c.region.replaceAll('-', '') ||
      store.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true ||
      store.iamConfiguration?.publicAccessPrevention !== 'enforced'
    )
      throw Error(
        'Existing bucket has a different project, region or privacy policy. Refusing reuse: ' + bucket(c, role),
      )
  }
  const repositories = cloud(c, ['artifacts', 'repositories', 'list', '--location=' + c.region, '--format=json'], {
    json: true,
  })
  if (repositories.some(x => x.name.endsWith('/cms-v2') && x.format !== 'DOCKER'))
    throw Error('Existing registry is not the reviewed Docker repository.')
  if (!repositories.some(x => x.name.endsWith('/cms-v2')))
    cloud(c, ['artifacts', 'repositories', 'create', 'cms-v2', '--repository-format=docker', '--location=' + c.region])
  const projectGrant = (role, grant) =>
    cloud(c, [
      'projects',
      'add-iam-policy-binding',
      c.projectId,
      '--member=serviceAccount:' + identity(c, role),
      '--role=' + grant,
      '--condition=None',
      '--quiet',
    ])
  for (const role of ['admin', 'site', 'worker', 'operator']) projectGrant(role, 'roles/cloudsql.client')
  projectGrant('builder', 'roles/logging.logWriter')
  projectGrant('worker', 'roles/firebasehosting.admin')
  projectGrant('admin', 'roles/firebasehosting.admin')
  cloud(c, [
    'artifacts',
    'repositories',
    'add-iam-policy-binding',
    'cms-v2',
    '--location=' + c.region,
    '--member=serviceAccount:' + identity(c, 'builder'),
    '--role=roles/artifactregistry.writer',
    '--condition=None',
    '--quiet',
  ])
  for (const [role, store, grant] of [
    ['admin', 'media', 'roles/storage.objectUser'],
    ['site', 'media', 'roles/storage.objectViewer'],
    ['worker', 'media', 'roles/storage.objectAdmin'],
    ['operator', 'media', 'roles/storage.objectViewer'],
    ['operator', 'backups', 'roles/storage.objectAdmin'],
    ['builder', 'build-source', 'roles/storage.objectViewer'],
  ])
    cloud(c, [
      'storage',
      'buckets',
      'add-iam-policy-binding',
      'gs://' + bucket(c, store),
      '--member=serviceAccount:' + identity(c, role),
      '--role=' + grant,
    ])
  if (!(await google(c, 'firebase', `v1beta1/projects/${c.projectId}`, 'GET', undefined, [404]))) {
    let operation = await google(c, 'firebase', `v1beta1/projects/${c.projectId}:addFirebase`, 'POST', {})
    while (!operation.done) {
      await wait(5000)
      if (!/^operations\/[a-zA-Z0-9_-]+$/.test(operation.name)) throw Error('Unexpected Firebase operation name.')
      operation = await google(c, 'firebase', 'v1beta1/' + operation.name)
    }
    if (operation.error) throw Error('Firebase initialization failed; no later step ran.')
  }
  const instances = cloud(c, ['sql', 'instances', 'list', '--format=json'], { json: true })
  const existing = instances.find(x => x.name === c.sqlInstance)
  if (!existing) {
    if (!options.allowCreateSql)
      throw Error('SQL instance is absent. Administrator spending approval and --allow-create-sql are required.')
    cloud(c, [
      'sql',
      'instances',
      'create',
      c.sqlInstance,
      '--database-version=POSTGRES_16',
      '--edition=ENTERPRISE',
      ...sqlMachineArgs(c.sqlTier),
      '--region=' + c.region,
      '--availability-type=ZONAL',
      '--storage-type=SSD',
      '--storage-size=10',
      '--no-storage-auto-increase',
      '--deletion-protection',
      '--backup-start-time=07:00',
      '--retained-backups-count=7',
      '--enable-point-in-time-recovery',
      '--retained-transaction-log-days=7',
    ])
    const file = join(c.privateDirectory, 'operator.json')
    if (existsSync(file))
      throw Error('New instance has an unexpected existing credential file. Inspect before continuing.')
    const connection = {
      host: '127.0.0.1',
      port: c.proxyPort,
      database: c.database,
      user: 'postgres',
      password: randomBytes(36).toString('base64url'),
      cloudSqlSocket: `/cloudsql/${c.projectId}:${c.region}:${c.sqlInstance}`,
    }
    writeFileSync(file, JSON.stringify(connection, null, 2), { mode: 0o600, flag: 'wx' })
    await sqlOperation(
      c,
      await google(
        c,
        'sqladmin',
        `sql/v1beta4/projects/${c.projectId}/instances/${c.sqlInstance}/users?name=postgres`,
        'PUT',
        { name: 'postgres', password: connection.password },
      ),
    )
  } else if (
    existing.region !== c.region ||
    existing.databaseVersion !== 'POSTGRES_16' ||
    existing.settings?.tier !== c.sqlTier
  )
    throw Error(
      'Existing SQL instance differs from the reviewed region/version/tier. Refusing reuse or automatic resizing.',
    )
  if (!existsSync(join(c.privateDirectory, 'operator.json')))
    throw Error('Existing SQL instance requires its existing private operator.json; credentials are never reset.')
}
