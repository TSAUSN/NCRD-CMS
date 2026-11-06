import { it, expect } from 'vitest'
import { heroEasternInput, heroEasternValue } from './hero-eastern-time.ts'
it('keeps Eastern slide times across both daylight-saving changes and includes the end minute', () => {
  expect(heroEasternValue('2026-10-31T09:00')).toBe('2026-10-31T13:00:00.000Z')
  expect(heroEasternValue('2026-11-04T09:00')).toBe('2026-11-04T14:00:00.000Z')
  expect(heroEasternValue('2026-03-08T02:30')).toBe('2026-03-08T02:30')
  expect(heroEasternValue('2026-11-01T01:30')).toBe('2026-11-01T05:30:00.000Z')
  const end = heroEasternValue('2026-12-31T23:59', true)
  expect(end).toBe('2027-01-01T05:00:00.000Z')
  expect(heroEasternInput(end, true)).toBe('2026-12-31T23:59')
})
