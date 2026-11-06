import { describe, expect, it } from 'vitest'
import type { SlotDef } from './sections.ts'
import {
  addRepeatItem,
  editableSlots,
  moveRepeatItem,
  parseRepeatItemSlotId,
  removeRepeatItem,
  repeatItemKeys,
  repeatItemSlotId,
  repeatItemSpec,
  slotForId,
} from './repeat-items.ts'
import { sourceSampleValues } from './source-samples.ts'

const cards: SlotDef = {
  id: 'cards',
  kind: 'repeat',
  label: 'Cards',
  constraints: {
    item: {
      unit: 'Card',
      min: 1,
      max: 4,
      fields: [
        { id: 'title', kind: 'text', label: 'Title' },
        { id: 'photo', kind: 'image', label: 'Photo' },
      ],
      samples: [
        { title: 'Compassionate care', photo: { src: '/media/a/original', alt: 'A meal' } },
        { title: 'Safe places' },
      ],
    },
  },
}
const heading: SlotDef = {
  id: 'heading',
  kind: 'text',
  label: 'Heading',
  constraints: { sourceSample: 'Why it works' },
}

describe('a repeated list of items', () => {
  it('reads its item declaration and refuses a malformed one', () => {
    expect(repeatItemSpec(cards)).toMatchObject({
      unit: 'Card',
      min: 1,
      max: 4,
      fields: [{ id: 'title' }, { id: 'photo' }],
    })
    expect(repeatItemSpec({ ...cards, kind: 'text' })).toBeNull()
    expect(repeatItemSpec({ ...cards, constraints: {} })).toBeNull()
    for (const fields of [
      [],
      [{ id: 'a__b', kind: 'text', label: 'X' }],
      [{ id: 'list', kind: 'repeat', label: 'Nested' }],
      [
        { id: 'a', kind: 'text', label: 'A' },
        { id: 'a', kind: 'text', label: 'Again' },
      ],
      [{ id: 'x'.repeat(60), kind: 'text', label: 'Long' }],
    ]) {
      expect(repeatItemSpec({ ...cards, constraints: { item: { fields } } })).toBeNull()
    }
  })

  it('starts with the declared items, each under its own stable key', () => {
    expect(sourceSampleValues([heading, cards])).toEqual({
      heading: 'Why it works',
      cards: { items: ['i1', 'i2'] },
      cards__i1__title: 'Compassionate care',
      cards__i1__photo: { src: '/media/a/original', alt: 'A meal', decorative: false },
      cards__i2__title: 'Safe places',
    })
  })

  it('names every item field an editor can reach, in order', () => {
    const values = sourceSampleValues([heading, cards])
    expect(editableSlots([heading, cards], values).map(slot => [slot.id, slot.label])).toEqual([
      ['heading', 'Heading'],
      ['cards__i1__title', 'Card 1 · Title'],
      ['cards__i1__photo', 'Card 1 · Photo'],
      ['cards__i2__title', 'Card 2 · Title'],
      ['cards__i2__photo', 'Card 2 · Photo'],
    ])
    expect(slotForId([heading, cards], values, 'cards__i2__photo')).toMatchObject({
      kind: 'image',
      label: 'Card 2 · Photo',
      repeat: { key: 'i2', index: 1, count: 2 },
    })
    expect(slotForId([heading, cards], values, 'cards__i9__photo')).toBeUndefined()
    expect(parseRepeatItemSlotId('heading')).toBeNull()
    expect(repeatItemKeys({ items: ['i1', 'i1', 'BAD', 3, 'i2'] })).toEqual(['i1', 'i2'])
  })

  it('adds, duplicates, moves and removes items without touching another item’s values', () => {
    let values = sourceSampleValues([cards])
    const added = addRepeatItem(values, cards, { after: 'i1' })
    expect(added.key).toBe('i3')
    expect(repeatItemKeys(added.values['cards'])).toEqual(['i1', 'i3', 'i2'])
    // A new item takes the starting item for its position.
    expect(added.values[repeatItemSlotId('cards', 'i3', 'title')]).toBe('Safe places')
    values = addRepeatItem(added.values, cards, { from: 'i1' }).values
    expect(repeatItemKeys(values['cards'])).toEqual(['i1', 'i3', 'i2', 'i4'])
    expect(values['cards__i4__photo']).toEqual(values['cards__i1__photo'])
    expect(values['cards__i4__photo']).not.toBe(values['cards__i1__photo'])
    // At the declared maximum, nothing is added.
    expect(addRepeatItem(values, cards)).toEqual({ values, key: null })
    values = moveRepeatItem(values, cards, 'i4', -3)
    expect(repeatItemKeys(values['cards'])).toEqual(['i4', 'i1', 'i3', 'i2'])
    expect(moveRepeatItem(values, cards, 'i4', -1)).toBe(values)
    values = removeRepeatItem(removeRepeatItem(removeRepeatItem(values, cards, 'i1'), cards, 'i3'), cards, 'i2')
    expect(values).toEqual({
      cards: { items: ['i4'] },
      cards__i4__title: 'Compassionate care',
      cards__i4__photo: { src: '/media/a/original', alt: 'A meal', decorative: false },
    })
    // Not below the declared minimum.
    expect(removeRepeatItem(values, cards, 'i4')).toBe(values)
  })
})
