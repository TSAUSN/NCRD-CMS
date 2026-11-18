import { describe, expect, it } from 'vitest'
import { RECENT_SIGN_IN_MINUTES, recentlyAuthenticated } from './people.ts'

describe('sensitive account changes', () => {
  it('require a recent authentication event, not merely a refreshed access token', () => {
    const now = 10_000_000
    expect(recentlyAuthenticated(9900, now)).toBe(true)
    expect(recentlyAuthenticated(4000, now)).toBe(false)
    expect(recentlyAuthenticated(undefined, now)).toBe(false)
    expect(recentlyAuthenticated(Number.NaN, now)).toBe(false)
    expect(recentlyAuthenticated(10_100, now)).toBe(false)
  })

  it('accepts a sign-in from the last 90 minutes across the CMS', () => {
    const now = 10_000_000
    const signedIn = (minutesAgo: number) => now / 1000 - minutesAgo * 60
    expect(RECENT_SIGN_IN_MINUTES).toBe(90)
    expect(recentlyAuthenticated(signedIn(89), now)).toBe(true)
    expect(recentlyAuthenticated(signedIn(91), now)).toBe(false)
  })
})
