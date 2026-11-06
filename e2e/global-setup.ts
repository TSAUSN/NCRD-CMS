// Build the e2e database from scratch before the browsers start: migrate,
// create the login roles, seed through the real commands. Rebuilding rather
// than reusing means a spec never inherits state from a previous run, and a
// failure is always reproducible from an empty database.
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { migrate } from '@cms/schema/migrate'
import { e2eTarget } from './test-target.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

const { database: DB, host: HOST, port: PORT } = e2eTarget()
const adminUrl = `postgres://cms:cms@${HOST}:${PORT}/postgres`
const databaseUrl = `postgres://cms:cms@${HOST}:${PORT}/${DB}`

export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${DB}`)
  } finally {
    await admin.end()
  }

  await migrate(databaseUrl)

  const roles = new Client({ connectionString: databaseUrl })
  await roles.connect()
  try {
    await roles.query(await readFile(join(repo, 'packages/schema/scripts/local-roles.sql'), 'utf8'))
  } finally {
    await roles.end()
  }

  // Seeding runs the real command surface, so a broken command fails the run
  // here rather than halfway through a spec.
  execFileSync('pnpm', ['--filter', '@cms/seeds', 'seed'], {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })
}
