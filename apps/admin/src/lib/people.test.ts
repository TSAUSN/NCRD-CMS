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

  it('keeps 15 minutes by default and accepts a longer window only where a caller asks for it', () => {
    const now = 10_000_000
    const signedIn = (minutesAgo: number) => now / 1000 - minutesAgo * 60
    expect(recentlyAuthenticated(signedIn(16), now)).toBe(false)
    expect(recentlyAuthenticated(signedIn(89), now, 90)).toBe(true)
    expect(recentlyAuthenticated(signedIn(91), now, 90)).toBe(false)
  })
})
