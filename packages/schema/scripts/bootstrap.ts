// One command to get a usable local database: apply the migrations, then
// create the local login users for the four identities. Mirrors what an
// operator does by hand on a hosted project (SPEC §12, V2-SETUP-03).
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { migrate } from '../src/migrate/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const url = process.env['DATABASE_URL']
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

// A named local database that does not exist yet is created first, so one
// command takes an empty Postgres to a usable CMS database (`pnpm demo` uses
// its own database beside cms_dev).
const target = new URL(url)
const name = decodeURIComponent(target.pathname.slice(1))
if (name && name !== 'postgres') {
  const maintenance = new URL(url)
  maintenance.pathname = '/postgres'
  const admin = new Client({ connectionString: maintenance.toString() })
  await admin.connect()
  try {
    // `--drop-only` removes the database and stops: `pnpm demo --reset` uses it.
    if (process.argv.includes('--drop-only')) {
      if (name === 'cms_dev' || name.startsWith('cms_prod')) throw new Error(`refusing to drop ${name}`)
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [name],
      )
      await admin.query(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}"`)
      console.log(`dropped database ${name}`)
      process.exit(0)
    }
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`)
      console.log(`created database ${name}`)
    }
  } finally {
    await admin.end()
  }
}

const results = await migrate(url, { log: m => console.log(m) })
console.log(`migrations: ${results.filter(r => !r.alreadyApplied).length} applied, ${results.length} total`)

const client = new Client({ connectionString: url })
await client.connect()
try {
  await client.query(await readFile(join(here, 'local-roles.sql'), 'utf8'))
  console.log('local login roles: cms_admin_app, cms_site_app, cms_worker_app')
} finally {
  await client.end()
}
