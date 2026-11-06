import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, requireTestDatabase } from './harness.ts'
import { migrate } from '../src/migrate/index.ts'
let db: TestDatabase
let url: string
const current = '0207_bounded_css_rule_scanning.sql'
const shipped = '0204_bounded_css_rule_scanning.sql'
beforeAll(async () => {
  db = await TestDatabase.create('migration_alias')
  const base = new URL(requireTestDatabase())
  base.pathname = '/' + db.name
  url = base.href
  await db.as('owner', c => c.query('UPDATE cms_migrations SET name=$1 WHERE name=$2', [shipped, current]))
})
afterAll(async () => {
  await db?.close()
})
it('recognizes the exact shipped checksum without rerunning SQL or rewriting its ledger name', async () => {
  const results = await migrate(url)
  expect(results.find(row => row.name === current)?.alreadyApplied).toBe(true)
  const names = await db.as('owner', c =>
    c.query('SELECT name FROM cms_migrations WHERE name=ANY($1)', [[current, shipped]]),
  )
  expect(names.rows).toEqual([{ name: shipped }])
})
it('refuses a changed legacy checksum rather than trusting the filename alias', async () => {
  await db.as('owner', c => c.query("UPDATE cms_migrations SET checksum='changed' WHERE name=$1", [shipped]))
  await expect(migrate(url)).rejects.toThrow('different checksum')
})
