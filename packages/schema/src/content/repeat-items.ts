import { sampleFieldNames, SAMPLE_FIELDS_KEY } from './sample-content.ts'
// Repeated items inside a section (LIB-02, SPEC §6.14): V1's cards, steps,
// rows and tiers as a list an editor can add to, remove from and reorder,
// instead of a fixed number of numbered copies.
//
// A `repeat` field declares one item's fields in its own constraints
// (`constraints.item`). The template marks the item's markup once, between
// `{{#field}}` and `{{/field}}`, and the renderer draws it once per item.
//
// Values stay one flat map, like every other field's. The field's own value is
// the order of its items, by stable key (`{ items: ['i1', 'i2'] }`); each item
// field is stored under `<repeat>__<key>__<field>`. Typing on the canvas, undo,
// autosave, recovery copies and media references therefore treat an item's
// words or picture exactly as they treat any other field's: the composed id is
// an ordinary field id, and the order is an ordinary value.
import { SLOT_ID } from './slot-id.ts'
import { siteWidget } from './site-widgets.ts'
import type { SlotDef } from './sections.ts'

/** An item's key: short, lowercase, unique within its list, never reused while the item exists. */
export const REPEAT_ITEM_KEY = /^[a-z][a-z0-9]{0,7}$/
/** No list grows without bound; a page manifest stays bounded. */
export const REPEAT_MAX_ITEMS = 48
const SEPARATOR = '__'
/** The longest composed id: repeat + key + field + two separators, within a slot id's 64 characters. */
const KEY_ROOM = 8 + 2 * SEPARATOR.length

/** The kinds an item field may have: one value each, nothing nested. */
export const REPEAT_ITEM_FIELD_KINDS = ['text', 'richtext', 'image', 'link', 'button'] as const

export type RepeatItemSpec = {
  /** One item's fields, by their own ids (`title`, `body`). */
  fields: SlotDef[]
  /** What one item is called to an editor: “Card”, “Step”, “Tier”. */
  unit: string
  min: number
  max: number
  /** Starting items, each a map of item field id to value. */
  samples: Record<string, unknown>[]
}

export type RepeatValue = { items: string[] }

/** Any field record: a stored definition's slots, or the editor's library view of them. */
export type FieldLike = { id: string; kind: string; label: string; constraints?: Record<string, unknown> }

/** The item declaration of a repeat field, or null when it has none or it is malformed. */
export function repeatTemplateSpec(slot: Pick<FieldLike, 'id' | 'kind' | 'constraints'>): RepeatItemSpec | null {
  if (slot.kind !== 'repeat' || slot.id.includes(SEPARATOR)) return null
  const item = slot.constraints?.['item']
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const raw = item as Record<string, unknown>
  if (!Array.isArray(raw['fields']) || raw['fields'].length === 0 || raw['fields'].length > 32) return null
  const fields: SlotDef[] = []
  const ids = new Set<string>()
  for (const candidate of raw['fields'] as unknown[]) {
    if (!candidate || typeof candidate !== 'object') return null
    const field = candidate as Record<string, unknown>
    const id = field['id'],
      kind = field['kind'],
      label = field['label']
    if (typeof id !== 'string' || !SLOT_ID.test(id) || id.includes(SEPARATOR) || ids.has(id)) return null
    if (slot.id.length + id.length + KEY_ROOM > 64) return null
    if (typeof kind !== 'string' || !(REPEAT_ITEM_FIELD_KINDS as readonly string[]).includes(kind)) return null
    if (typeof label !== 'string' || label.trim() === '') return null
    const constraints = field['constraints']
    ids.add(id)
    fields.push({
      id,
      kind: kind as SlotDef['kind'],
      label,
      constraints:
        constraints && typeof constraints === 'object' && !Array.isArray(constraints)
          ? (constraints as Record<string, unknown>)
          : {},
    })
  }
  const unit = typeof raw['unit'] === 'string' && raw['unit'].trim() !== '' ? raw['unit'].trim().slice(0, 40) : 'Item'
  const min = Number.isInteger(raw['min']) ? Math.max(0, Math.min(REPEAT_MAX_ITEMS, raw['min'] as number)) : 0
  const max = Number.isInteger(raw['max'])
    ? Math.max(Math.max(min, 1), Math.min(REPEAT_MAX_ITEMS, raw['max'] as number))
    : REPEAT_MAX_ITEMS
  const samples = Array.isArray(raw['samples'])
    ? (raw['samples'] as unknown[])
        .filter(
          (sample): sample is Record<string, unknown> =>
            !!sample && typeof sample === 'object' && !Array.isArray(sample),
        )
        .slice(0, max)
    : []
  return { fields, unit, min, max, samples }
}

