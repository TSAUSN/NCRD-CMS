import { describe, expect, it } from 'vitest'
import { StructuredDocument } from '@cms/schema'
import { compileDefinitionDraft } from './definition-compiler.ts'
import { definitionPreviewValues } from './definition-preview.ts'
import {
  addBuilderBlock,
  BUILDER_CSS,
  includeNewBlockStyles,
  moveBuilderNode,
  newStructuredSection,
  removeBuilderNode,
} from './structured-builder.ts'
import { renderSection } from '@cms/renderer'
import { SEED_SECTION_DEFS } from '@cms/seeds'

describe('visual section authoring', () => {
  it('adds columns and editable fields without duplicating field IDs', () => {
    let doc = addBuilderBlock(newStructuredSection(), [0], 'columns')
    doc = addBuilderBlock(doc, [0, 2, 0], 'heading')
    doc = addBuilderBlock(doc, [0, 2, 1], 'image')
    expect(StructuredDocument.safeParse(doc).success).toBe(true)
    expect(new Set(doc.fields.map(field => field.name)).size).toBe(doc.fields.length)
  })
  it('keeps reused fields while removing fields owned only by a deleted block', () => {
    const doc = newStructuredSection()
    doc.nodes.push({ type: 'text', field: 'heading' })
    const removed = removeBuilderNode(doc, [0])
    expect(removed.fields.map(field => field.name)).toEqual(['heading'])
    expect(doc.fields).toHaveLength(2)
  })
  it('moves blocks without changing their field identity', () => {
    const doc = newStructuredSection()
    const moved = moveBuilderNode(doc, [0, 0], 1)
    expect(moved.fields).toEqual(doc.fields)
    expect(moved.nodes).not.toEqual(doc.nodes)
  })
  it('adds styling for new blocks without overwriting existing block rules', () => {
    const old = newStructuredSection()
    const next = addBuilderBlock(old, [0], 'columns')
    expect(includeNewBlockStyles(old, next, '.hero{color:red}')).toContain('.builder-columns{display:grid')
    expect(includeNewBlockStyles(old, next, '.builder-columns{gap:2rem}')).toBe('.builder-columns{gap:2rem}')
  })
  it('uses governed structured compilation rather than an HTML conversion', () => {
    const compiled = compileDefinitionDraft({
      slug: 'visual',
      name: 'Visual',
      category: 'Content',
      sourceHtml: '',
      sourceCss: BUILDER_CSS,
      slots: [],
      scope: 'site',
      siteId: 'site',
      changelog: '',
      definitionKind: 'structured',
      structuredDoc: newStructuredSection(),
    })
    expect(compiled.blocking).toEqual([])
    expect(compiled.kind).toBe('structured')
    expect(compiled.sourceHtml).toBe('')
    expect(compiled.carriesTrustedCode).toBe(false)
  })
  it('refuses collection bindings in a site frame rather than previewing unsavable sample content', () => {
    const source = SEED_SECTION_DEFS.find(def => def.slug === 'speakers-listing')!
    if (source.kind !== 'structured') throw new Error('structured fixture required')
    const structuredDoc = StructuredDocument.parse({ schemaVersion: 3, fields: source.fields, nodes: source.nodes })
    for (const placement of ['header', 'footer'] as const) {
      const compiled = compileDefinitionDraft({
        slug: source.slug,
        name: source.name,
        category: source.category,
        sourceHtml: '',
        sourceCss: source.sourceCss,
        slots: [],
        scope: 'global',
        siteId: 'site',
        changelog: '',
        definitionKind: 'structured',
        structuredDoc,
        placement,
      })
      expect(compiled.blocking).toContain(
        'Site frame components cannot contain collection lists. Place the collection in a page section instead.',
      )
    }
  })
  it('renders collection templates with preview-only sample records', () => {
    const source = SEED_SECTION_DEFS.find(def => def.slug === 'speakers-listing')!
    if (source.kind !== 'structured') throw new Error('structured fixture required')
    const doc = StructuredDocument.parse({ schemaVersion: 3, fields: source.fields, nodes: source.nodes })
    const compiled = compileDefinitionDraft({
      slug: source.slug,
      name: source.name,
      category: source.category,
      sourceHtml: '',
      sourceCss: source.sourceCss,
      slots: [],
      scope: 'global',
      siteId: 'site',
      changelog: '',
      definitionKind: 'structured',
      structuredDoc: doc,
    })
    const html = renderSection(
      {
        instance: {
          section_def_id: 'preview',
          section_def_version: 1,
          values: definitionPreviewValues(compiled.slots, compiled.structuredDoc),
        },
        def: {
          section_def_id: 'preview',
          version: 1,
          slug: source.slug,
          slots: compiled.slots,
          compiled_ast: compiled.ast,
          definition_kind: 'structured',
          structured_doc: compiled.structuredDoc,
          structured_schema_version: compiled.schemaVersion,
          css: compiled.css,
          css_policy_version: compiled.ast.cssPolicyVersion,
          sanitizer_policy_version: compiled.ast.policyVersion,
        },
      },
      0,
    )
    expect(html).toContain('speaker-card')
    expect(html).toContain('/section-preview-placeholder.svg')
  })
})
