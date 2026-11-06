import { expect, it } from 'vitest'
import { readSectionClipboard } from './section-clipboard.ts'
const section = {
  section_def_id: 'layout',
  section_def_version: 2,
  values: { heading: 'An example', __cms_sample_fields: ['heading'] },
  raw_html: '<p>Preserved source</p>',
}
const json = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ userId: 'user', siteId: 'site', copiedAt: 1000, section, ...extra })
it('keeps exact pins, source and sample flags only for the same person and site', () => {
  expect(readSectionClipboard(json(), 'user', 'site', 2000)?.section).toEqual(section)
  expect(readSectionClipboard(json(), 'other', 'site', 2000)).toBeNull()
  expect(readSectionClipboard(json(), 'user', 'other', 2000)).toBeNull()
})
it('refuses expired, future, malformed and oversized copies without changing editor state', () => {
  for (const value of [
    json(),
    json({ copiedAt: 100_000_000 }),
    json({ section: { ...section, values: null } }),
    '{',
    'x'.repeat(2_000_001),
  ])
    expect(readSectionClipboard(value, 'user', 'site', 90_000_000)).toBeNull()
})
