import { it, expect } from 'vitest'
import { DataValues, resolveDataValueFields, dataValueText, DataBinding } from './data-values.ts'
const id = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002',
  number = {
    id,
    label: 'Projects',
    value: '152',
    unit: '',
    source: '2026 Annual Report,p.4',
    sourcePageId: null,
    asOf: 'FY2025',
    status: 'matches-report' as const,
  }
it('requires a source,stable unique identities and explicit verification status', () => {
  expect(DataValues.safeParse([number]).success).toBe(true)
  expect(DataValues.safeParse([{ ...number, source: '' }]).success).toBe(false)
  expect(DataValues.safeParse([number, number]).success).toBe(false)
})
it('resolves only supplied site values into text fields and escapes rich text without changing authored fallbacks', () => {
  const values = {
      count: '120',
      body: 'Old text',
      photo: { src: '/owned' },
      __cms_data_values: {
        count: { parts: [{ valueId: id }] },
        body: { parts: [{ text: 'More than ' }, { valueId: id }] },
        photo: { parts: [{ valueId: id }] },
      },
    },
    slots = [
      { id: 'count', kind: 'text' },
      { id: 'body', kind: 'richtext' },
      { id: 'photo', kind: 'image' },
    ]
  const settings = { dataValues: [number] }
  expect(resolveDataValueFields(values, settings, slots)).toMatchObject({
    count: '152',
    body: 'More than 152',
    photo: { src: '/owned' },
  })
  expect(values.count).toBe('120')
  expect(resolveDataValueFields(values, { dataValues: [{ ...number, id: other }] }, slots).count).toBe('120')
  expect(resolveDataValueFields(values, { dataValues: [{ ...number, value: '<b>152</b>' }] }, slots).body).toBe(
    'More than &lt;b&gt;152&lt;/b&gt;',
  )
  expect(resolveDataValueFields(values, { dataValues: [{ ...number, status: 'needs-checking' }] }, slots).count).toBe(
    '152',
  )
})

it('fills an empty stat label and preserves a label reworded on the page', async () => {
  const { numberChoiceValues } = await import('./data-values.ts'),
    binding = { parts: [{ valueId: id }] },
    values = { stats: { items: ['i1'] }, stats__i1__value: '', stats__i1__label: '' },
    first = numberChoiceValues(values, 'stats__i1__value', binding, '152', 'projects')
  expect(first.stats__i1__label).toBe('projects')
  const next = numberChoiceValues(
    { ...first, stats__i1__label: 'Our local projects' },
    'stats__i1__value',
    binding,
    '158',
    'projects',
  )
  expect(next.stats__i1__label).toBe('Our local projects')
  expect(next.stats__i1__value).toBe('158')
})

it('preserves rich paragraphs and emphasis while escaping number substitutions and keeping missing-number fallbacks', () => {
  const binding = {
      format: 'richtext' as const,
      parts: [
        { text: '<p>Across <strong>' },
        { valueId: id },
        { text: '</strong> projects.</p><p>Next paragraph.</p>' },
      ],
    },
    values = { body: '<p>Authored fallback.</p>', __cms_data_values: { body: binding } },
    slots = [{ id: 'body', kind: 'richtext' }],
    saved = { ...number, showSource: false, value: '<img src=x onerror=bad>&152' }
  expect(DataBinding.parse(binding)).toEqual(binding)
  const rich = '<p>Across <strong>&lt;img src=x onerror=bad&gt;&amp;152</strong> projects.</p><p>Next paragraph.</p>'
  expect(resolveDataValueFields(values, { dataValues: [saved] }, slots).body).toBe(rich)
  expect(dataValueText(binding, [saved])).toBe(rich)
  expect(resolveDataValueFields(values, { dataValues: [] }, slots).body).toBe(values.body)
  expect(values.body).toBe('<p>Authored fallback.</p>')
})
