// Builds one migrated template database the test files clone. Doing the
// migration once keeps the suite fast without letting files share state.
import { Client } from 'pg'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from '../src/migrate/index.ts'
import { TEMPLATE_DB, requireTestDatabase } from './harness.ts'

export async function setup(): Promise<void> {
  const adminUrl = requireTestDatabase()
  const base = new URL(adminUrl)

  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    // Orphan cleanup happens here, not in teardown: teardown would race a
    // sibling package's live clones when several suites run in one session.
    const stale = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'cms\\_t\\_%'",
    )
    for (const row of stale.rows) await admin.query(`DROP DATABASE IF EXISTS ${row.datname} WITH (FORCE)`)
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`)
  } finally {
    await admin.end()
  }

  const templateUrl = `${base.protocol}//${base.username}:${base.password}@${base.hostname}:${base.port}/${TEMPLATE_DB}`
  await migrate(templateUrl)

  const here = dirname(fileURLToPath(import.meta.url))
  const roles = new Client({ connectionString: templateUrl })
  await roles.connect()
  try {
    await roles.query(await readFile(join(here, '..', 'scripts', 'local-roles.sql'), 'utf8'))
  } finally {
    await roles.end()
  }
}

export async function teardown(): Promise<void> {
  // Each TestDatabase drops its own clone in close(); this only retires the
  // template, so a suite tearing down cannot disturb one still running.
  const admin = new Client({ connectionString: requireTestDatabase() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}
