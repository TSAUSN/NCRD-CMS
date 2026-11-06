import { expect, it } from 'vitest'
import { localScheduleTime, localScheduleHint } from './local-schedule-time.ts'
it('uses the future occurrence of a repeated hour and names its offset before submission', () => {
  const later = localScheduleTime('2026-11-01T01:53', 'America/New_York', Date.parse('2026-11-01T05:54:00Z'))!
  expect(later.runAt).toBe('2026-11-01T06:53:00.000Z')
  expect(later.repeated).toBe(true)
  expect(localScheduleHint('2026-11-01T01:53', later)).toContain('EST')
  expect(localScheduleTime('2026-11-01T01:53', 'America/New_York', Date.parse('2026-11-01T05:00:00Z'))?.runAt).toBe(
    '2026-11-01T05:53:00.000Z',
  )
})
it('refuses nonexistent spring times and invalid dates while leaving normal and past times to the existing schedule rules', () => {
  expect(localScheduleTime('2027-03-14T02:30', 'America/New_York')).toBeNull()
  expect(localScheduleTime('2026-02-30T09:00', 'America/New_York')).toBeNull()
  expect(localScheduleTime('bad', 'UTC')).toBeNull()
  expect(localScheduleTime('2026-11-04T09:00', 'America/New_York', Date.parse('2026-11-01T00:00Z'))?.runAt).toBe(
    '2026-11-04T14:00:00.000Z',
  )
  expect(localScheduleTime('2026-01-01T09:00', 'America/New_York', Date.parse('2026-11-01T00:00Z'))?.runAt).toBe(
    '2026-01-01T14:00:00.000Z',
  )
})
it('uses the selected device zone,including a half-hour repeated interval', () => {
  expect(localScheduleTime('2026-04-05T01:45', 'Australia/Lord_Howe', Date.parse('2026-04-04T15:00Z'))?.runAt).toBe(
    '2026-04-04T15:15:00.000Z',
  )
  expect(localScheduleTime('2026-11-04T09:00', 'UTC')?.runAt).toBe('2026-11-04T09:00:00.000Z')
  expect(localScheduleTime('2026-11-04T09:00', 'bad-zone')).toBeNull()
})