/** Manual controls never treat a native list binding as page-owned item values. */
export function repeatItemSpec(slot: Pick<FieldLike, 'id' | 'kind' | 'constraints'>): RepeatItemSpec | null {
  return slot.constraints?.['collection'] === true ? null : repeatTemplateSpec(slot)
}
/** Explicit definition-owned opt-in; interpolation and field sink rules stay unchanged. */
export function collectionTemplateSpec(slot: Pick<FieldLike, 'id' | 'kind' | 'constraints'>): RepeatItemSpec | null {
  if (slot.constraints?.['collection'] !== true) return null
  const spec = repeatTemplateSpec(slot)
  return spec && spec.fields.every(field => ['text', 'richtext', 'image', 'link'].includes(field.kind)) ? spec : null
}

export function repeatItemSlotId(repeatId: string, key: string, fieldId: string): string {
  return `${repeatId}${SEPARATOR}${key}${SEPARATOR}${fieldId}`
}

/** The parts of a composed item field id, or null when the id is an ordinary one. */
export function parseRepeatItemSlotId(id: string): { repeatId: string; key: string; fieldId: string } | null {
  const parts = id.split(SEPARATOR)
  if (parts.length !== 3) return null
  const [repeatId, key, fieldId] = parts as [string, string, string]
  if (!SLOT_ID.test(repeatId) || !REPEAT_ITEM_KEY.test(key) || !SLOT_ID.test(fieldId)) return null
  return { repeatId, key, fieldId }
}

/** The item keys a repeat value holds, in order, ignoring anything malformed or repeated. */
export function repeatItemKeys(value: unknown, max = REPEAT_MAX_ITEMS): string[] {
  const items =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)['items']
      : undefined
  if (!Array.isArray(items)) return []
  const keys: string[] = []
  for (const key of items) {
    if (typeof key === 'string' && REPEAT_ITEM_KEY.test(key) && !keys.includes(key)) keys.push(key)
    if (keys.length >= max) break
  }
  return keys
}

/** One item field as the editor names it: “Card 2 · Title”. */
export type RepeatItemSlot = SlotDef & {
  repeat: { id: string; key: string; index: number; count: number; unit: string }
}

/**
 * Every field an editor can reach in a section, in order: ordinary fields as
 * declared, and each repeat's item fields for each item it holds.
 */
export function editableSlots<T extends FieldLike>(
  slots: readonly T[],
  values: Record<string, unknown>,
): (T | RepeatItemSlot)[] {
  const out: (T | RepeatItemSlot)[] = []
  for (const slot of slots) {
    if (siteWidget(slot)) continue
    const spec = repeatItemSpec(slot)
    if (!spec) {
      out.push(slot)
      continue
    }
    const keys = repeatItemKeys(values[slot.id], spec.max)
    keys.forEach((key, index) => {
      for (const field of spec.fields) {
        out.push({
          ...field,
          id: repeatItemSlotId(slot.id, key, field.id),
          label: `${spec.unit} ${index + 1} · ${field.label}`,
          repeat: { id: slot.id, key, index, count: keys.length, unit: spec.unit },
        })
      }
    })
  }
  return out
}

/** The field a (possibly composed) id names, as `editableSlots` would describe it. */
export function slotForId<T extends FieldLike>(
  slots: readonly T[],
  values: Record<string, unknown>,
  id: string,
): T | RepeatItemSlot | undefined {
  const direct = slots.find(slot => slot.id === id)
  if (direct) return siteWidget(direct) ? undefined : direct
  const parsed = parseRepeatItemSlotId(id)
  if (!parsed) return undefined
  const owner = slots.find(slot => slot.id === parsed.repeatId)
  const spec = owner ? repeatItemSpec(owner) : null
  const field = spec?.fields.find(candidate => candidate.id === parsed.fieldId)
  if (!spec || !field) return undefined
  const keys = repeatItemKeys(values[parsed.repeatId], spec.max)
  const index = keys.indexOf(parsed.key)
  if (index < 0) return undefined
  return {
    ...field,
    id,
    label: `${spec.unit} ${index + 1} · ${field.label}`,
    repeat: { id: parsed.repeatId, key: parsed.key, index, count: keys.length, unit: spec.unit },
  }
}

