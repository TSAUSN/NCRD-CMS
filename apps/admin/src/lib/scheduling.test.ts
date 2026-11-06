import { expect, it } from 'vitest'
import { scheduleFindingsReviewed, schedulingConfigured } from './scheduling.ts'

it('requires both explicit activation and monitoring readiness', () => {
  expect(schedulingConfigured({})).toBe(false)
  expect(schedulingConfigured({ SCHEDULING_ENABLED: 'true' })).toBe(false)
  expect(schedulingConfigured({ SCHEDULING_ENABLED: 'true', SCHEDULING_MONITORING_READY: 'true' })).toBe(true)
})

it('requires renewed consent when a blocking finding changes before scheduling', () => {
  const seen = { rule: 'broken_internal_link', severity: 'blocking', message: 'Missing page.', detail: '/old' } as const
  expect(scheduleFindingsReviewed([seen], [seen])).toBe(true)
  expect(scheduleFindingsReviewed([seen], undefined)).toBe(false)
  expect(scheduleFindingsReviewed([{ ...seen, detail: '/new' }], [seen])).toBe(false)
  expect(scheduleFindingsReviewed([{ ...seen, severity: 'advisory' }], [])).toBe(true)
})
