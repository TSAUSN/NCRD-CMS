import { describe, it, expect } from 'vitest'
import { collectionTemplateNode } from './collection-templates.ts'
import {
  collectionTemplateSpec,
  repeatItemSpec,
  repeatTemplateSpec,
  addRepeatItem,
  editableSlots,
} from './repeat-items.ts'
const slot = {
  id: 'speakers',
  kind: 'repeat',
  label: 'Speakers',
  constraints: {
    collection: true,
    item: {
      unit: 'Speaker',
      fields: [
        { id: 'name', kind: 'text', label: 'Name' },
        { id: 'photo', kind: 'image', label: 'Photo' },
      ],
    },
  },
}
describe('explicit native lists in original templates', () => {
  it('projects only declared typed item fields for the existing list compatibility gate', () => {
    expect(collectionTemplateNode(slot)).toEqual({
      type: 'repeat',
      field: 'speakers',
      item: [
        { type: 'text', field: 'name' },
        { type: 'image', field: 'photo' },
      ],
      empty: { behavior: 'hide' },
    })
    expect(collectionTemplateNode({ ...slot, constraints: { ...slot.constraints, collection: false } })).toBeNull()
  })
  it('keeps bound items out of page-owned manual editing and history', () => {
    const values = { speakers: { readerKey: 'speakers', selection: { mode: 'automatic', limit: 50 } } }
    expect(repeatItemSpec(slot)).toBeNull()
    expect(repeatTemplateSpec(slot)?.fields).toHaveLength(2)
    expect(collectionTemplateSpec(slot)?.unit).toBe('Speaker')
    expect(editableSlots([slot], values)).toEqual([slot])
    expect(addRepeatItem(values, slot)).toEqual({ values, key: null })
  })
  it('refuses malformed item declarations, nested repeats and unsupported sinks', () => {
    for (const fields of [
      [],
      [{ id: 'name', kind: 'script', label: 'Script' }],
      [{ id: 'name', kind: 'repeat', label: 'Nested' }],
      [{ id: 'name', kind: 'button', label: 'Button' }],
    ])
      expect(collectionTemplateNode({ ...slot, constraints: { collection: true, item: { fields } } })).toBeNull()
  })
})
