import { expect, it } from 'vitest'
import { trackedLinkUrl, validTrackingCode } from './tracked-link.ts'
it('adds tracking without losing a destination, existing query or fragment', () => {
  expect(trackedLinkUrl('https://give.sawso.org/?form=main#give', 'utm_source=chapter&utm_campaign=fall')).toBe(
    'https://give.sawso.org/?form=main&utm_source=chapter&utm_campaign=fall#give',
  )
  expect(trackedLinkUrl('/give?utm_source=old#form', '?utm_source=site')).toBe('/give?utm_source=site#form')
  expect(trackedLinkUrl('/give', '')).toBe('/give')
})
it('rejects malformed tracking and never creates a new origin or unsafe scheme', () => {
  for (const value of ['https://evil.example', '?next=#x', 'utm source=x', 'x=y\\z', 'x='.repeat(600)])
    expect(validTrackingCode(value)).toBe(false)
  expect(trackedLinkUrl('javascript:alert(1)', 'x=y')).toBe('javascript:alert(1)')
  expect(trackedLinkUrl('https://give.sawso.org', 'next=https%3A%2F%2Fevil.example')).toBe(
    'https://give.sawso.org/?next=https%3A%2F%2Fevil.example',
  )
})

it('preserves email and phone destinations without attaching website tracking', () => {
  expect(trackedLinkUrl('mailto:hello@example.test', 'utm_source=site')).toBe('mailto:hello@example.test')
  expect(trackedLinkUrl('tel:+1-202-555-0100', 'utm_source=site')).toBe('tel:+1-202-555-0100')
})
