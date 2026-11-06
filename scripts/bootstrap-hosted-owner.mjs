// Operator-only first account creation. Never installs local fixture identities.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { assertOperatorConnection } from './postgres-connection.mjs'
const require = createRequire(new URL('../packages/schema/package.json', import.meta.url))
const { Client } = require('pg')

export async function bootstrapHostedOwner(client, email, displayName) {
  if (
    typeof email !== 'string' ||
    !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) ||
    /\.(test|localhost)$/i.test(email) ||
    typeof displayName !== 'string' ||
    !displayName.trim() ||
    displayName.length > 120 ||
    /[\r\n]/.test(displayName)
  ) {
    throw Error('Supply the real owner email and a display name.')
  }
  const canonical = email.toLowerCase()
  await client.query('BEGIN')
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('cms-v2:first-hosted-owner'))")
    const owners = (
      await client.query(`SELECT u.id,u.email,u.status FROM public.app_users u
      JOIN public.global_roles r ON r.user_id=u.id WHERE r.role='super_admin'`)
    ).rows
    if (owners.length) {
      if (owners.length !== 1 || owners[0].email !== canonical || owners[0].status !== 'active') {
        throw Error('An installation owner already exists. Use the People workspace for later access changes.')
      }
      await client.query('COMMIT')
      return { status: 'already-initialized', userId: owners[0].id }
    }
    const existing = (
      await client.query(`SELECT EXISTS(SELECT 1 FROM public.app_users)
      OR EXISTS(SELECT 1 FROM public.sites) AS occupied`)
    ).rows[0]
    if (existing.occupied)
      throw Error(
        'First-owner bootstrap requires an empty installation; refusing to change existing content or accounts.',
      )
    const user = (
      await client.query(
        `INSERT INTO public.app_users(email,display_name,auth_subject)
      VALUES($1,$2,NULL) RETURNING id`,
        [canonical, displayName.trim()],
      )
    ).rows[0]
    await client.query("INSERT INTO public.global_roles(user_id,role) VALUES($1,'super_admin')", [user.id])
    await client.query('COMMIT')
    return { status: 'initialized', userId: user.id }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const viaLocalProxy = process.argv.includes('--via-local-proxy')
  const [configPath, email, displayName] = process.argv.slice(2).filter(arg => arg !== '--via-local-proxy')
  if (!configPath || !email || !displayName)
    throw Error(
      'Usage: node scripts/bootstrap-hosted-owner.mjs PRIVATE_PG_CONFIG_JSON OWNER_EMAIL DISPLAY_NAME [--via-local-proxy]',
    )
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  assertOperatorConnection(config, viaLocalProxy)
  const client = new Client({ ...config, connectionTimeoutMillis: 10000 })
  try {
    await client.connect()
    console.log(
      JSON.stringify({
        ...(await bootstrapHostedOwner(client, email, displayName)),
        tlsVerified: !viaLocalProxy,
        viaLocalProxy,
        testIdentitiesCreated: false,
      }),
    )
  } catch (error) {
    console.error(
      JSON.stringify({ status: 'failed', message: String(error.message).replaceAll(config.password, '[redacted]') }),
    )
    process.exitCode = 1
  } finally {
    await client.end().catch(() => {})
  }
}
