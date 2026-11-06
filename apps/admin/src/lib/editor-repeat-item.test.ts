import { expect, it } from 'vitest'
import { CORE_LIBRARY } from '@cms/seeds/core-library'
import { addEditorRepeatItem, discardNewRepeatItem, repeatItemHasContent } from './editor-repeat-item.ts'
import { addRepeatItem } from '@cms/schema'
const board = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-chapter-board')!.definition
if (board.kind !== 'legacy') throw new Error('Expected the chapter board fields.')
const slot = board.slots.find(slot => slot.id === 'cards')!
it('adds neutral chapter board placeholders and preserves deliberate duplicates', () => {
  const added = addEditorRepeatItem({ cards: { items: [] } }, slot),
    key = added.key!
  expect(added.values['cards__' + key + '__title']).toBe('[Name] (sample)')
  expect(added.values['cards__' + key + '__description']).toBe('[Board role]')
  expect(added.values['cards__' + key + '__action']).toEqual({ label: 'Contact', url: 'mailto:chapter@example.test' })
  const own = { ...added.values, ['cards__' + key + '__title']: '[Authored name]' }
  const copy = addEditorRepeatItem(own, slot, { from: key })
  expect(copy.values['cards__' + copy.key + '__title']).toBe('[Authored name]')
})
it('leaves ordinary repeated sections on their designed sample defaults', () => {
  const ordinary = { ...slot, constraints: { ...slot.constraints, boardCards: false } }
  expect(addEditorRepeatItem({ cards: { items: [] } }, ordinary)).toEqual(
    addRepeatItem({ cards: { items: [] } }, ordinary),
  )
})

it('starts a new hero slide empty and removes its sample marks while duplicates preserve authored content', () => {
  const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-feature-slider')!.definition
  if (entry.kind !== 'legacy') throw new Error('Expected hero fields')
  const slot = entry.slots.find(slot => slot.id === 'slides')!,
    added = addEditorRepeatItem({ slides: { items: [] } }, slot),
    key = added.key!
  expect(added.values['slides__' + key + '__title']).toBe('')
  expect(added.values['slides__' + key + '__photo']).toBeNull()
  expect(added.values).not.toHaveProperty('__cms_sample_fields')
  const own = { ...added.values, ['slides__' + key + '__title']: '[Own heading]' },
    copy = addEditorRepeatItem(own, slot, { from: key })
  expect(copy.values['slides__' + copy.key + '__title']).toBe('[Own heading]')
})

it('starts native cards empty, keeps other content and cancels every newly composed field', () => {
  const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-feature-tiles')!.definition
  if (entry.kind !== 'legacy') throw Error('fixture')
  const slot = entry.slots.find(field => field.id === 'cards')!,
    values = {
      heading: '[Keep heading]',
      cards: { items: ['i1'] },
      cards__i1__title: '[Keep card]',
      cards__i1__icon: 'heart',
      __cms_sample_fields: ['cards__i1__icon'],
    }
  const added = addEditorRepeatItem(values, slot, { empty: true }),
    key = added.key!
  expect(added.values['cards__' + key + '__title']).toBe('')
  expect(added.values.__cms_sample_fields).toEqual(['cards__i1__icon'])
  expect(repeatItemHasContent(added.values, slot, key)).toBe(false)
  const typed = { ...added.values, ['cards__' + key + '__title']: '[Protection]' }
  expect(repeatItemHasContent(typed, slot, key)).toBe(true)
  expect(discardNewRepeatItem(typed, slot, key)).toEqual(values)
  const duplicate = addEditorRepeatItem(values, slot, { empty: true, from: 'i1' })
  expect(duplicate.values['cards__' + duplicate.key + '__title']).toBe('[Keep card]')
})
it('cancels an untouched first insertion even when the template has a minimum, without changing its rule', () => {
  const slot = {
      id: 'cards',
      kind: 'repeat',
      label: 'Cards',
      constraints: { item: { min: 1, max: 3, fields: [{ id: 'body', kind: 'richtext', label: 'Text' }] } },
    },
    before = { cards: { items: [] } },
    added = addEditorRepeatItem(before, slot, { empty: true })
  expect(
    repeatItemHasContent({ ...added.values, ['cards__' + added.key + '__body']: '<p>&nbsp;</p>' }, slot, added.key!),
  ).toBe(false)
  expect(discardNewRepeatItem(added.values, slot, added.key!)).toEqual(before)
  expect(slot.constraints.item.min).toBe(1)
})
