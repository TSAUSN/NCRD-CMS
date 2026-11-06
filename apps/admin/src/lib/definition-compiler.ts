import {
  SlotDef,
  STRUCTURED_SCHEMA_VERSION,
  repeatItemSpec,
  collectionTemplateSpec,
  type StructuredDocument,
  type StructuredNode,
} from '@cms/schema'
import { compileSection, compileStructuredSection, sectionScopeSelector, type CompiledSection } from '@cms/renderer'
import { NO_COMPILED_TEMPLATE, slotsForFields } from '@cms/seeds'
import type { SectionDraft } from '../app/actions/section-definitions.ts'

export type AuthoredCompilation = {
  kind: 'legacy' | 'structured'
  sourceHtml: string
  ast: CompiledSection
  css: string
  slots: SlotDef[]
  structuredDoc: StructuredDocument | null
  schemaVersion: number | null
  renderHash: string
  carriesTrustedCode: boolean
  blocking: string[]
  problems: string[]
}

/** Both authoring modes use the same production compilers and stored artifacts. */
export function compileDefinitionDraft(draft: SectionDraft): AuthoredCompilation {
  const placementProblems =
    draft.placement !== undefined && !['page', 'header', 'footer'].includes(draft.placement)
      ? ['Choose page section, site header or site footer.']
      : []
  if (draft.definitionKind === 'structured') {
    const compiled = compileStructuredSection({
      slug: draft.slug,
      document: draft.structuredDoc,
      sourceCss: draft.sourceCss,
    })
    const bindingProblems: string[] = []
    function walk(nodes: StructuredNode[]) {
      for (const node of nodes) {
        if (node.type === 'element') walk(node.children ?? [])
        if (node.type !== 'repeat') continue
        const types = new Map<string, string>()
        function item(nodes: StructuredNode[]) {
          for (const field of nodes) {
            if (field.type === 'element') {
              item(field.children ?? [])
              continue
            }
            if (field.type === 'provider-embed') continue
            if (field.type === 'repeat') continue // the document compiler already refuses nested repeats
            if (!/^[a-z][a-z0-9_]{0,63}$/.test(field.field))
              bindingProblems.push(`Collection field ${field.field} must use a lowercase collection field key.`)
            // Collection URL fields are adapted to labelled links by the
            // shared renderer and checked against the schema by SQL (0088).
            if (types.has(field.field) && types.get(field.field) !== field.type)
              bindingProblems.push(`Collection field ${field.field} is used with two incompatible types.`)
            types.set(field.field, field.type)
          }
        }
        item(node.item)
      }
    }
    walk(compiled.document.nodes)
    const slots = slotsForFields(compiled.document.fields, compiled.document.nodes)
    if ((draft.placement === 'header' || draft.placement === 'footer') && slots.some(slot => slot.kind === 'repeat')) {
      bindingProblems.push(
        'Site frame components cannot contain collection lists. Place the collection in a page section instead.',
      )
    }
    return {
      kind: 'structured',
      sourceHtml: '',
      ast: NO_COMPILED_TEMPLATE,
      css: compiled.css,
      slots,
      structuredDoc: compiled.document,
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      renderHash: compiled.renderHash,
      carriesTrustedCode: false,
      blocking: [...compiled.blocking, ...placementProblems, ...bindingProblems],
      problems: compiled.problems,
    }
  }
  const parsed = SlotDef.array().safeParse(draft.slots)
  const slots = parsed.success ? parsed.data : []
  const compiled = compileSection({
    sourceHtml: draft.sourceHtml,
    sourceCss: draft.sourceCss,
    slots,
    scopeSelector: sectionScopeSelector(draft.slug) ?? undefined,
  })
  return {
    kind: 'legacy',
    sourceHtml: draft.sourceHtml,
    ast: compiled.ast,
    css: compiled.css,
    slots,
    structuredDoc: null,
    schemaVersion: null,
    renderHash: compiled.renderHash,
    carriesTrustedCode: compiled.carriesTrustedCode,
    blocking: [
      ...compiled.blocking,
      ...placementProblems,
      ...((draft.placement ?? 'page') === 'page' && slots.some(slot => slot.kind === 'navigation')
        ? ['Site menu fields belong in an authored header or footer, not a page section.']
        : []),
      ...((draft.placement === 'header' || draft.placement === 'footer') && compiled.carriesTrustedCode
        ? ['A site header or footer cannot contain custom scripts or trusted code.']
        : []),
      ...(parsed.success ? [] : parsed.error.issues.map(issue => issue.message)),
      // Both page-owned items and native list bindings need a closed item
      // declaration. Bare placeholders cannot infer a list's fields or markup.
      ...(slots.some(slot => slot.kind === 'repeat' && !repeatItemSpec(slot) && !collectionTemplateSpec(slot))
        ? ['Lists need a declared item layout and fields.']
        : []),
      ...((draft.placement === 'header' || draft.placement === 'footer') && slots.some(slot => slot.kind === 'repeat')
        ? ['Site frame components cannot contain collection lists. Place the collection in a page section instead.']
        : []),
      ...(draft.definitionKind !== undefined && draft.definitionKind !== 'legacy'
        ? ['Choose a supported section authoring mode.']
        : []),
    ],
    problems: compiled.problems,
  }
}
