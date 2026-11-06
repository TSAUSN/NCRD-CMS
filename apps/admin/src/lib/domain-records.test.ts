import { expect, it } from 'vitest'
import { recordsText } from './domains.ts'

it('keeps DNS removal instructions distinct from additions when copied for a domain owner', () => {
  expect(
    recordsText([
      { type: 'A', name: 'test.example.org', value: '192.0.2.1', action: 'REMOVE' },
      { type: 'CAA', name: 'test.example.org', value: '0 issue "pki.goog"', action: 'ADD' },
      { type: 'TXT', name: '_cms-verify.test.example.org', value: 'reservation-proof' },
    ]),
  ).toBe(
    'Remove\tA\ttest.example.org\t192.0.2.1\nAdd\tCAA\ttest.example.org\t0 issue "pki.goog"\nAdd\tTXT\t_cms-verify.test.example.org\treservation-proof',
  )
})
