import { it, expect } from 'vitest'
import {
  calendarDay,
  calendarMonth,
  validStoryDay,
  readyUndatedStories,
  type StoryCalendarJob,
} from './story-calendar.ts'
import type { StoryListRow } from './story-list.ts'
it('shows every real month day including leap years, with Monday first and no invalid dates', () => {
  expect(calendarMonth('2026-11').slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01'])
  expect(calendarMonth('2028-02').filter(Boolean)).toHaveLength(29)
  for (const day of ['2026-02-29', '2026-04-31', '2026-00-10', '2026-13-01', 'not-a-day', '2026-1-01', '2201-01-01'])
    expect(validStoryDay(day)).toBe(false)
  expect(validStoryDay('2028-02-29')).toBe(true)
  expect(calendarMonth('bad')).toEqual([])
})
it('uses the device zone for scheduled days across midnight and daylight saving time', () => {
  expect(calendarDay(new Date('2026-11-01T03:30:00Z'), 'America/New_York')).toBe('2026-10-31')
  expect(calendarDay(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe('2026-11-01')
  expect(calendarDay(new Date('2026-11-01T03:30:00Z'), 'Asia/Tokyo')).toBe('2026-11-01')
})
it('ready means unpublished, reviewed, undated and complete; hidden, removed and queued stories stay out', () => {
  const row: StoryListRow = {
    id: 'ready',
    stableKey: 'ready',
    values: {
      title: '[Story]',
      summary: '[Description]',
      photo: { src: '/photo', alt: '[Description]' },
      reviewed: true,
    },
    published: null,
    changed: true,
    hasText: true,
    photoPreview: null,
  }
  expect(readyUndatedStories([row], [])).toEqual([row])
  for (const values of [
    { reviewed: false },
    { hidden: true },
    { feed_removed: true },
    { in_feed: false },
    { published_date: '2026-11-02' },
    { summary: '' },
    { photo: null },
  ])
    expect(readyUndatedStories([{ ...row, values: { ...row.values, ...values } }], [])).toEqual([])
  expect(readyUndatedStories([{ ...row, hasText: false }], [])).toEqual([])
  expect(readyUndatedStories([{ ...row, published: { title: '[Old]' } }], [])).toEqual([])
  const job: StoryCalendarJob = {
    id: 'job',
    entryId: 'ready',
    title: '[Story]',
    runAt: '2026-11-02T14:00:00Z',
    status: 'pending',
    releaseId: 'release',
  }
  expect(readyUndatedStories([row], [job])).toEqual([])
  expect(readyUndatedStories([row], [{ ...job, status: 'failed' }])).toEqual([row])
})
