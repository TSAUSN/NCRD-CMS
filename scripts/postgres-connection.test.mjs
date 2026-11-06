import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { assertOperatorConnection, postgresConnectionUrl, runtimeConnection } from './postgres-connection.mjs'

const { Client } = createRequire(new URL('../packages/schema/package.json', import.meta.url))('pg')
const config = {
  host: 'db.example.org',
  database: 'postgres',
  user: 'cms_admin',
  password: 'a%40:b/@?#+ %',
  ssl: { rejectUnauthorized: true },
}

test('the actual pg parser preserves special password characters and loads the CA from its real pathname', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cms-pg-ca-'))
  try {
    const caPath = join(directory, 'database-ca.crt')
    writeFileSync(caPath, 'test-root-certificate')
    const client = new Client({ connectionString: postgresConnectionUrl(config, caPath) })
    assert.equal(client.connectionParameters.password, config.password)
    assert.equal(client.connectionParameters.user, config.user)
    assert.equal(client.connectionParameters.ssl.ca, 'test-root-certificate')
    assert.notEqual(client.connectionParameters.ssl.rejectUnauthorized, false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('pooler routing changes only the runtime connection identity and retains verified TLS', () => {
  const owner = {
    ...config,
    cmsPooler: { host: 'aws-0-us-east-2.pooler.supabase.com', projectRef: 'abcdefghijklmnopqrst' },
  }
  const runtime = runtimeConnection(owner, 'cms_v2_worker', 'runtime-secret')
  assert.equal(runtime.user, 'cms_v2_worker.abcdefghijklmnopqrst')
  assert.equal(runtime.host, owner.cmsPooler.host)
  assert.equal(runtime.password, 'runtime-secret')
  assert.deepEqual(runtime.ssl, { rejectUnauthorized: true })
  assert(!('cmsPooler' in runtime))
  assert.equal(owner.password, config.password)
  assert.throws(
    () => runtimeConnection({ ...owner, cmsPooler: { ...owner.cmsPooler, port: 6543 } }, 'role', 'secret'),
    /session-pooler/,
  )
})

test('a Cloud SQL socket runtime connection makes pg use the socket, never a TCP host', () => {
  const owner = {
    host: '127.0.0.1',
    port: 5432,
    database: 'cms',
    user: 'postgres',
    password: 'owner',
    cloudSqlSocket: '/cloudsql/cms-example:us-east1:cms-db',
  }
  const runtime = runtimeConnection(owner, 'cms_v2_site', 'p@ss/word%')
  assert.deepEqual(runtime, {
    database: 'cms',
    socketPath: owner.cloudSqlSocket,
    user: 'cms_v2_site',
    password: 'p@ss/word%',
  })
  const client = new Client({ connectionString: postgresConnectionUrl(runtime) })
  assert.equal(client.connectionParameters.host, owner.cloudSqlSocket)
  assert.equal(client.connectionParameters.user, 'cms_v2_site')
  assert.equal(client.connectionParameters.password, 'p@ss/word%')
  assert.equal(client.connectionParameters.database, 'cms')
  assert.throws(
    () => runtimeConnection({ ...owner, cloudSqlSocket: '/tmp/socket' }, 'role', 'secret'),
    /Cloud SQL socket/,
  )
  assert.throws(
    () => runtimeConnection({ ...owner, cmsPooler: { host: 'x', projectRef: 'y' } }, 'role', 'secret'),
    /not both/,
  )
})

test('operators need verified TLS, except through an explicit loopback Cloud SQL Auth Proxy', () => {
  assert.doesNotThrow(() => assertOperatorConnection(config, false))
  const proxy = { host: '127.0.0.1', database: 'cms', user: 'postgres', password: 'owner' }
  assert.throws(() => assertOperatorConnection(proxy, false), /verified database TLS/)
  assert.doesNotThrow(() => assertOperatorConnection(proxy, true))
  assert.throws(() => assertOperatorConnection({ ...proxy, host: 'db.example.org' }, true), /loopback/)
  assert.throws(() => assertOperatorConnection({ ...proxy, ssl: { rejectUnauthorized: false } }, true), /loopback/)
})
