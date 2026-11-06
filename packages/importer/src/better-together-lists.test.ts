import { describe, it, expect } from 'vitest'
import { convertBetterTogetherList } from './better-together-lists.ts'
import { compileSection, renderSection } from '@cms/renderer'
const speaker = (i: number) =>
  `<div class="speaker-col animate-on-scroll"${i === 0 ? ' id="speaker-lolo"' : ''}><div class="speaker-card" data-speaker=""><div class="speaker-img-wrap"><img src="/images/speaker-${i}.jpg" alt="Speaker ${i}"></div><div class="speaker-card-body"><h5>Speaker ${i}</h5><p class="speaker-role">A role</p></div><div class="speaker-bio"><p>About <strong>Speaker ${i}</strong><br>More.</p><button class="speaker-close-btn"><i class="fa-solid fa-xmark"></i></button></div></div></div>`
const sponsor = (i: number) =>
  `<div class="sponsor-card animate-on-scroll"><div class="sponsor-card-tag tag-${i < 3 ? 'presenting' : 'gold'}">${i < 3 ? 'Presenting Sponsor' : 'Gold'}</div><div class="sponsor-card-logo"><img src="/images/logo-${i}.png" alt="Sponsor ${i}"></div></div>`
const schemaId = '22222222-2222-4222-a222-222222222222',
  definitionId = '11111111-1111-4111-a111-111111111111'
describe('closed conversion of the three original BT2027 patterns', () => {
  it('keeps speaker classes, original direct links, rich biography and close controls, plus other editable fields', () => {
    const html =
      '<div id="guests"><h2>{{heading}}</h2><div class="speaker-grid stagger-children">' +
      Array.from({ length: 6 }, (_, i) => speaker(i)).join('\n') +
      '</div></div>'
    const result = convertBetterTogetherList({
      kind: 'speakers',
      sourceHtml: html,
      renderedHtml: html,
      slots: [{ id: 'heading', kind: 'text', label: 'Heading', constraints: {} }],
      values: { heading: 'Meet our speakers', retired: 'unused' },
    })
    expect(result.entries).toHaveLength(6)
    expect(result.entries[0]!.values.anchor).toBe('speaker-lolo')
    expect(result.entries[1]!.values.anchor).toBe('')
    expect(result.entries[0]!.values.bio).toBe('<p>About <strong>Speaker 0</strong><br>More.</p>')
    expect(result.sourceHtml).toContain('data-speaker=""')
    expect(result.sourceHtml).toContain('speaker-close-btn')
    expect(result.values.heading).toBe('Meet our speakers')
    expect(result.values).not.toHaveProperty('retired')
    expect(result.slots.map(s => s.id)).toEqual(['speakers', 'heading'])
    expect(compileSection({ sourceHtml: result.sourceHtml, slots: result.slots }).blocking).toEqual([])
  })
  it('keeps the original sponsor level classes and binds each group to the same editable list', () => {
    const html =
        '<div class="sponsor-grid stagger-children">' +
        Array.from({ length: 8 }, (_, i) => sponsor(i)).join('') +
        '</div>',
      result = convertBetterTogetherList({
        kind: 'sponsors',
        sourceHtml: html,
        renderedHtml: html,
        slots: [],
        values: {},
      })
    expect(result.entries).toHaveLength(8)
    expect(result.slots).toHaveLength(2)
    expect(result.sourceHtml).toContain('tag-presenting')
    expect(result.sourceHtml).toContain('tag-gold')
    expect(result.values.sponsors1).toEqual({
      readerKey: 'sponsors',
      selection: { mode: 'automatic', limit: 200, filter: { field: 'tier', value: 'Presenting Sponsor' } },
    })
    expect(compileSection({ sourceHtml: result.sourceHtml, slots: result.slots }).problems).toEqual([])
  })
  it('preserves125 SSR table rows including the source blank row, with no table wrapper changes', () => {
    const row = (i: number) =>
      i === 33
        ? '<tr><th></th><td></td><td></td><td></td></tr>'
        : `<tr><th>Workshop ${i}</th><td>Presenter ${i}</td><td>Focus</td><td>Monday</td></tr>`
    const html =
        '<div><table data-toggle="table" data-filter-control="true"><tbody>' +
        Array.from({ length: 125 }, (_, i) => row(i)).join('') +
        '</tbody></table></div>',
      result = convertBetterTogetherList({
        kind: 'workshops',
        sourceHtml: html,
        renderedHtml: html,
        slots: [],
        values: {},
      }),
      compiled = compileSection({ sourceHtml: result.sourceHtml, slots: result.slots })
    expect(result.entries).toHaveLength(125)
    expect(result.entries[33]!.values).toEqual({ title: '', presenter: '', focus: '', time: '' })
    expect(compiled.blocking).toEqual([])
    const envelope = {
      kind: 'collection',
      collectionId: definitionId,
      readerKey: 'workshops',
      publishedSchemaVersionId: schemaId,
      publishedSchemaRevision: '1',
      publishedEntryRevision: '1',
      schemas: [{ id: schemaId, revision: '1', fields: result.fields }],
      entries: result.entries.map((entry, i) => ({
        ...entry,
        id: `33333333-3333-4333-a333-${String(i).padStart(12, '0')}`,
        schemaVersionId: schemaId,
      })),
    }
    const rendered = renderSection(
      {
        def: { section_def_id: definitionId, version: 1, compiled_ast: compiled.ast, slots: result.slots },
        instance: { section_def_id: definitionId, section_def_version: 1, values: { workshops: envelope } },
      },
      0,
    )
    expect(rendered).toContain(html)
    expect(rendered.match(/<tr>/g) ?? []).toHaveLength(125)
  })
  it('refuses changed source shapes instead of silently dropping items', () => {
    for (const kind of ['speakers', 'sponsors', 'workshops'] as const)
      expect(() =>
        convertBetterTogetherList({
          kind,
          sourceHtml: '<div></div>',
          renderedHtml: '<div></div>',
          slots: [],
          values: {},
        }),
      ).toThrow(/original|changed/)
  })
})
