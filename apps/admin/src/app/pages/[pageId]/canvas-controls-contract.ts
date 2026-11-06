import { SLOT_ID } from '@cms/schema/slot-id'
import { repeatItemKeys, repeatItemSpec, type FieldLike } from '@cms/schema/repeat-items'
import type { EditorSection } from '@cms/domain'
export type CanvasControls = {
  sections: EditorSection[]
  fields: FieldLike[][]
  selected: number | null
  slot: string | null
  listItem: { readerKey: string; stableKey: string; field: string } | null
  scale: number
  canReset: boolean
  preserveLayout: boolean
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const READER = /^[a-z][a-z0-9_]{0,63}$/
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
/** A bounded display projection. Source HTML, CSS and executable definitions
 * never cross this UI protocol; edits still return to the main page editor. */
export function parseCanvasControls(value: unknown): CanvasControls | null {
  try {
    if (
      !record(value) ||
      !only(value, ['sections', 'selected', 'slot', 'listItem', 'scale', 'canReset', 'preserveLayout']) ||
      JSON.stringify(value).length > 524288 ||
      (value['preserveLayout'] !== undefined && typeof value['preserveLayout'] !== 'boolean') ||
      !Array.isArray(value['sections']) ||
      value['sections'].length > 200 ||
      typeof value['scale'] !== 'number' ||
      !Number.isFinite(value['scale']) ||
      value['scale'] < 0.05 ||
      value['scale'] > 4 ||
      typeof value['canReset'] !== 'boolean'
    )
      return null
    const sections: EditorSection[] = [],
      fields: FieldLike[][] = []
    for (const row of value['sections']) {
      if (
        !record(row) ||
        !only(row, ['id', 'version', 'label', 'hidden', 'fields', 'values']) ||
        typeof row['id'] !== 'string' ||
        !UUID.test(row['id']) ||
        !Number.isSafeInteger(row['version']) ||
        Number(row['version']) < 1 ||
        typeof row['label'] !== 'string' ||
        row['label'].length > 2000 ||
        typeof row['hidden'] !== 'boolean' ||
        !Array.isArray(row['fields']) ||
        row['fields'].length > 200 ||
        !record(row['values'])
      )
        return null
      const slots: FieldLike[] = [],
        values: Record<string, unknown> = Object.create(null)
      for (const field of row['fields']) {
        if (
          !record(field) ||
          !only(field, ['id', 'label', 'kind', 'constraints']) ||
          typeof field['id'] !== 'string' ||
          !SLOT_ID.test(field['id']) ||
          field['kind'] !== 'repeat' ||
          typeof field['label'] !== 'string' ||
          field['label'].length > 300 ||
          (field['constraints'] !== undefined && !record(field['constraints'])) ||
          slots.some(slot => slot.id === field['id'])
        )
          return null
        const slot: FieldLike = {
          id: field['id'],
          label: field['label'],
          kind: 'repeat',
          ...(field['constraints'] === undefined ? {} : { constraints: field['constraints'] }),
        }
        const spec = repeatItemSpec(slot),
          content = row['values'][slot.id]
        if (spec) {
          if (!record(content) || !only(content, ['items']) || !Array.isArray(content['items'])) return null
          const keys = repeatItemKeys(content, spec.max)
          if (keys.length !== content['items'].length) return null
          values[slot.id] = { items: keys }
        } else {
          if (
            !record(content) ||
            !only(content, ['readerKey']) ||
            typeof content['readerKey'] !== 'string' ||
            !READER.test(content['readerKey'])
          )
            return null
          values[slot.id] = { readerKey: content['readerKey'] }
        }
        slots.push(slot)
      }
      if (Object.keys(row['values']).some(key => !slots.some(slot => slot.id === key))) return null
      sections.push({
        section_def_id: row['id'],
        section_def_version: Number(row['version']),
        values,
        label: row['label'],
        hidden: row['hidden'],
      })
      fields.push(slots)
    }
    const selected = value['selected'],
      slot = value['slot'],
      item = value['listItem']
    if (
      (selected !== null &&
        (!Number.isSafeInteger(selected) || Number(selected) < 0 || Number(selected) >= sections.length)) ||
      (slot !== null && (typeof slot !== 'string' || !SLOT_ID.test(slot))) ||
      (selected === null && slot !== null)
    )
      return null
    let listItem: CanvasControls['listItem'] = null
    if (item !== null) {
      if (
        !record(item) ||
        !only(item, ['readerKey', 'stableKey', 'field']) ||
        typeof item['readerKey'] !== 'string' ||
        !READER.test(item['readerKey']) ||
        typeof item['stableKey'] !== 'string' ||
        item['stableKey'].length > 200 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item['stableKey']) ||
        typeof item['field'] !== 'string' ||
        !SLOT_ID.test(item['field']) ||
        selected === null
      )
        return null
      const binding = sections[Number(selected)]?.values[item['field']]
      if (!record(binding) || binding['readerKey'] !== item['readerKey']) return null
      listItem = { readerKey: item['readerKey'], stableKey: item['stableKey'], field: item['field'] }
    }
    return {
      sections,
      fields,
      selected: selected as number | null,
      slot: slot as string | null,
      listItem,
      scale: value['scale'],
      canReset: value['canReset'],
      preserveLayout: value['preserveLayout'] === true,
    }
  } catch {
    return null
  }
}
