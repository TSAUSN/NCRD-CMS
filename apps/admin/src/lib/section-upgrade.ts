import {
  isDrawingSlot,
  isIconSlot,
  repeatItemKeys,
  repeatItemSlotId,
  repeatItemSpec,
  sourceSampleValue,
  type RepeatItemSpec,
} from '@cms/schema'
import { carrySampleMarkers } from './sample-carry.ts'
import { referenceValues } from './reference-values.ts'
type Field = { id: string; kind: string; label: string; constraints?: Record<string, unknown> }
export type SectionUpgradePlan = {
  added: string[]
  removed: string[]
  changed: string[]
  values: Record<string, unknown>
}

const compatibleKinds = (prior: Field, field: Field) =>
  isIconSlot(prior) === isIconSlot(field) &&
  isDrawingSlot(prior) === isDrawingSlot(field) &&
  (prior.kind === field.kind || (['link', 'button'].includes(prior.kind) && ['link', 'button'].includes(field.kind)))

/** The numbered fields each starting item replaced, when the importer recorded them (LIB-02). */
function legacyUnits(spec: RepeatItemSpec, field: Field): Record<string, string>[] {
  const from = (field.constraints?.['item'] as { from?: unknown } | undefined)?.from
  return Array.isArray(from)
    ? from
        .filter((unit): unit is Record<string, string> => !!unit && typeof unit === 'object' && !Array.isArray(unit))
        .slice(0, spec.max)
    : []
}

/** Changed types require a new value. Removed values remain recoverable in
 * the checkpoint captured before applying an update. Reference values beside
 * the fields (fonts, documents, embedded media) travel with the section.
 *
 * A repeated list keeps its items and each item field whose id and kind are
 * unchanged. A list replacing numbered copies (`item.from`) takes over what
 * each copy's numbered fields held, so moving a page to the list loses nothing. */
export function planSectionUpgrade(
  before: Field[],
  after: Field[],
  values: Record<string, unknown>,
): SectionUpgradePlan {
  const old = new Map(before.map(field => [field.id, field]))
  const next = new Map(after.map(field => [field.id, field]))
  const kept: Record<string, unknown> = {}
  const sampleMapping: Record<string, string> = {}
  const changed: string[] = []
  const added: string[] = []
  const absorbed = new Set<string>()
  for (const field of after) {
    const prior = old.get(field.id)
    const spec = repeatItemSpec(field)
    if (spec) {
      const priorSpec = prior ? repeatItemSpec(prior) : null
      if (prior && priorSpec) {
        const keys = repeatItemKeys(values[field.id], spec.max)
        kept[field.id] = { items: keys }
        for (const item of spec.fields) {
          const previous = priorSpec.fields.find(candidate => candidate.id === item.id)
          if (!previous) {
            added.push(`${field.label} · ${item.label}`)
            continue
          }
          if (!compatibleKinds(previous, item)) {
            changed.push(`${field.label} · ${item.label}`)
            continue
          }
          for (const key of keys) {
            const id = repeatItemSlotId(field.id, key, item.id)
            if (Object.hasOwn(values, id)) kept[id] = values[id]
          }
        }
        continue
      }
      const units = prior ? [] : legacyUnits(spec, field)
      if (units.length && units.some(unit => Object.values(unit).some(id => old.has(id)))) {
        const keys = units.map((_, index) => `i${index + 1}`)
        kept[field.id] = { items: keys }
        units.forEach((unit, index) => {
          for (const item of spec.fields) {
            const source = unit[item.id] ? old.get(unit[item.id]!) : undefined
            const id = repeatItemSlotId(field.id, keys[index]!, item.id)
            if (source && compatibleKinds(source, item)) {
              absorbed.add(source.id)
              sampleMapping[id] = source.id
              if (Object.hasOwn(values, source.id)) kept[id] = values[source.id]
            } else {
              // A drawing the numbered copy kept as markup: its own starting drawing.
              const sample = sourceSampleValue(item, spec.samples[index]?.[item.id])
              if (sample !== undefined) kept[id] = sample
            }
          }
        })
        continue
      }
    }
    if (!prior) {
      added.push(field.label)
      continue
    }
    if (!compatibleKinds(prior, field)) {
      changed.push(field.label)
      continue
    }
    if (Object.hasOwn(values, field.id)) kept[field.id] = values[field.id]
  }
  return {
    added,
    changed,
    removed: before.filter(field => !next.has(field.id) && !absorbed.has(field.id)).map(field => field.label),
    values: carrySampleMarkers(values, { ...referenceValues(values, [...before, ...after]), ...kept }, sampleMapping),
  }
}
