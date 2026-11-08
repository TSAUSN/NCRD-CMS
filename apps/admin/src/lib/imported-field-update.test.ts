import { describe, expect, it } from 'vitest'
import { compileSection, renderSection } from '@cms/renderer'
import type { SlotDef } from '@cms/schema'
import { editableReference } from '@cms/importer/editable-reference'
import { isImportedDefinition, planImportedFieldUpdate, type ImportedDefinition } from './imported-field-update.ts'

const PRESENTED = 'class="lead" style="font-family: var(--font-secondary);"'
const A = `v1-${'a'.repeat(24)}`,
  B = `v1-${'b'.repeat(24)}`,
  C = `v1-${'c'.repeat(24)}`

function legacy(slug: string, sourceHtml: string, slots: SlotDef[]): ImportedDefinition {
  const compiled = compileSection({ sourceHtml, sourceCss: '', slots, scopeSelector: `.cms-section--${slug}` })
  expect(compiled.blocking).toEqual([])
  return {
    section_def_id: '00000000-0000-4000-8000-000000000001',
    slug,
    version: 3,
    definition_kind: 'legacy',
    source_css: '',
    compiled_ast: compiled.ast,
    slots,
  }
}
const text = (id: string, label: string): SlotDef => ({ id, kind: 'text', label, constraints: {} })
const render = (
  def: Pick<ImportedDefinition, 'section_def_id' | 'slug' | 'version' | 'compiled_ast' | 'slots'>,
  values: Record<string, unknown>,
) =>
  renderSection({ def, instance: { section_def_id: def.section_def_id, section_def_version: def.version, values } }, 0)

