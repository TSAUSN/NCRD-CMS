// The migrations are hand-written SQL; the Drizzle tables are the typed access
// layer. Nothing generates one from the other, so this compares them against
// the live database and fails the moment they disagree.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { isTable } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { TestDatabase } from './harness.ts'
import * as tables from '../src/db/index.ts'

let db: TestDatabase
beforeAll(async () => {
  db = await TestDatabase.create('drift')
})
afterAll(async () => {
  await db?.close()
})

type AnyTable = Parameters<typeof getTableConfig>[0]

function drizzleTables(): AnyTable[] {
  // The module exports enums as well as tables; only tables have a config.
  return Object.values(tables).filter(isTable) as unknown as AnyTable[]
}

it('every Drizzle table exists in the migrated database with the same columns', async () => {
  const live = await db.as('owner', c =>
    c.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public'`,
    ),
  )

  const liveByTable = new Map<string, Map<string, boolean>>()
  for (const row of live.rows) {
    if (!liveByTable.has(row.table_name)) liveByTable.set(row.table_name, new Map())
    liveByTable.get(row.table_name)!.set(row.column_name, row.is_nullable === 'YES')
  }

  const problems: string[] = []
  for (const table of drizzleTables()) {
    const config = getTableConfig(table)
    const liveColumns = liveByTable.get(config.name)
    if (!liveColumns) {
      problems.push(`table ${config.name} is declared in Drizzle but absent from the database`)
      continue
    }
    for (const column of config.columns) {
      if (!liveColumns.has(column.name)) {
        problems.push(`${config.name}.${column.name} is declared in Drizzle but absent from the database`)
        continue
      }
      const liveNullable = liveColumns.get(column.name)!
      if (liveNullable === column.notNull) {
        problems.push(
          `${config.name}.${column.name} nullability disagrees: database ${liveNullable ? 'NULL' : 'NOT NULL'}, ` +
            `Drizzle ${column.notNull ? 'NOT NULL' : 'NULL'}`,
        )
      }
    }
  }
  expect(problems).toEqual([])
})

it('every migrated column is declared in Drizzle — no column is reachable only by raw SQL', async () => {
  // The other direction of the same claim, and the one that was missing.
  // 0009 added outbox.lease_token and scheduled_actions.lease_token, neither
  // was ever declared here, and nothing complained — a column existed, was
  // granted to two roles, and was invisible to the typed layer that is supposed
  // to be the map of this schema.
  const live = await db.as('owner', c =>
    c.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'cms_migrations'`,
    ),
  )

  const declared = new Map(
    drizzleTables().map(t => {
      const config = getTableConfig(t)
      return [config.name, new Set(config.columns.map(c => c.name))]
    }),
  )

  const undeclared = live.rows
    .filter(row => declared.has(row.table_name) && !declared.get(row.table_name)!.has(row.column_name))
    .map(row => `${row.table_name}.${row.column_name}`)
  expect(undeclared).toEqual([])
})

it('every migrated table is declared in Drizzle — no table is reachable only by raw SQL', async () => {
  const live = await db.as('owner', c =>
    c.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name <> 'cms_migrations'`,
    ),
  )
  const declared = new Set(drizzleTables().map(t => getTableConfig(t).name))
  const missing = live.rows.map(r => r.table_name).filter(name => !declared.has(name))
  expect(missing).toEqual([])
})

it('every table in public has row-level security enabled', async () => {
  const { rows } = await db.as('owner', c =>
    c.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname <> 'cms_migrations' AND NOT c.relrowsecurity`,
    ),
  )
  expect(rows.map(r => r.relname)).toEqual([])
})

it('every SECURITY DEFINER function pins its search_path', async () => {
  const { rows } = await db.as('owner', c =>
    c.query<{ name: string }>(
      `SELECT n.nspname || '.' || p.proname AS name
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'public_api') AND p.prosecdef
          AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) cfg
                          WHERE cfg LIKE 'search\\_path=%')`,
    ),
  )
  expect(rows.map(r => r.name)).toEqual([])
})

it('every application function belongs to the named migration owner', async () => {
  const { rows } = await db.as('owner', c =>
    c.query<{ name: string; owner: string }>(
      `SELECT p.oid::regprocedure::text AS name, owner.rolname AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles owner ON owner.oid = p.proowner
        WHERE n.nspname IN ('app', 'public_api')
          AND owner.rolname <> 'cms_migration_owner'
        ORDER BY 1`,
    ),
  )
  expect(rows).toEqual([])
})
