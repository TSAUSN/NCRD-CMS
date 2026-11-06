import { it, expect } from 'vitest'
import { storySourceStatusLine } from './story-source-status.ts'
import type { StorySourceCheck } from './story-source-check.ts'
const check = (time: string, status: StorySourceCheck['status'] = 'ok'): StorySourceCheck => ({
  id: 'test',
  status,
  started_at: time,
  finished_at: time,
  result: {},
})
it.each([
  ['2026-07-03T16:10:00Z', 'Jul 3, 2026 · 12:10 PM Eastern time'],
  ['2026-11-03T16:10:00Z', 'Nov 3, 2026 · 11:10 AM Eastern time'],
])('shows the Story feed clock in Eastern time across daylight saving (%s)', (time, label) => {
  expect(storySourceStatusLine('sawso', { latest: check(time), lastSuccessAt: time })).toBe('Feed checked ' + label)
  expect(storySourceStatusLine('sawso', { latest: check(time, 'error'), lastSuccessAt: time })).toBe(
    'Feed check failed · last successful check ' + label,
  )
})
it('keeps missing and invalid timestamps plain without changing check behavior', () => {
  expect(storySourceStatusLine('sawso', { latest: null, lastSuccessAt: null })).toBe('Feed not checked yet')
  expect(storySourceStatusLine('sawso', { latest: check('invalid'), lastSuccessAt: null })).toBe(
    'Feed checked at an unknown time',
  )
})
