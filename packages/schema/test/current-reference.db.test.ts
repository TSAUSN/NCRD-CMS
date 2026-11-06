import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
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
    expect(staleReference(files, resolve(import.meta.dirname, '../current'))).toEqual([])
  })
})
