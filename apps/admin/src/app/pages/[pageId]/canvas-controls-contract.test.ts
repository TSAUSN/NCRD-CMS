import { describe, it, expect } from 'vitest'
import { parseCanvasControls } from './canvas-controls-contract.ts'
import { parseCanvasRichField } from './isolated-canvas-rich-text.ts'
const id = '12345678-1234-4234-8234-123456789012'
const field = {
  id: 'cards',
  kind: 'repeat',
  label: 'Cards',
  constraints: { item: { unit: 'Card', fields: [{ id: 'title', label: 'Title', kind: 'text' }], max: 3 } },
}
const base = () => ({
  sections: [
    { id, version: 1, label: 'Highlights', hidden: false, fields: [field], values: { cards: { items: ['i1', 'i2'] } } },
  ],
  selected: 0,
  slot: 'cards__i1__title',
  listItem: null,
  scale: 0.5,
  canReset: true,
})
describe('isolated canvas display projection', () => {
  it('preserves the exact repeated identity and bounds without source code', () => {
    const parsed = parseCanvasControls(base())!
    expect(parsed.sections[0]).toEqual({
      section_def_id: id,
      section_def_version: 1,
      label: 'Highlights',
      hidden: false,
      values: { cards: { items: ['i1', 'i2'] } },
    })
    expect(parsed.fields[0]).toEqual([field])
    expect(parsed.scale).toBe(0.5)
  })
  it('accepts empty pages and validates list selection against its own binding', () => {
    expect(parseCanvasControls({ ...base(), sections: [], selected: null, slot: null })).not.toBeNull()
    const input = { ...base(), slot: null, listItem: { readerKey: 'speakers', stableKey: 'jane-doe', field: 'cards' } }
    expect(parseCanvasControls(input)).toBeNull()
    input.sections[0]!.fields = [{ id: 'cards', kind: 'repeat', label: 'Speakers' } as typeof field]
    input.sections[0]!.values = { cards: { readerKey: 'speakers' } } as unknown as (typeof input.sections)[0]['values']
    expect(parseCanvasControls(input)?.listItem).toEqual(input.listItem)
  })
  it.each([0, NaN, Infinity, 4.1])('refuses invalid zoom %s', scale =>
    expect(parseCanvasControls({ ...base(), scale })).toBeNull(),
  )
  it('refuses unknown code, duplicate keys, overflow, invalid selection and undeclared values', () => {
    expect(parseCanvasControls({ ...base(), source: '<script>' })).toBeNull()
    for (const items of [['i1', 'i1'], ['i1', 'i2', 'i3', 'i4'], ['../path']]) {
      const input = base()
      input.sections[0]!.values.cards.items = items
      expect(parseCanvasControls(input)).toBeNull()
    }
    expect(parseCanvasControls({ ...base(), selected: 1 })).toBeNull()
    const input = base()
    Object.assign(input.sections[0]!.values, { html: '<script>' })
    expect(parseCanvasControls(input)).toBeNull()
  })
})
describe('isolated rich-text field protocol', () => {
  const field = {
    section: 0,
    slot: 'body',
    occurrence: 0,
    value: '<p>Hello</p>',
    label: 'Body',
    disabled: false,
    x: null,
    y: null,
    constraints: {},
  }
  it('accepts bounded renderer identities and rejects executable/invalid messages', () => {
    expect(parseCanvasRichField(field)).toEqual(field)
    for (const patch of [
      { section: -1 },
      { section: 200 },
      { slot: '"] script' },
      { occurrence: -1 },
      { x: Infinity },
      { value: 'a'.repeat(1_048_576) },
      { source: '<script>' },
    ])
      expect(parseCanvasRichField({ ...field, ...patch })).toBeNull()
  })
})

it('carries only the bounded native-layout display choice and preserves the old imported default', () => {
  expect(parseCanvasControls(base())?.preserveLayout).toBe(false)
  expect(parseCanvasControls({ ...base(), preserveLayout: true })?.preserveLayout).toBe(true)
  for (const flag of ['true', 1, {}, null]) expect(parseCanvasControls({ ...base(), preserveLayout: flag })).toBeNull()
})
