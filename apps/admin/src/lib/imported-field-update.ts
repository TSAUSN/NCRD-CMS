// Bring a section imported by an earlier importer up to the current field
// mapping (EDIT-02), without changing how the page looks.
//
// The section's own public render, with the page's current values, is the
// source an import would have read: the importer's mapping is run on it again,
// so edits already made in V2 carry into the new fields. A field the new
// mapping keeps (same identity and kind) keeps its stored value untouched; only
// new fields take what the mapping extracted. The update is offered only when
// the new definition renders those values to exactly the same HTML, so nothing
// a visitor sees can change; anything else stays as it is for a manual review.
// The current mapping also names a split region's fields by what they are
// (“Hero subtitle · emphasis” rather than “part 2”); a field that only gains
// its clearer name is renamed and keeps its value.
//
// Identical numbered copies become a list editors can add to, reorder and
// remove from (LIB-02). Each item keeps what its numbered copy held, and the
// update is offered only when the page looks the same: the HTML may differ
// only in whitespace between copies and V1's `data-block-id` editing hooks.
import { editableReference } from '@cms/importer/src/editable-reference.ts'
import { adaptRepeats, rendersAlike } from '@cms/importer/src/library-repeats.ts'
import { withSourceSamples } from '@cms/importer/src/source-samples.ts'
import { renderSection, type CompiledSection } from '@cms/renderer'
import { repeatItemSlotId, repeatItemSpec, type SlotDef } from '@cms/schema'
import { isImportedDefinition } from './imported-definition.ts'
import { carrySampleMarkers } from './sample-carry.ts'
import { referenceValues } from './reference-values.ts'

export type ImportedDefinition = {
  section_def_id: string
  slug: string
  version: number
  definition_kind: string | null
  source_css: string | null
  compiled_ast: CompiledSection
  slots: SlotDef[]
}
export type FieldSummary = { id: string; label: string; kind: string }
export type FieldRename = { id: string; kind: string; from: string; to: string }
type ImportedFieldPlan = {
  sourceHtml: string
  compiled: ReturnType<typeof editableReference>['compiled']
  slots: SlotDef[]
  values: Record<string, unknown>
  removed: FieldSummary[]
  added: FieldSummary[]
  renamed: FieldRename[]
}
export type ImportedFieldCheck =
  | { kind: 'available'; plan: ImportedFieldPlan }
  | { kind: 'not-imported' | 'current' | 'looks-different' | 'unmappable' }

export { isImportedDefinition }

/** The public section body, without the renderer's section wrapper. */
function body(
  def: Pick<ImportedDefinition, 'section_def_id' | 'slug' | 'version' | 'compiled_ast' | 'slots'>,
  values: Record<string, unknown>,
): string {
  return renderSection(
    {
      def: {
        section_def_id: def.section_def_id,
        version: def.version,
        slug: def.slug,
        compiled_ast: def.compiled_ast,
        slots: def.slots,
      },
      instance: { section_def_id: def.section_def_id, section_def_version: def.version, values },
    },
    0,
  )
    .replace(/^<div[^>]*>/, '')
    .replace(/<\/div>$/, '')
}

const summary = (slot: SlotDef): FieldSummary => ({ id: slot.id, label: slot.label, kind: slot.kind })

export function planImportedFieldUpdate(def: ImportedDefinition, values: Record<string, unknown>): ImportedFieldCheck {
  if (!isImportedDefinition(def)) return { kind: 'not-imported' }
  // A list is the newest mapping; its render no longer names V1's numbered copies.
  if (def.slots.some(slot => repeatItemSpec(slot))) return { kind: 'current' }
  const before = body(def, values)
  let mapped: ReturnType<typeof editableReference>
  try {
    mapped = editableReference({ slug: def.slug, html: before, css: def.source_css ?? '' })
  } catch {
    return { kind: 'unmappable' }
  }
  // Starting content is not part of a field's shape: a definition that only
  // gained or lost samples is current.
  const shape = (constraints: SlotDef['constraints'] | undefined) => {
    const { sourceSample: _sample, ...rest } = constraints ?? {}
    return rest
  }
  const identity = (slots: readonly SlotDef[]) =>
    JSON.stringify(slots.map(slot => [slot.id, slot.kind, slot.label, shape(slot.constraints)]))
  const listed = adaptRepeats({
    slug: def.slug,
    html: before,
    css: def.source_css ?? '',
    numbered: { sourceHtml: mapped.sourceHtml, slots: mapped.slots },
  })
  if (!listed && identity(mapped.slots) === identity(def.slots)) return { kind: 'current' }
  const target = listed ?? {
    sourceHtml: mapped.sourceHtml,
    compiled: mapped.compiled,
    slots: mapped.slots,
    values: mapped.values,
  }
  const previous = new Map(def.slots.map(slot => [slot.id, slot]))
  const kept = (slot: SlotDef) => previous.get(slot.id)?.kind === slot.kind
  const stored = (id: string, kind: string) => previous.get(id)?.kind === kind && Object.hasOwn(values, id)
  const next: Record<string, unknown> = {}
  const sampleMapping: Record<string, string> = {}
  for (const slot of target.slots) {
    const spec = repeatItemSpec(slot)
    if (!spec) {
      next[slot.id] = kept(slot) && Object.hasOwn(values, slot.id) ? values[slot.id] : target.values[slot.id]
      continue
    }
    // Each item takes what its numbered copy held; its starting item otherwise.
    const from = (slot.constraints['item'] as { from?: Record<string, string>[] }).from ?? []
    const keys = spec.samples.map((_, index) => `i${index + 1}`)
    next[slot.id] = { items: keys }
    spec.samples.forEach((sample, index) => {
      for (const field of spec.fields) {
        const source = from[index]?.[field.id]
        const value = source && stored(source, field.kind) ? values[source] : sample[field.id]
        const targetId = repeatItemSlotId(slot.id, keys[index]!, field.id)
        if (value !== undefined) {
          next[targetId] = value
          if (source) sampleMapping[targetId] = source
        }
      }
    })
  }
  const after = body({ ...def, version: def.version + 1, compiled_ast: target.compiled.ast, slots: target.slots }, next)
  if (listed ? !rendersAlike(after, before) : after !== before) return { kind: 'looks-different' }
  const current = new Set(target.slots.filter(kept).map(slot => slot.id))
  return {
    kind: 'available',
    plan: {
      // The page's current words become the new fields' starting content.
      sourceHtml: target.sourceHtml,
      compiled: target.compiled,
      slots: listed ? target.slots : withSourceSamples(target.slots, next),
      values: carrySampleMarkers(
        values,
        { ...referenceValues(values, [...def.slots, ...target.slots]), ...next },
        sampleMapping,
      ),
      removed: def.slots.filter(slot => !current.has(slot.id)).map(summary),
      added: target.slots.filter(slot => !kept(slot)).map(summary),
      renamed: target.slots
        .filter(slot => kept(slot) && previous.get(slot.id)!.label !== slot.label)
        .map(slot => ({ id: slot.id, kind: slot.kind, from: previous.get(slot.id)!.label, to: slot.label })),
    },
  }
}