export function isRepeatItemSlot(slot: FieldLike | RepeatItemSlot | undefined): slot is RepeatItemSlot {
  return !!slot && 'repeat' in slot
}

/** A key no item in the list has: `i1`, `i2`, … */
export function newRepeatItemKey(existing: readonly string[]): string {
  for (let n = 1; ; n += 1) if (!existing.includes(`i${n}`)) return `i${n}`
}

/**
 * Add an item after `after` (or at the end), starting from `from`'s values
 * when duplicating, else from the declared starting item at that position, else
 * empty. Returns the values unchanged at the declared maximum.
 */
export function addRepeatItem(
  values: Record<string, unknown>,
  slot: FieldLike,
  options: { after?: string; from?: string } = {},
): { values: Record<string, unknown>; key: string | null } {
  const spec = repeatItemSpec(slot)
  if (!spec) return { values, key: null }
  const keys = repeatItemKeys(values[slot.id], spec.max)
  if (keys.length >= spec.max) return { values, key: null }
  const key = newRepeatItemKey(keys)
  const at = options.after !== undefined && keys.includes(options.after) ? keys.indexOf(options.after) + 1 : keys.length
  const next: Record<string, unknown> = {
    ...values,
    [slot.id]: { items: [...keys.slice(0, at), key, ...keys.slice(at)] },
  }
  const sample = spec.samples[at] ?? spec.samples[spec.samples.length - 1]
  const marked = new Set(sampleFieldNames(values))
  for (const field of spec.fields) {
    const source =
      options.from !== undefined && keys.includes(options.from)
        ? values[repeatItemSlotId(slot.id, options.from, field.id)]
        : sample?.[field.id]
    if (source !== undefined) {
      const name = repeatItemSlotId(slot.id, key, field.id)
      next[name] = structuredClone(source)
      if (options.from === undefined || marked.has(repeatItemSlotId(slot.id, options.from, field.id))) marked.add(name)
    }
  }
  if (marked.size) next[SAMPLE_FIELDS_KEY] = [...marked]
  return { values: next, key }
}

/** Remove one item and its values. Refused (values unchanged) at the declared minimum. */
export function removeRepeatItem(
  values: Record<string, unknown>,
  slot: FieldLike,
  key: string,
): Record<string, unknown> {
  const spec = repeatItemSpec(slot)
  if (!spec) return values
  const keys = repeatItemKeys(values[slot.id], spec.max)
  if (!keys.includes(key) || keys.length <= spec.min) return values
  const next: Record<string, unknown> = { ...values, [slot.id]: { items: keys.filter(candidate => candidate !== key) } }
  for (const field of spec.fields) delete next[repeatItemSlotId(slot.id, key, field.id)]
  const marked = sampleFieldNames(next)
  if (marked.length) next[SAMPLE_FIELDS_KEY] = marked
  else delete next[SAMPLE_FIELDS_KEY]
  return next
}

/** Move one item by `delta` places, within the list. */
export function moveRepeatItem(
  values: Record<string, unknown>,
  slot: FieldLike,
  key: string,
  delta: number,
): Record<string, unknown> {
  const spec = repeatItemSpec(slot)
  if (!spec) return values
  const keys = repeatItemKeys(values[slot.id], spec.max)
  const from = keys.indexOf(key)
  const to = from + delta
  if (from < 0 || to < 0 || to >= keys.length || delta === 0) return values
  const order = [...keys]
  order.splice(from, 1)
  order.splice(to, 0, key)
  return { ...values, [slot.id]: { items: order } }
}

/** Starting values for a repeat field: its declared starting items, keyed `i1`, `i2`, … */
export function repeatSampleValues(
  slot: FieldLike,
  sampleOf: (field: SlotDef, sample: unknown) => unknown,
): Record<string, unknown> {
  const spec = repeatItemSpec(slot)
  if (!spec) return {}
  const values: Record<string, unknown> = {}
  const keys: string[] = []
  for (const sample of spec.samples) {
    const key = newRepeatItemKey(keys)
    keys.push(key)
    for (const field of spec.fields) {
      const value = sampleOf(field, sample[field.id])
      if (value !== undefined) values[repeatItemSlotId(slot.id, key, field.id)] = value
    }
  }
  values[slot.id] = { items: keys }
  return values
}
