// Build one migrated template for each suite, then clone it per test file.
import { Client } from 'pg'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from '../src/migrate/index.ts'
import { TEMPLATE_DB, requireTestDatabase } from './harness.ts'

export async function setup(): Promise<() => Promise<void>> {
  const template = new URL(requireTestDatabase())
  const maintenance = new URL(template)
  // Advisory locks are scoped to one database. All suites on this cluster
  // must coordinate in the same database, even if their URLs differ.
  maintenance.pathname = '/postgres'
  template.pathname = '/' + TEMPLATE_DB

  const admin = new Client({ connectionString: maintenance.toString() })
  await admin.connect()
  try {
    // Keep this session open until teardown. A concurrent suite or inventory
    // must wait before replacing the template or cleaning up orphaned clones.
    await admin.query("SELECT pg_advisory_lock(hashtextextended('cms.database-policy-tests', 0))")
    const stale = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname ~ '^cms_t_[a-z0-9_]{0,20}_[0-9a-f]{8}$'",
    )
    for (const row of stale.rows) await admin.query(`DROP DATABASE IF EXISTS ${row.datname} WITH (FORCE)`)
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`)

    await migrate(template.toString())
    const roles = new Client({ connectionString: template.toString() })
    await roles.connect()
    try {
      const here = dirname(fileURLToPath(import.meta.url))
      await roles.query(await readFile(join(here, '..', 'scripts', 'local-roles.sql'), 'utf8'))
    } finally {
      await roles.end()
    }

    return async () => {
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`)
      } finally {
        await admin.end()
      }
    }
  } catch (error) {
    // A failed or interrupted suite leaves its database for the next owner
    // to clean up. Closing this session releases its lock.
    await admin.end()
    throw error
  }
}
