import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { assertActiveScope } from './scope.mjs'
import { postgresConnectionUrl } from '../postgres-connection.mjs'
const require = createRequire(new URL('../../packages/schema/package.json', import.meta.url))
const { Client } = require('pg')

export function operatorConnection(config) {
  const file = join(config.privateDirectory, 'operator.json')
  if (statSync(file).mode & 0o077) throw Error('Operator connection file must be private (chmod 600).')
  const c = JSON.parse(readFileSync(file, 'utf8'))
  if (
    c.host !== '127.0.0.1' ||
    c.port !== config.proxyPort ||
    c.database !== config.database ||
    c.cloudSqlSocket !== `/cloudsql/${config.projectId}:${config.region}:${config.sqlInstance}`
  )
    throw Error('Private operator connection does not match the explicit project/instance/database/proxy.')
  return c
}

export function pg(config, connection, program, args) {
  assertActiveScope(config)
  const env = {
    ...process.env,
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
  }
  const result = spawnSync(program, args, { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0)
    throw Error(`${program} failed. No later step ran; database credentials/output were not logged.`)
  return result.stdout
}

export async function fingerprints(connection) {
  const c = new Client({ ...connection, connectionTimeoutMillis: 10_000 })
  await c.connect()
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
    const result = {}
    for (const { tablename } of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw Error('Unexpected application table name.')
      const rows = (
        await c.query(
          `SELECT to_jsonb(t)::text AS row FROM public.${tablename} t ORDER BY to_jsonb(t)::text COLLATE "C"`,
        )
      ).rows
      result[tablename] = {
        rows: rows.length,
        sha256: createHash('sha256')
          .update(rows.map(x => x.row + '\n').join(''))
          .digest('hex'),
      }
    }
    await c.query('COMMIT')
    return result
  } finally {
    await c.end()
  }
}

export function reviewPendingJobs(events, scheduledCount) {
  if (
    scheduledCount ||
    events.some(
      event => event.status !== 'pending' || event.event_type !== 'site_shell.published' || event.archived !== true,
    )
  )
    throw Error('Cleaned archive contains unreviewed pending jobs. Refuse to start a worker.')
  // The original cleaner emits one cache invalidation for each archived site.
  // This existing handler only records cache invalidation; it sends no email,
  // provisions no domain/hosting and changes no published content.
  return { archivedSiteCacheInvalidations: events.length }
}

/** Never restore over content. An interrupted restore rolls back atomically;
 * completed receipts compare every application table before reuse. */
