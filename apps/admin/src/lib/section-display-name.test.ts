import { expect, it } from 'vitest'
import { sectionDisplayName } from './section-display-name.ts'
const layout = { name: 'Split hero', slots: [{ id: 'heading', kind: 'text', label: 'Heading' }] }
it('uses heading text for default names, while keeping an explicit personal name', () => {
  expect(sectionDisplayName({ label: 'Split hero', values: { heading: 'Better Together 2027' } }, layout)).toBe(
    'Split hero — Better Together 2027',
  )
  expect(sectionDisplayName({ label: 'Welcome', values: { heading: 'Better Together 2027' } }, layout)).toBe('Welcome')
})
it('handles missing headings, empty sections and long content as plain text', () => {
  expect(sectionDisplayName({ values: {} }, layout)).toBe('Split hero')
  expect(sectionDisplayName({}, null)).toBe('Section')
  expect(sectionDisplayName({ values: { heading: '<b>Meet</b>  our team' } }, layout)).toBe(
    'Split hero — Meet our team',
  )
})

it('names the opening feature slider for its page role while keeping deliberate names', () => {
  const hero = { ...layout, slug: 'core-feature-slider', name: 'Feature slider' }
  expect(sectionDisplayName({ label: 'Featured stories', values: { heading: 'Hidden page heading' } }, hero)).toBe(
    'Hero slider',
  )
  expect(sectionDisplayName({ label: 'Seasonal appeal' }, hero)).toBe('Seasonal appeal')
})

it('does not repeat a type whose heading differs only in case or spacing', () => {
  expect(
    sectionDisplayName(
      { label: 'Financial summary', values: { heading: ' FINANCIAL   SUMMARY ' } },
      { ...layout, name: 'Financial summary' },
    ),
  ).toBe('Financial summary')
})
it('skips empty headings and uses a later title', () => {
  expect(
    sectionDisplayName(
      { values: { heading: '', title: 'Our people' } },
      { ...layout, slots: [...layout.slots, { id: 'title', kind: 'text', label: 'Title' }] },
    ),
  ).toBe('Split hero — Our people')
})
it('distinguishes repeated report stories by country or their own story title', () => {
  const country = { ...layout, slug: 'core-report-country-story', name: 'Country story with stats' }
  expect(
    sectionDisplayName(
      { label: country.name, values: { heading: 'Relief', country: 'Jamaica', title: 'Rebuilding lives' } },
      country,
    ),
  ).toBe('Country story — Jamaica')
  expect(
    sectionDisplayName({ label: country.name, values: { heading: '', title: 'A long walk for water' } }, country),
  ).toBe('Country story — A long walk for water')
  expect(
    sectionDisplayName({ label: country.name, values: { __cms_report_part: 'fact', title: 'Did you know?' } }, country),
  ).toBe('Did you know?')
  expect(sectionDisplayName({ label: 'My field story', values: { country: 'Jamaica' } }, country)).toBe(
    'My field story',
  )
  expect(sectionDisplayName({ label: 'Country story', values: { country: 'Rwanda' } }, country)).toBe(
    'Country story — Rwanda',
  )
})

it('uses readable navigation case for capitalized report typography without changing the source', () => {
  const values = { country: 'JAMAICA', title: 'A LONG WALK FOR WATER: ASHOYA’S STORY' },
    country = { ...layout, slug: 'core-report-country-story', name: 'Country story with stats' }
  expect(sectionDisplayName({ values }, country)).toBe('Country story — Jamaica')
  expect(sectionDisplayName({ values: { ...values, country: '' } }, country)).toBe(
    'Country story — A Long Walk for Water: Ashoya’s Story',
  )
  expect(values.country).toBe('JAMAICA')
})
