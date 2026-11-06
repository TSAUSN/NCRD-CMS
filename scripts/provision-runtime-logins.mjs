#!/usr/bin/env node
// One-time environment provisioning. Group privileges come from migrations;
// runtime logins never inherit migration ownership or provider administration.
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { assertOperatorConnection, postgresConnectionUrl, runtimeConnection } from './postgres-connection.mjs'
const require = createRequire(new URL('../packages/schema/package.json', import.meta.url))
const { Client } = require('pg')
const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
if (!args.includes('--connection-file') || !args.includes('--out')) {
  console.error(
    'Usage: node scripts/provision-runtime-logins.mjs --connection-file PRIVATE_PG_CONFIG_JSON --out NEW_PRIVATE_DIRECTORY [--via-local-proxy]',
  )
  process.exit(64)
}
const config = JSON.parse(readFileSync(option('--connection-file'), 'utf8'))
const viaLocalProxy = args.includes('--via-local-proxy')
assertOperatorConnection(config, viaLocalProxy)
const directory = path.resolve(option('--out'))
if (existsSync(directory))
  throw new Error('Output already exists. Reuse its credentials; provisioning never rotates existing logins.')
const services = [
  { service: 'admin', login: 'cms_v2_admin', group: 'cms_authenticated_user', env: 'DATABASE_URL_AUTHENTICATED' },
  { service: 'site', login: 'cms_v2_site', group: 'cms_public_renderer', env: 'DATABASE_URL_PUBLIC' },
  { service: 'worker', login: 'cms_v2_worker', group: 'cms_worker', env: 'DATABASE_URL_WORKER' },
]
const client = new Client({ ...config, connectionTimeoutMillis: 10000 })
const secrets = [config.password]
let transaction = false
try {
  await client.connect()
  if (!(await client.query("SELECT to_regclass('public.cms_migrations') AS migrations")).rows[0]?.migrations)
    throw new Error('CMS migrations must be applied before runtime provisioning.')
  const groups = (
    await client.query('SELECT rolname,rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])', [
      services.map(role => role.group),
    ])
  ).rows
  if (groups.length !== services.length || groups.some(role => role.rolcanlogin || role.rolsuper || role.rolbypassrls))
    throw new Error('Expected three restricted NOLOGIN CMS group roles.')
  const existing = (
    await client.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [services.map(role => role.login)])
  ).rows
  if (existing.length)
    throw new Error('A runtime login already exists; refusing to change its credentials or permissions.')
  await client.query('BEGIN')
  transaction = true
  await client.query("SET LOCAL lock_timeout='10s'")
  mkdirSync(directory, { mode: 0o700, recursive: false })
  chmodSync(directory, 0o700)
  const caPath = path.join(directory, 'database-ca.crt')
  if (config.ssl?.ca) writeFileSync(caPath, config.ssl.ca, { mode: 0o600, flag: 'wx' })
  const manifest = { host: config.host, database: config.database, services: {} }
  for (const role of services) {
    const password = randomBytes(36).toString('base64url')
    secrets.push(password)
    // Both SQL identifiers and the password alphabet are code-owned literals.
    await client.query(
      `CREATE ROLE ${role.login} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
    )
    await client.query(`GRANT ${role.group} TO ${role.login}`)
    await client.query(`REVOKE CREATE ON SCHEMA public,app,public_api FROM ${role.login}`)
    const runtime = runtimeConnection(config, role.login, password)
    const url = postgresConnectionUrl(runtime, config.ssl?.ca ? caPath : undefined)
    writeFileSync(path.join(directory, `${role.service}.env`), `${role.env}=${url}\n`, { mode: 0o600, flag: 'wx' })
    manifest.services[role.service] = { login: role.login, group: role.group, config: runtime }
  }
  writeFileSync(path.join(directory, 'connections.json'), JSON.stringify(manifest, null, 2), {
    mode: 0o600,
    flag: 'wx',
  })
  await client.query('COMMIT')
  transaction = false
  const verified = []
  for (const role of services) {
    // A Cloud SQL socket exists only inside Cloud Run, so verify each login
    // through the same proxy connection the operator is using.
    const { user, password } = manifest.services[role.service].config
    const check = config.cloudSqlSocket ? { ...config, user, password } : manifest.services[role.service].config
    const runtime = new Client({ ...check, connectionTimeoutMillis: 10000 })
    try {
      await runtime.connect()
      const row = (
        await runtime.query(
          `SELECT current_user, pg_has_role(current_user,$1,'MEMBER') AS expected_role,
        pg_has_role(current_user,'cms_migration_owner','MEMBER') AS owner_access,
        rolbypassrls,rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user`,
          [role.group],
        )
      ).rows[0]
      if (!row.expected_role || row.owner_access || row.rolbypassrls || row.rolsuper || row.rolcreaterole)
        throw new Error(`Runtime role verification failed for ${role.service}.`)
      verified.push(role.service)
    } finally {
      await runtime.end()
    }
  }
  console.log(
    JSON.stringify({
      provisioned: verified,
      credentialsDirectory: directory,
      tlsVerified: !viaLocalProxy,
      viaLocalProxy,
      migrationOwnershipGranted: false,
    }),
  )
} catch (error) {
  if (transaction) await client.query('ROLLBACK').catch(() => {})
  let message = String(error.message)
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted]')
  console.error(
    JSON.stringify({ code: error.code, message, credentialsDirectory: existsSync(directory) ? directory : null }),
  )
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