export async function restoreDatabase(config) {
  assertActiveScope(config)
  const operator = operatorConnection(config)
  const connection = { ...operator, database: 'postgres' }
  const c = new Client({ ...connection, connectionTimeoutMillis: 10_000 })
  await c.connect()
  const receiptFile = join(config.privateDirectory, 'restore-receipt.json')
  const archiveHash = createHash('sha256').update(readFileSync(config.cleanedDump)).digest('hex')
  if (archiveHash !== config.cleanedDumpSha256) throw Error('Cleaned dump checksum differs from the reviewed input.')
  try {
    const exists = (await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [config.database])).rowCount > 0
    if (!exists) await c.query(`CREATE DATABASE "${config.database}"`)
  } finally {
    await c.end()
  }
  const db = new Client(operator)
  await db.connect()
  try {
    const count = (
      await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname IN ('public','app','public_api')")
    ).rows[0].n
    if (count !== 0) {
      if (!existsSync(receiptFile))
        throw Error('Restore target contains tables without a completed bootstrap receipt. Refusing overwrite.')
      const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'))
      if (
        receipt.database !== config.database ||
        receipt.projectId !== config.projectId ||
        receipt.archiveHash !== archiveHash
      )
        throw Error('Restore receipt belongs to another target.')
      const completed = join(config.privateDirectory, 'restored-fingerprints.json')
      if (!existsSync(completed))
        throw Error(
          'An earlier restore has no completed migration/fingerprint receipt. Inspect it; never automatically overwrite or guess at partial state.',
        )
      const expected = JSON.parse(readFileSync(completed, 'utf8'))
      if (JSON.stringify(await fingerprints(operator)) !== JSON.stringify(expected))
        throw Error(
          'Database changed after bootstrap. Use the normal update/backup procedure instead of rerunning initial restoration.',
        )
      console.log('Database already restored; immutable migration checks will still run.')
    } else {
      // Always retain a pre-change archive, including for an empty target.
      pg(config, operator, 'pg_dump', [
        '--format=custom',
        '--file=' + join(config.privateDirectory, 'before-initial-restore.dump'),
      ])
      // A dedicated empty check DB supplies cluster NOLOGIN roles and proves the
      // migration path without placing application tables in the restore target.
      const checkName = config.database + '_check'
      if (checkName.length > 63) throw Error('Database name leaves no room for its migration-check sibling.')
      const admin = new Client(connection)
      await admin.connect()
      try {
        if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [checkName])).rowCount)
          await admin.query(`CREATE DATABASE "${checkName}"`)
      } finally {
        await admin.end()
      }
      const { migrate } = await import('../../packages/schema/src/migrate/index.ts')
      await migrate(postgresConnectionUrl({ ...operator, database: checkName }).replace('?sslmode=verify-full', ''))
      const role = (await db.query("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='cms'"))
        .rows[0]
      if (!role) await db.query('CREATE ROLE cms NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
      else if (role.rolcanlogin || role.rolsuper || role.rolbypassrls)
        throw Error('Archive compatibility role cms is not inert; refuse to broaden it.')
      await db.query(`ALTER DATABASE "${config.database}" OWNER TO cms_migration_owner`)
      pg(config, operator, 'pg_restore', [
        '--dbname=' + config.database,
        '--exit-on-error',
        '--single-transaction',
        '--role=cms_migration_owner',
        '--no-owner',
        config.cleanedDump,
      ])
      const expected = JSON.parse(readFileSync(config.cleanedFingerprints, 'utf8'))
      const restored = await fingerprints(operator)
      if (JSON.stringify(restored) !== JSON.stringify(expected))
        throw Error(
          'Restored application-table fingerprints differ from the backup snapshot. Do not start applications.',
        )
      writeFileSync(
        receiptFile,
        JSON.stringify(
          { projectId: config.projectId, database: config.database, archiveHash, at: new Date().toISOString() },
          null,
          2,
        ),
        { mode: 0o600, flag: 'wx' },
      )
    }
  } finally {
    await db.end()
  }
  pg(config, operator, 'pg_dump', ['--format=custom', '--file=' + join(config.privateDirectory, 'before-migrate.dump')])
  const { migrate } = await import('../../packages/schema/src/migrate/index.ts')
  const applied = await migrate(postgresConnectionUrl(operator).replace('?sslmode=verify-full', ''))
  const final = new Client(operator)
  await final.connect()
  try {
    const owners = (
      await final.query(
        "SELECT u.email,u.status,u.auth_subject FROM app_users u JOIN global_roles g ON g.user_id=u.id WHERE g.role='super_admin'",
      )
    ).rows
    if (
      owners.length !== 1 ||
      owners[0].email !== config.ownerEmail ||
      owners[0].status !== 'active' ||
      owners[0].auth_subject !== (config.ownerAuthSubject ?? null)
    )
      throw Error(
        'Cleaned content must have exactly its configured owner, with the explicitly recorded provider subject. Preserve the Friday personal owner mapping; do not rewrite hosted identities.',
      )
    const jobs = (
      await final.query(
        "SELECT o.event_type,o.status,(s.status='archived' OR s.archived_at IS NOT NULL) AS archived FROM outbox o LEFT JOIN sites s ON s.id=o.site_id WHERE o.status IN ('pending','running')",
      )
    ).rows
    const scheduled = (
      await final.query("SELECT count(*)::int AS n FROM scheduled_actions WHERE status IN ('pending','running')")
    ).rows[0].n
    const reviewed = reviewPendingJobs(jobs, scheduled)
    writeFileSync(join(config.privateDirectory, 'queue-review.json'), JSON.stringify(reviewed, null, 2), {
      mode: 0o600,
    })
    await final.query('ANALYZE')
  } finally {
    await final.end()
  }
  writeFileSync(
    join(config.privateDirectory, 'migration-receipt.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        migrations: applied.length,
        applied: applied.filter(x => !x.alreadyApplied).length,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  writeFileSync(
    join(config.privateDirectory, 'restored-fingerprints.json'),
    JSON.stringify(await fingerprints(operator), null, 2),
    { mode: 0o600 },
  )
}
