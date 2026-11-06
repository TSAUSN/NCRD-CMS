import { test, expect } from 'vitest'
import { annualReportTemplate } from './report-template.ts'
import { CORE_LIBRARY } from './core-library.ts'
const definitions = CORE_LIBRARY.map((entry, index) => ({
  id: 'definition-' + index,
  version: 1,
  name: entry.definition.name,
  slug: entry.definition.slug,
}))
test('report assembly pins ordinary shared fields without sample copy or page HTML', () => {
  const content = annualReportTemplate(definitions, [
    { part: 'cover', band: 'cover', values: { heading: '[Year]', photo: '' } },
    {
      part: 'country',
      band: 'disaster',
      values: { heading: '[Section]', body: '<p>[Approved copy]</p>', layout: 'reading' },
    },
  ])
  expect(content).toHaveLength(2)
  expect(content[0]!.values.primary).toEqual({ url: '', label: '' })
  expect(content[1]!.values.stats).toEqual({ items: [] })
  expect(content[1]!.values.body).toBe('<p>[Approved copy]</p>')
  expect(content[1]!.custom_css).toBeUndefined()
  expect(content[1]!.values.__cms_report_part).toBe('country')
  expect(() => annualReportTemplate(definitions, [{ part: 'country', band: 'disaster', values: {} }])).toThrow('cover')
})
