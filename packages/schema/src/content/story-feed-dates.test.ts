import { it, expect } from 'vitest'
import { storyDateInFeed } from './stories.ts'
import { StructuredRepeatBinding } from './structured.ts'
it('uses clamped UTC calendar months and excludes missing, invalid and future dates', () => {
  expect(storyDateInFeed('2025-09-30', new Date('2026-10-31T23:59:59Z'))).toBe(true)
  expect(storyDateInFeed('2025-09-30', new Date('2026-11-01T00:00:00Z'))).toBe(false)
  expect(storyDateInFeed('2024-01-31', new Date('2025-02-28T12:00:00Z'))).toBe(true)
  expect(storyDateInFeed('2024-01-31', new Date('2025-03-01T00:00:00Z'))).toBe(false)
  for (const date of [null, '', '2026-02-30', '2026-11-01'])
    expect(storyDateInFeed(date, new Date('2026-10-31T23:59:59Z'))).toBe(false)
})
it('keeps automatic Stories on the story date/13-month rule while other readers keep their date choices', () => {
  const selection = { mode: 'automatic', limit: 6, dateField: 'published_date', maxAgeMonths: 13 }
  expect(StructuredRepeatBinding.safeParse({ readerKey: 'stories', selection }).success).toBe(true)
  for (const changed of [
    { ...selection, maxAgeMonths: 24 },
    { ...selection, dateField: 'another_date' },
  ])
    expect(StructuredRepeatBinding.safeParse({ readerKey: 'stories', selection: changed }).success).toBe(false)
  expect(
    StructuredRepeatBinding.safeParse({
      readerKey: 'events',
      selection: { ...selection, maxAgeMonths: 24, dateField: 'event_date' },
    }).success,
  ).toBe(true)
  expect(
    StructuredRepeatBinding.safeParse({
      readerKey: 'stories',
      selection: { mode: 'manual', stableKeys: ['archive-story'] },
    }).success,
  ).toBe(true)
})
