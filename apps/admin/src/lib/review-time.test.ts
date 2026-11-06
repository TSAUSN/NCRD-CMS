import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewTime, reviewDate } from './review-time.ts'

afterEach(() => vi.restoreAllMocks())
describe('review times', () => {
  it.each([
    ['2026-10-29T03:43:41.454Z', 'Oct 28, 2026 · 11:43 PM Eastern time'],
    ['2026-01-01T04:05:00Z', 'Dec 31, 2025 · 11:05 PM Eastern time'],
    ['2026-07-01T04:00:00Z', 'Jul 1, 2026 · 12:00 AM Eastern time'],
    ['2026-03-08T06:59:00Z', 'Mar 8, 2026 · 1:59 AM Eastern time'],
    ['2026-03-08T07:00:00Z', 'Mar 8, 2026 · 3:00 AM Eastern time'],
  ])('keeps the date and daylight-saving boundary explicit for %s', (input, expected) => {
    expect(reviewTime(input)).toBe(expected)
  })
  it('ignores browser-specific literal words and spaces', () => {
    const original = Intl.DateTimeFormat.prototype.formatToParts
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockImplementation(function (
      this: Intl.DateTimeFormat,
      date,
    ) {
      return original.call(this, date).map(part => (part.type === 'literal' ? { ...part, value: ' at\u202f' } : part))
    })
    expect(reviewTime('2026-10-29T03:43:41.454Z')).toBe('Oct 28, 2026 · 11:43 PM Eastern time')
  })
  it('keeps an invalid timestamp readable', () => expect(reviewTime('invalid')).toBe('Time unavailable'))
})

it('keeps recent work on its Eastern date when the hosted server has crossed UTC midnight', () => {
  expect(reviewDate('2026-11-05T02:39:00Z')).toBe('Nov 4')
  expect(reviewDate('2026-11-05T05:00:00Z')).toBe('Nov 5')
  expect(reviewDate('2026-07-01T03:59:00Z')).toBe('Jun 30')
  expect(reviewDate('invalid')).toBe('Date unavailable')
})
