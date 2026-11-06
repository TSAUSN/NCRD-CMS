import { describe, expect, it } from 'vitest'
import { poolSizeFor } from './database.ts'

describe('database pool size', () => {
  it('keeps the existing defaults when nothing is configured', () => {
    expect(poolSizeFor('public', {})).toBe(10)
    expect(poolSizeFor('authenticated', {})).toBe(5)
    expect(poolSizeFor('worker', { DATABASE_POOL_MAX: '' })).toBe(5)
  })

  it('lets a service lower its pool for a small hosted database', () => {
    expect(poolSizeFor('public', { DATABASE_POOL_MAX: '3' })).toBe(3)
  })

  it('refuses a value that is not a sensible connection count', () => {
    for (const value of ['0', '-1', '2.5', 'ten', '51']) {
      expect(() => poolSizeFor('public', { DATABASE_POOL_MAX: value })).toThrow(/DATABASE_POOL_MAX/)
    }
  })
})
