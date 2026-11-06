import { expect, it } from 'vitest'
import { inboxCount } from './inbox.ts'

it('counts every inbox category without treating a loaded page of rows as the total', () => {
  expect(inboxCount({ reviews: 5, requests: 7, operations: 130 })).toBe(142)
  expect(inboxCount({ reviews: 0, requests: 0, operations: 0 })).toBe(0)
})
