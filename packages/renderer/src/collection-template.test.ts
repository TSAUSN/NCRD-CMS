import { describe, it, expect } from 'vitest'
import { compileSection } from './compile.ts'
import { renderSection } from './render.ts'
const schemaId = '22222222-2222-4222-a222-222222222222',
  collectionId = '11111111-1111-4111-a111-111111111111'
const slots = [
  {
    id: 'workshops',
    kind: 'repeat' as const,
    label: 'Workshops',
    constraints: {
      collection: true,
      item: {
        unit: 'Workshop',
        fields: [
          { id: 'title', kind: 'text', label: 'Title' },
          { id: 'presenter', kind: 'text', label: 'Presenter' },
        ],
      },
    },
  },
]
const source =
  '<div class="original"><table data-toggle="table"><tbody>{{#workshops}}<tr><th>{{title}}</th><td>{{presenter}}</td></tr>{{/workshops}}</tbody></table></div>'
const fields = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'presenter', label: 'Presenter', type: 'text', required: false },
]
function envelope(count = 2) {
  return {
    kind: 'collection',
    collectionId,
    readerKey: 'workshops',
    publishedSchemaVersionId: schemaId,
    publishedSchemaRevision: '1',
    publishedEntryRevision: '1',
    schemas: [{ id: schemaId, revision: '1', fields: structuredClone(fields) }],
    entries: Array.from({ length: count }, (_, i) => ({
      id: `33333333-3333-4333-a333-${String(i).padStart(12, '0')}`,
      stableKey: 'workshop-' + i,
      schemaVersionId: schemaId,
      values: { title: 'Workshop ' + i, presenter: 'Presenter ' + i },
    })),
  }
}
const compiled = compileSection({ sourceHtml: source, slots })
function render(raw: unknown, preview = false) {
  return renderSection(
    {
      def: { section_def_id: collectionId, version: 1, compiled_ast: compiled.ast, slots },
      instance: { section_def_id: collectionId, section_def_version: 1, values: { workshops: raw } },
    },
    0,
    { preview },
  )
}
describe('native Lists in original repeat markup', () => {
  it('renders exact SSR table rows without adding wrappers or changing data attributes', () => {
    expect(compiled.blocking).toEqual([])
    const html = render(envelope())
    expect(html).toContain(
      '<table data-toggle="table"><tbody><tr><th>Workshop 0</th><td>Presenter 0</td></tr><tr><th>Workshop 1</th><td>Presenter 1</td></tr></tbody></table>',
    )
    expect(html).not.toMatch(/cms-bound-list|data-cms-entry|<cms-slot/)
    expect(render(envelope(0))).toContain('<tbody></tbody>')
  })
  it('marks the actual tbody and row in preview, so browsers cannot foster-parent a wrapper', () => {
    const html = render(envelope(), true)
    expect(html).toContain(
      '<tbody data-cms-slot="workshops" data-cms-kind="repeat" data-cms-list="' +
        collectionId +
        '" data-cms-reader="workshops">',
    )
    expect(html).toContain(
      '<tr data-cms-entry="workshop-0" data-cms-reader="workshops" data-cms-list-field="workshops"><th>Workshop 0</th>',
    )
    expect(html).not.toMatch(/<cms-slot|cms-bound-list/)
    expect(render(envelope(0), true)).toContain('data-cms-list="' + collectionId + '"')
  })
  it('uses typed entry parsing and escapes text instead of accepting projected HTML or incompatible fields', () => {
    const value = envelope(1)
    value.entries[0]!.values.title = '<img src=x onerror=alert(1)>'
    expect(render(value)).toContain('&lt;img src=x onerror=alert(1)&gt;')
    const wrong = envelope(1)
    wrong.schemas[0]!.fields[0]!.type = 'richtext'
    expect(render(wrong)).not.toContain('<tr>')
    expect(render({ readerKey: 'workshops', selection: { mode: 'automatic', limit: 20 } })).not.toContain('<tr>')
  })
  it('renders all125 source workshops and refuses an over-limit projected envelope', () => {
    expect(render(envelope(125)).match(/<tr>/g) ?? []).toHaveLength(125)
    expect(render(envelope(201))).not.toContain('<tr>')
  })
  it('blocks unused native item fields so compiler and publication agree', () => {
    const extended = slots.map(slot => ({
      ...slot,
      constraints: {
        ...slot.constraints,
        item: {
          ...slot.constraints.item,
          fields: [...slot.constraints.item.fields, { id: 'unused', kind: 'text' as const, label: 'Unused' }],
        },
      },
    }))
    expect(compileSection({ sourceHtml: source, slots: extended }).blocking).toContain(
      'slot unused is declared but never used in the template',
    )
  })
  it('requires explicit definition opt-in and keeps manual repeats unchanged', () => {
    const manualSlots = slots.map(slot => ({ ...slot, constraints: { ...slot.constraints, collection: false } })),
      manual = compileSection({ sourceHtml: source, slots: manualSlots })
    const html = renderSection(
      {
        def: { section_def_id: collectionId, version: 1, compiled_ast: manual.ast, slots: manualSlots },
        instance: {
          section_def_id: collectionId,
          section_def_version: 1,
          values: {
            workshops: { items: ['i1'] },
            workshops__i1__title: 'Manual',
            workshops__i1__presenter: 'A person',
          },
        },
      },
      0,
    )
    expect(html).toContain('<tr><th>Manual</th><td>A person</td></tr>')
  })
})
