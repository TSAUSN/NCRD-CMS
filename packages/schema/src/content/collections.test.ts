import { describe, expect, it } from 'vitest'
import {
  CollectionDraftBatch,
  CollectionModel,
  collectionEntriesToCsv,
  parseCollectionEntryValues,
  parseCsvRows,
  previewCollectionCsv,
  type CollectionFields,
} from './collections.ts'

const fields = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'role', label: 'Role', type: 'text', required: false },
  { key: 'badge', label: 'Badge', type: 'select', required: false, options: ['Keynote', 'Panelist'] },
  { key: 'portrait', label: 'Portrait', type: 'image', required: false },
  { key: 'featured', label: 'Featured', type: 'boolean', required: false },
] as const satisfies CollectionFields

const model = {
  fields,
  presentation: {
    schemaVersion: 1,
    titleField: 'name',
    subtitleField: 'role',
    imageField: 'portrait',
    groupField: 'badge',
  },
} as const

describe('collection model', () => {
  it('accepts one strict, useful model', () => {
    expect(CollectionModel.parse(model)).toEqual(model)
  })

  it('refuses duplicate keys, duplicate choices and unknown model properties', () => {
    expect(CollectionModel.safeParse({ ...model, fields: [...fields, fields[0]] }).success).toBe(false)
    expect(
      CollectionModel.safeParse({
        ...model,
        fields: [{ key: 'kind', label: 'Kind', type: 'select', required: false, options: ['A', 'A'] }],
        presentation: {
          ...model.presentation,
          titleField: 'kind',
          subtitleField: null,
          imageField: null,
          groupField: null,
        },
      }).success,
    ).toBe(false)
    expect(CollectionModel.safeParse({ ...model, surprise: true }).success).toBe(false)
  })

  it('checks that presentation fields exist and have usable types', () => {
    expect(
      CollectionModel.safeParse({ ...model, presentation: { ...model.presentation, titleField: 'missing' } }).success,
    ).toBe(false)
    expect(
      CollectionModel.safeParse({ ...model, presentation: { ...model.presentation, imageField: 'name' } }).success,
    ).toBe(false)
  })
})

