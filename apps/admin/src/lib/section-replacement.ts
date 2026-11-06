import type { EditorSection } from '@cms/domain'
import { isIconSlot, repeatItemKeys, repeatItemSlotId, repeatItemSpec, type SectionAppearance } from '@cms/schema'
import { carrySampleMarkers } from './sample-carry.ts'
import { referenceValues } from './reference-values.ts'

type Field = { id: string; kind: string; label: string; constraints?: Record<string, unknown> }
export type ReplacementMapping = Record<string, string | null>
export type ReplacementField = {
  id: string
  label: string
  kind: string
  sourceId: string | null
  choices: { id: string; label: string }[]
}
export function compatibleReplacementFields(before: Field, after: Field): boolean {
  return (
    isIconSlot(before) === isIconSlot(after) &&
    (before.kind === after.kind ||
      (['link', 'button'].includes(before.kind) && ['link', 'button'].includes(after.kind)))
  )
}
/** Only explicit compatible assignments transfer content. New fields start
 * empty; fabricated preview samples cannot become a promise about saved output.
 * Reference values beside the fields (fonts, documents, embedded media) are
 * not content to map: they stay, so the page keeps its fonts. */
export function planSectionReplacement(
  before: Field[],
  after: Field[],
  values: Record<string, unknown>,
  mapping?: ReplacementMapping,
) {
  const targetIds = new Set(after.map(field => field.id))
  if (mapping && Object.keys(mapping).some(key => !targetIds.has(key)))
    throw new Error('The field mapping includes an unavailable target field.')
  const nextValues: Record<string, unknown> = referenceValues(values, [...before, ...after])
  const used = new Set<string>()
  const sampleMapping: Record<string, string> = {}
  const fields: ReplacementField[] = after.map(field => {
    const choices = before
      .filter(source => compatibleReplacementFields(source, field))
      .map(source => ({ id: source.id, label: source.label }))
    const sourceId =
      mapping && Object.hasOwn(mapping, field.id)
        ? mapping[field.id]
        : choices.some(source => source.id === field.id)
          ? field.id
          : null
    if (sourceId !== null && (typeof sourceId !== 'string' || !choices.some(source => source.id === sourceId))) {
      throw new Error(`Choose compatible content for ${field.label}, or leave it empty.`)
    }
    if (sourceId !== null) {
      used.add(sourceId)
      sampleMapping[field.id] = sourceId
      if (Object.hasOwn(values, sourceId)) nextValues[field.id] = structuredClone(values[sourceId])
      // A repeated list brings its items, with each item field both layouts declare alike (LIB-02).
      const from = repeatItemSpec(before.find(source => source.id === sourceId)!),
        to = repeatItemSpec(field)
      if (from && to) {
        for (const key of repeatItemKeys(values[sourceId], to.max)) {
          for (const item of to.fields) {
            const previous = from.fields.find(candidate => candidate.id === item.id)
            const id = repeatItemSlotId(sourceId, key, item.id)
            if (previous && compatibleReplacementFields(previous, item) && Object.hasOwn(values, id)) {
              const target = repeatItemSlotId(field.id, key, item.id)
              nextValues[target] = structuredClone(values[id])
              sampleMapping[target] = id
            }
          }
        }
        nextValues[field.id] = { items: repeatItemKeys(values[sourceId], to.max) }
      }
    }
    return { id: field.id, label: field.label, kind: field.kind, sourceId, choices }
  })
  return {
    fields,
    values: carrySampleMarkers(values, nextValues, sampleMapping),
    unmapped: before.filter(field => !used.has(field.id)).map(field => field.label),
  }
}

type Support = {
  layout: boolean
  surface: boolean
  mobileOrder?: boolean
  imagePosition?: boolean
  width?: boolean
  spacing?: boolean
  alignment?: boolean
}
const APPEARANCE_LABELS: Record<keyof SectionAppearance, string> = {
  imagePosition: 'Image position',
  surface: 'Background',
  spacing: 'Spacing',
  width: 'Width',
  align: 'Alignment',
  mobileOrder: 'Phone order',
}
function supported(key: keyof SectionAppearance, support: Support | undefined): boolean {
  if (!support) return false
  if (key === 'surface') return support.surface
  if (key === 'imagePosition') return support.imagePosition === true
  if (key === 'width' || key === 'spacing') return support.layout && support[key] !== false
  if (key === 'align') return support.layout && support.alignment !== false
  if (key === 'mobileOrder') return support.mobileOrder === true
  return support.layout
}

/** The instance a reviewed layout change saves. The label and visibility are
 * this page's own and stay; appearance choices travel only where the new
 * layout supports them; custom HTML/CSS was written for the old markup and is
 * left in the checkpoint rather than applied to a layout it was not made for. */
export function replacementSection(
  section: EditorSection,
  target: { section_def_id: string; version: number; appearance_support?: Support },
  values: Record<string, unknown>,
): { section: EditorSection; droppedAppearance: string[]; droppedSource: boolean } {
  const next: EditorSection = {
    section_def_id: target.section_def_id,
    section_def_version: target.version,
    values: structuredClone(values),
  }
  if (section.label !== undefined) next.label = section.label
  if (section.hidden !== undefined) next.hidden = section.hidden
  if (section.hidden_at !== undefined) next.hidden_at = [...section.hidden_at]
  const appearance: SectionAppearance = {},
    droppedAppearance: string[] = []
  for (const [key, value] of Object.entries(section.appearance ?? {}) as [keyof SectionAppearance, never][]) {
    if (value === undefined) continue
    if (supported(key, target.appearance_support)) appearance[key] = value
    else droppedAppearance.push(APPEARANCE_LABELS[key] ?? key)
  }
  if (Object.keys(appearance).length) next.appearance = appearance
  return {
    section: next,
    droppedAppearance,
    droppedSource: Boolean(section.raw_html?.trim() || section.custom_css?.trim()),
  }
}
