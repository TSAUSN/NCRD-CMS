import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { cloud } from './scope.mjs'
import { restoreDatabase, operatorConnection } from './database.mjs'
import { postgresConnectionUrl, runtimeConnection } from '../postgres-connection.mjs'
import { local, identity, receipt } from './common.mjs'
export async function database(c) {
  await restoreDatabase(c)
  const require = createRequire(new URL('../../packages/schema/package.json', import.meta.url))
  const { Client } = require('pg')
  const check = new Client(operatorConnection(c))
  await check.connect()
  try {
    if (
      (
        await check.query("SELECT count(*)::int AS n FROM app_users WHERE status='active' AND email<>$1", [
          c.ownerEmail,
        ])
      ).rows[0].n
    )
      throw Error('Friday is owner-only; cleaned input contains another active account.')
  } finally {
    await check.end()
  }

  const runtime = join(c.privateDirectory, 'runtime')
  if (!existsSync(runtime))
    local(process.execPath, [
      'scripts/provision-runtime-logins.mjs',
      '--connection-file',
      join(c.privateDirectory, 'operator.json'),
      '--out',
      runtime,
      '--via-local-proxy',
    ])
  const connections = JSON.parse(readFileSync(join(runtime, 'connections.json'), 'utf8'))
  if (connections.database !== c.database) throw Error('Existing runtime credentials belong to a different database.')
  const operator = operatorConnection(c)
  const migration = postgresConnectionUrl(runtimeConnection(operator, operator.user, operator.password))
  const files = {
    adminDatabase: join(runtime, 'admin.env'),
    publicDatabase: join(runtime, 'site.env'),
    workerDatabase: join(runtime, 'worker.env'),
  }
  const values = {}
  for (const [key, file] of Object.entries(files)) values[key] = readFileSync(file, 'utf8').trim().split(/=(.*)/s)[1]
  values.migrationDatabase = migration
  const keyFile = join(c.privateDirectory, 'backup-key.txt')
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' })
  values.backupKey = readFileSync(keyFile, 'utf8').trim()
  const secretNames = {
    adminDatabase: 'cms-admin-database',
    publicDatabase: 'cms-site-database',
    workerDatabase: 'cms-worker-database',
    migrationDatabase: 'cms-migration-database',
    backupKey: 'cms-backup-key',
  }
  const existing = cloud(c, ['secrets', 'list', '--format=json'], { json: true })
  const references = {}
  for (const [key, secret] of Object.entries(secretNames)) {
    if (!existing.some(x => x.name.endsWith('/' + secret)))
      cloud(c, ['secrets', 'create', secret, '--replication-policy=automatic'])
    const versions = cloud(c, ['secrets', 'versions', 'list', secret, '--filter=state:ENABLED', '--format=json'], {
      json: true,
    })
    let version = versions[0]?.name.split('/').pop()
    if (version) {
      if (cloud(c, ['secrets', 'versions', 'access', version, '--secret=' + secret]) !== values[key])
        throw Error('Existing secret differs; refusing credential rotation: ' + secret)
    } else {
      const file = join(c.privateDirectory, secret + '.txt')
      writeFileSync(file, values[key], { mode: 0o600 })
      version = cloud(c, ['secrets', 'versions', 'add', secret, '--data-file=' + file, '--format=value(name)'])
        .split('/')
        .pop()
    }
    references[key] = { name: secret, version }
    const recipient = {
      adminDatabase: 'admin',
      publicDatabase: 'site',
      workerDatabase: 'worker',
      migrationDatabase: 'operator',
      backupKey: 'operator',
    }[key]
    cloud(c, [
      'secrets',
      'add-iam-policy-binding',
      secret,
      '--member=serviceAccount:' + identity(c, recipient),
      '--role=roles/secretmanager.secretAccessor',
      '--condition=None',
      '--quiet',
    ])
  }
  receipt(c, 'secret-references', references)
}