describe('collection entry values', () => {
  it('normalises an entry without making optional fields dirty by absence', () => {
    const parsed = parseCollectionEntryValues(fields, { name: 'Alicia', featured: true })
    expect(parsed).toEqual({
      ok: true,
      values: {
        name: 'Alicia',
        role: '',
        badge: '',
        portrait: '',
        featured: true,
      },
    })
  })

  it('refuses unknown keys and missing required values', () => {
    const parsed = parseCollectionEntryValues(fields, { role: 'Director', typo: 'lost' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok)
      expect(parsed.problems).toEqual(expect.arrayContaining(['Unknown field typo.', 'Name is required.']))
  })

  it('keeps select values closed and images explicit about accessibility', () => {
    expect(parseCollectionEntryValues(fields, { name: 'A', badge: 'Guest' }).ok).toBe(false)
    expect(
      parseCollectionEntryValues(fields, {
        name: 'A',
        portrait: { src: '/media/a/wide', alt: '', decorative: false },
      }).ok,
    ).toBe(false)
    expect(
      parseCollectionEntryValues(fields, {
        name: 'A',
        portrait: { src: '/media/a/wide', alt: '', decorative: true },
      }).ok,
    ).toBe(true)
  })

  it('preserves a bounded focus point while refusing unknown image properties', () => {
    const portrait = { src: '/media/a/wide', alt: '[Photo description]', decorative: false, focal: { x: 0.2, y: 0.8 } }
    const parsed = parseCollectionEntryValues(fields, { name: '[Name]', portrait })
    expect(parsed.ok && parsed.values.portrait).toEqual(portrait)
    for (const focal of [
      { x: -0.1, y: 0.5 },
      { x: 0.5, y: 1.1 },
      { x: NaN, y: 0.5 },
      { x: '0.5', y: 0.5 },
      { x: 0.5 },
      [],
      { x: 0.5, y: 0.5, code: 'x' },
    ])
      expect(parseCollectionEntryValues(fields, { name: '[Name]', portrait: { ...portrait, focal } }).ok).toBe(false)
    expect(parseCollectionEntryValues(fields, { name: '[Name]', portrait: { ...portrait, code: 'x' } }).ok).toBe(false)
  })

  it('refuses active and credentialed URLs in both URL and image fields', () => {
    const urlFields = [{ key: 'website', label: 'Website', type: 'url', required: true }] as const
    for (const value of ['javascript:alert(1)', '//evil.test/x', 'https://user:pass@example.test/']) {
      expect(parseCollectionEntryValues(urlFields, { website: value }).ok).toBe(false)
    }
    expect(parseCollectionEntryValues(urlFields, { website: 'https://example.test/path' }).ok).toBe(true)
  })

  it('uses one strict date and finite-number contract', () => {
    const typed = [
      { key: 'day', label: 'Day', type: 'date', required: true },
      { key: 'capacity', label: 'Capacity', type: 'number', required: true },
    ] as const
    expect(parseCollectionEntryValues(typed, { day: '2026-02-29', capacity: 5 }).ok).toBe(false)
    expect(parseCollectionEntryValues(typed, { day: '2028-02-29', capacity: Infinity }).ok).toBe(false)
    expect(parseCollectionEntryValues(typed, { day: '2028-02-29', capacity: 5 }).ok).toBe(true)
  })
})

describe('collection draft batch', () => {
  it('requires unique stable keys and IDs and accepts a new-entry null ID', () => {
    const id = 'f4e9587b-6ce6-45b0-b9a4-b93e329b269c'
    expect(CollectionDraftBatch.safeParse([{ id: null, stableKey: 'new-speaker', values: {} }]).success).toBe(true)
    expect(
      CollectionDraftBatch.safeParse([
        { id, stableKey: 'one', values: {} },
        { id, stableKey: 'two', values: {} },
      ]).success,
    ).toBe(false)
    expect(
      CollectionDraftBatch.safeParse([
        { id: null, stableKey: 'one', values: {} },
        { id: null, stableKey: 'one', values: {} },
      ]).success,
    ).toBe(false)
  })
})

describe('collection CSV', () => {
  it('parses quoted commas, quotes and line breaks', () => {
    expect(parseCsvRows('a,b\r\n"one, two","say ""hi"""\r\n"line\nwrap",x\r\n')).toEqual([
      ['a', 'b'],
      ['one, two', 'say "hi"'],
      ['line\nwrap', 'x'],
    ])
  })

  it('round-trips typed rows and reversibly guards spreadsheet formulas', () => {
    const csvFields = [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'count', label: 'Count', type: 'number', required: true },
      { key: 'active', label: 'Active', type: 'boolean', required: false },
    ] as const
    const entries = [
      { name: '=HYPERLINK("https://evil.test")', count: 3, active: true },
      { name: "'=a real apostrophe", count: 4, active: false },
    ]
    const csv = collectionEntriesToCsv(csvFields, entries)
    expect(csv).toContain("'=HYPERLINK")
    expect(previewCollectionCsv(csvFields, csv)).toEqual({ rows: entries, problems: [] })
  })

  it('dry-runs all rows and reports structural and value problems without partial mutation', () => {
    const preview = previewCollectionCsv(
      fields,
      ['name,role,badge,portrait,featured', 'Valid,Leader,Keynote,,true', 'Bad,Leader,Unknown,,false'].join('\n'),
    )
    expect(preview.rows).toHaveLength(1)
    expect(preview.problems).toEqual([{ row: 3, messages: ['Badge must use one of its configured choices.'] }])
    expect(previewCollectionCsv(fields, 'name,extra\nA,x').problems[0]?.messages).toEqual(
      expect.arrayContaining([expect.stringContaining('Unknown headers'), expect.stringContaining('Missing headers')]),
    )
  })
})
