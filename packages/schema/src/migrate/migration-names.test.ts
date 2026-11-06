import { describe, expect, it } from 'vitest'
import { listMigrations } from './index.ts'

// Migrations apply in file-name order and are tracked by full name. A repeated
// number still applies, but it hides which change came first. The two 0201
// files were both applied before this check existed; never rename them.
const ALREADY_SHIPPED_DUPLICATES = new Set(['0201'])

describe('migration file names', () => {
  it('number each new migration uniquely', async () => {
    const names = await listMigrations()
    expect(names.every(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))).toBe(true)
    const counts = new Map<string, number>()
    for (const name of names) counts.set(name.slice(0, 4), (counts.get(name.slice(0, 4)) ?? 0) + 1)
    const repeated = [...counts].filter(([number, count]) => count > 1 && !ALREADY_SHIPPED_DUPLICATES.has(number))
    expect(repeated).toEqual([])
  })
})
