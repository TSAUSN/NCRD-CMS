// Forward-only SQL migrations, each in its own transaction (SPEC §6.15).
//
// Hand-written SQL rather than generated DDL, because the model's real content
// is composite foreign keys, partial unique indexes, row-level policies,
// grants, triggers, and SECURITY DEFINER functions — none of which a schema
// differ round-trips faithfully. `pnpm --filter @cms/schema check:drift` proves
// the Drizzle table definitions still match what these files actually create.
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { prepareMigrationOwnerSchemas } from './owner-preflight.ts'

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

export type AppliedMigration = { name: string; checksum: string; alreadyApplied: boolean }

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16)
}

export async function listMigrations(dir = MIGRATIONS_DIR): Promise<string[]> {
  const entries = await readdir(dir)
  return entries.filter(f => f.endsWith('.sql')).sort()
}

export async function migrate(
  connectionString: string,
  options: {
    dir?: string
    log?: (message: string) => void
    /**
     * Stop after this migration, inclusive.
     *
     * For the upgrade-path test, which has to build a database as it stood at a
     * particular point in history and then migrate it forward. Nothing in the
     * product uses it: a deployment always runs everything.
     */
    through?: string
  } = {},
): Promise<AppliedMigration[]> {
  const dir = options.dir ?? MIGRATIONS_DIR
  const log = options.log ?? (() => {})
  const names = await listMigrations(dir)
  if (options.through !== undefined && !names.includes(options.through)) {
    throw new Error(`requested migration stop ${options.through} does not exist; no migrations were applied`)
  }
  const client = new Client({ connectionString })
  await client.connect()
  const results: AppliedMigration[] = []
  try {
    // Two deploys starting at once must not apply the same file twice. A
    // session lock serializes runners; the second waits, then finds the work done.
    await client.query("SELECT pg_advisory_lock(hashtext('cms-v2:migrations'))")
    await client.query(`
      CREATE TABLE IF NOT EXISTS cms_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`)

    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM cms_migrations')
    const applied = new Map(rows.map(r => [r.name, r.checksum]))

    let reachedLimit = false
    for (const name of names) {
      if (reachedLimit) break
      if (options.through !== undefined && name === options.through) reachedLimit = true
      const sql = await readFile(join(dir, name), 'utf8')
      const sum = checksum(sql)
      // The November review shipped this file with an already-used number.
      // Keep its SQL and recorded checksum immutable while giving fresh installs
      // a unique number. Never rewrite or delete the existing ledger entry.
      const legacyName =
        name === '0207_bounded_css_rule_scanning.sql' ? '0204_bounded_css_rule_scanning.sql' : undefined
      const previous = applied.get(name) ?? (legacyName ? applied.get(legacyName) : undefined)
      if (legacyName && applied.has(legacyName) && applied.get(legacyName) !== sum) {
        throw new Error(
          `migration ${legacyName} was already applied with a different checksum. Migrations are forward-only.`,
        )
      }

      if (previous !== undefined) {
        // An applied migration that changed on disk means history and reality
        // have diverged; that is a deploy-time error, not something to fix up.
        if (previous !== sum) {
          throw new Error(
            `migration ${name} was already applied with checksum ${previous} but is now ${sum}. ` +
              'Migrations are forward-only: add a new file instead of editing an applied one.',
          )
        }
        results.push({ name, checksum: sum, alreadyApplied: true })
        continue
      }

      log(`applying ${name}`)
      await client.query('BEGIN')
      try {
        if (name === '0002_grants_rls.sql') {
          await prepareMigrationOwnerSchemas(client)
          log('prepared NOLOGIN migration owner schema privileges')
        }
        await client.query(sql)
        await client.query('INSERT INTO cms_migrations (name, checksum) VALUES ($1, $2)', [name, sum])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
      results.push({ name, checksum: sum, alreadyApplied: false })
    }
    return results
  } finally {
    await client.end()
  }
}
