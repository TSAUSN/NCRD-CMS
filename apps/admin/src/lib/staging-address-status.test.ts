import { expect, it } from 'vitest'
import { stagingAddressStatusLabel } from './domains.ts'
it('keeps local previews distinct from ready, pending and failed hosted test addresses', () => {
  expect(stagingAddressStatusLabel('demo.staging.localhost', 'ready')).toBe('Local preview')
  expect(stagingAddressStatusLabel('review.web.app', 'ready')).toBe('Ready')
  expect(stagingAddressStatusLabel('review.web.app', 'preparing')).toBe('Preparing')
  expect(stagingAddressStatusLabel('review.web.app', 'error')).toBe('Needs attention')
  expect(stagingAddressStatusLabel('review.web.app', 'unavailable')).toBe('Not prepared')
})