describe('updating an imported section to the current field mapping', () => {
  // How the earlier importer left HNI's overview: one text field per styled
  // paragraph. The note's field has the identity the importer gives it, so it
  // is the same field before and after.
  const NOTE = editableReference({
    slug: 'v1-work-overview',
    css: '',
    html: `<div class="space-y-4" data-block-id="overview-body" data-editable="richtext"><p ${PRESENTED}>x</p>\n<p ${PRESENTED}>y</p></div><p class="note" data-block-id="note" data-editable="text">z</p>`,
  }).slots.find(slot => slot.label === 'Note')!.id
  const split = legacy(
    'v1-work-overview',
    `<div class="space-y-4" data-block-id="overview-body" data-editable="richtext"><p ${PRESENTED}>{{${A}}}</p>\n<p ${PRESENTED}>{{${B}}}</p></div><p class="note" data-block-id="note" data-editable="text">{{${NOTE}}}</p>`,
    [text(A, 'Overview body · part 1'), text(B, 'Overview body · part 2'), text(NOTE, 'Note')],
  )
  const values = { [A]: 'First paragraph.', [B]: 'Second paragraph, already edited in V2.', [NOTE]: 'Kept exactly' }

  it('joins the split paragraphs into one formatted field, carries the edited text and keeps every other value untouched', () => {
    const check = planImportedFieldUpdate(split, values)
    if (check.kind !== 'available') throw new Error(check.kind)
    const { plan } = check
    const body = plan.slots.find(slot => slot.kind === 'richtext')!
    expect(body).toMatchObject({
      label: 'Overview body',
      constraints: { blockAttributes: { p: { class: 'lead', style: 'font-family: var(--font-secondary);' } } },
    })
    expect(plan.values[body.id]).toBe('<p>First paragraph.</p>\n<p>Second paragraph, already edited in V2.</p>')
    expect(plan.removed.map(field => field.label)).toEqual(['Overview body · part 1', 'Overview body · part 2'])
    expect(plan.added.map(field => [field.label, field.kind])).toEqual([['Overview body', 'richtext']])
    // The note keeps its identity and its stored value.
    expect(plan.slots.find(slot => slot.id === NOTE)).toBeDefined()
    expect(plan.values[NOTE]).toBe('Kept exactly')
    // The promise: visitors see exactly the same page.
    expect(render({ ...split, version: 4, compiled_ast: plan.compiled.ast, slots: plan.slots }, plan.values)).toBe(
      render(split, values),
    )
  })

  it('renames a split region’s fields by what they are, keeping their values and the page', () => {
    // An earlier importer numbered the words of a subtitle and a styled span
    // (a span is not a mark, so the region still splits).
    const source = '<p data-block-id="hero-subtitle" data-editable="text">x <span class="red">y</span></p>'
    const ids = editableReference({ slug: 'v1-work-subtitle', html: source, css: '' }).slots.map(slot => slot.id)
    const numbered = legacy(
      'v1-work-subtitle',
      `<p data-block-id="hero-subtitle" data-editable="text">{{${ids[0]}}}<span class="red">{{${ids[1]}}}</span></p>`,
      [text(ids[0]!, 'Hero subtitle · part 1'), text(ids[1]!, 'Hero subtitle · part 2')],
    )
    const words = { [ids[0]!]: 'Discover more ', [ids[1]!]: 'love beyond hardship' }
    const check = planImportedFieldUpdate(numbered, words)
    if (check.kind !== 'available') throw new Error(check.kind)
    expect(check.plan.removed).toEqual([])
    expect(check.plan.added).toEqual([])
    expect(check.plan.renamed.map(field => [field.from, field.to])).toEqual([
      ['Hero subtitle · part 1', 'Hero subtitle'],
      ['Hero subtitle · part 2', 'Hero subtitle · text'],
    ])
    expect(check.plan.values).toEqual(words)
    // The font and media references the importer stored beside the fields stay:
    // the page's registered fonts come from them.
    const references = {
      'v1-asset-0': { asset_id: '58c8cac6-b0be-4e6b-ab86-7590154c2e86' },
      'v1-media-0': { media_id: '7a9932e3-ca0f-4f48-a8d8-1899d11882e6', variant: 'original' },
    }
    const withReferences = planImportedFieldUpdate(numbered, { ...words, ...references })
    if (withReferences.kind !== 'available') throw new Error(withReferences.kind)
    expect(withReferences.plan.values).toEqual({ ...words, ...references })
    expect(
      render(
        { ...numbered, version: 4, compiled_ast: check.plan.compiled.ast, slots: check.plan.slots },
        check.plan.values,
      ),
    ).toBe(render(numbered, words))
  })

  it('joins a subtitle split around its styled emphasis into one inline field, as V1 edits it', () => {
    // How the earlier importer left HNI's hero subtitle: the words and the red
    // emphasis were two fields. The emphasis's identity is its element path.
    const [first, second] = [`v1-${'d'.repeat(24)}`, `v1-${'e'.repeat(24)}`]
    const split = legacy(
      'v1-work-subtitle',
      `<p data-block-id="hero-subtitle" data-editable="text">{{${first}}}<br><em class="red">{{${second}}}</em></p>`,
      [text(first, 'Hero subtitle'), text(second, 'Hero subtitle · emphasis')],
    )
    const words = { [first]: 'Discover more, edited in V2', [second]: 'love beyond hardship' }
    const check = planImportedFieldUpdate(split, words)
    if (check.kind !== 'available') throw new Error(check.kind)
    const field = check.plan.slots.find(slot => slot.kind === 'richtext')!
    expect(field).toMatchObject({
      label: 'Hero subtitle',
      constraints: { inline: true, inlineAttributes: { em: { class: 'red' } } },
    })
    expect(check.plan.values[field.id]).toBe('Discover more, edited in V2<br><em>love beyond hardship</em>')
    expect(check.plan.added.map(added => [added.label, added.kind])).toEqual([['Hero subtitle', 'richtext']])
    expect(
      render(
        { ...split, version: 4, compiled_ast: check.plan.compiled.ast, slots: check.plan.slots },
        check.plan.values,
      ),
    ).toBe(render(split, words))
  })

  it('says when a section already has the current mapping, or was not made by the importer', () => {
    const fresh = editableReference({
      slug: 'v1-work-fresh',
      html: '<div data-editable="richtext" data-block-id="copy"><p>One.</p><p>Two.</p></div>',
      css: '',
    })
    const current: ImportedDefinition = {
      section_def_id: split.section_def_id,
      slug: 'v1-work-fresh',
      version: 1,
      definition_kind: 'legacy',
      source_css: '',
      compiled_ast: fresh.compiled.ast,
      slots: fresh.slots,
    }
    expect(planImportedFieldUpdate(current, fresh.values)).toEqual({ kind: 'current' })
    expect(planImportedFieldUpdate({ ...split, slug: 'hero' }, values)).toEqual({ kind: 'not-imported' })
    expect(isImportedDefinition({ ...split, slots: [...split.slots, text('body', 'Authored')] })).toBe(false)
    expect(isImportedDefinition({ ...split, definition_kind: 'structured' })).toBe(false)
  })

  it('never replaces a source icon’s drawing with the icon picker’s', () => {
    // The current mapping keeps a source that draws its own icon as drawn
    // (SPEC §6.5, LIB-03), so a section imported that way is already current.
    const source =
      '<span data-editable="icon" data-icon-name="info"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2h20v20H2z"></path></svg></span><p data-block-id="caption" data-editable="text">x</p>'
    const caption = editableReference({ slug: 'v1-work-icon', html: source, css: '' }).slots.find(
      slot => slot.label === 'Caption',
    )!.id
    const drawn = legacy('v1-work-icon', source.replace('>x</p>', `>{{${caption}}}</p>`), [text(caption, 'Caption')])
    expect(planImportedFieldUpdate(drawn, { [caption]: 'Caption text' })).toEqual({ kind: 'current' })
  })
})

