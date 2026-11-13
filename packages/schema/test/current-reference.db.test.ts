import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { TestDatabase, requireTestDatabase } from './harness.ts'
import { referenceFiles, staleReference } from '../../../scripts/current-sql.mjs'

describe('readable current SQL reference', () => {
  let db: TestDatabase
  beforeAll(async () => {
    db = await TestDatabase.create('current_reference')
  })
  afterAll(async () => {
    await db.close()
  })
  it('matches every generated definition, table/policy/grant catalog and migration checksum from a fresh database', async () => {
    const url = new URL(requireTestDatabase())
    url.pathname = '/' + db.name
    const files = await referenceFiles(url.href)
    const directory = resolve(import.meta.dirname, '../current')
    const stale = staleReference(files, directory)
    for (const file of stale) {
      const expected = resolve(directory, file)
      if (files.has(file) && existsSync(expected))
        expect(files.get(file), `Generated SQL reference differs: ${file}`).toBe(readFileSync(expected, 'utf8'))
    }
    expect(stale).toEqual([])
  })
})
