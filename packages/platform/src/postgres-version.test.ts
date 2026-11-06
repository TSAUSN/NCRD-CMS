import { describe, expect, it } from 'vitest'
import { assertBackupVersion, assertRestoreVersion, postgresMajor } from './postgres-version.ts'
describe('PostgreSQL recovery compatibility', () => {
  it('reads server and client version strings', () => {
    expect(postgresMajor('pg_dump (PostgreSQL) 17.6')).toBe(17)
    expect(postgresMajor('PostgreSQL 17.6 on aarch64-linux')).toBe(17)
    expect(postgresMajor('16.4')).toBe(16)
    expect(() => postgresMajor('unknown')).toThrow()
  })
  it('refuses an older dump client before starting a backup', () => {
    expect(() => assertBackupVersion(17, 16)).toThrow('requires pg_dump 17')
    expect(() => assertBackupVersion(16, 17)).not.toThrow()
  })
  it('refuses a downgrade and a too-old restore client before target mutation', () => {
    expect(() => assertRestoreVersion(17, 17, 16, 17)).toThrow('target was not modified')
    expect(() => assertRestoreVersion(16, 17, 16, 17)).toThrow()
    expect(() => assertRestoreVersion(17, 17, 17, 16)).toThrow()
    expect(() => assertRestoreVersion(16, 16, 17, 17)).not.toThrow()
  })
})