describe('numbered copies on an imported page becoming a list (LIB-02)', () => {
  // An imported speakers section as the current importer maps it: one field per
  // copy's name and role, numbered by V1.
  const html =
    '<div class="grid">' +
    [1, 2, 3]
      .map(
        n =>
          `<article class="sp"><h3 data-block-id="sp-${n}-name" data-editable="text">Speaker ${n}</h3>` +
          `<p data-block-id="sp-${n}-role" data-editable="text">Role ${n}</p></article>`,
      )
      .join('\n') +
    '</div>'
  const numbered = editableReference({ slug: 'v1-work-speakers', css: '', html })
  const def = legacy('v1-work-speakers', numbered.sourceHtml, numbered.slots)
  const edited = { ...numbered.values, [numbered.slots[2]!.id]: 'Edited in V2' }

  it('offers the list with each copy’s stored words, and looks exactly as before', () => {
    const check = planImportedFieldUpdate(def, edited)
    if (check.kind !== 'available') throw new Error(check.kind)
    const { plan } = check
    const list = plan.slots.find(slot => slot.kind === 'repeat')!
    expect(plan.added.map(field => field.kind)).toEqual(['repeat'])
    expect(plan.removed).toHaveLength(6)
    expect(plan.values[list.id]).toEqual({ items: ['i1', 'i2', 'i3'] })
    expect(
      Object.entries(plan.values)
        .filter(([id]) => id.startsWith(`${list.id}__`))
        .map(([, value]) => value),
    ).toEqual(['Speaker 1', 'Role 1', 'Edited in V2', 'Role 2', 'Speaker 3', 'Role 3'])
    const after = render({ ...def, version: 4, compiled_ast: plan.compiled.ast, slots: plan.slots }, plan.values)
    // Whitespace between copies aside, which a browser collapses.
    const seen = (html: string) =>
      html
        .replace(/ data-block-id="[^"]*"/g, '')
        .replace(/\s+/g, ' ')
        .replace(/> </g, '><')
    expect(seen(after)).toBe(seen(render(def, edited)))
  })

  it('leaves a section that already has a list alone', () => {
    const check = planImportedFieldUpdate(def, edited)
    if (check.kind !== 'available') throw new Error(check.kind)
    const listed = { ...def, version: 4, compiled_ast: check.plan.compiled.ast, slots: check.plan.slots }
    expect(isImportedDefinition(listed)).toBe(false)
    expect(planImportedFieldUpdate({ ...listed, slug: 'v1-work-speakers' }, check.plan.values).kind).toMatch(
      /^(current|not-imported)$/,
    )
  })
})
