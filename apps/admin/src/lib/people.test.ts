import { describe, expect, it } from 'vitest'
import { recentlyAuthenticated } from './people.ts'

describe('sensitive account changes', () => {
  it('require a recent authentication event, not merely a refreshed access token', () => {
    const now = 2_000_000
    expect(recentlyAuthenticated(1900, now)).toBe(true)
    expect(recentlyAuthenticated(1000, now)).toBe(false)
    expect(recentlyAuthenticated(undefined, now)).toBe(false)
    expect(recentlyAuthenticated(Number.NaN, now)).toBe(false)
    expect(recentlyAuthenticated(3000, now)).toBe(false)
  })
})
