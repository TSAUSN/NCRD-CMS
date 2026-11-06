import { expect, it } from 'vitest'
import { contentCounts, contentCountsForPages } from './content-counts.ts'
it('uses the same separate page and story totals in every workspace', () => {
  expect(contentCounts(15, 34)).toBe('15 pages · 34 stories')
  expect(contentCounts(1, 1)).toBe('1 page · 1 story')
  expect(contentCounts(0)).toBe('0 pages')
})

it('separates stories in the header and footer destination inventory', () => {
  expect(
    contentCountsForPages([
      ...Array.from({ length: 15 }, () => ({ kind: 'page' })),
      ...Array.from({ length: 34 }, () => ({ kind: 'story' })),
    ]),
  ).toBe('15 pages · 34 stories')
  expect(contentCountsForPages([{}])).toBe('1 page')
  expect(contentCountsForPages([])).toBe('0 pages')
})
