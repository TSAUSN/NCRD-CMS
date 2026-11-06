import { it, expect } from 'vitest'
import { CORE_LIBRARY } from '@cms/seeds/core-library'
import type { EditorDocument } from '@cms/domain'
import { pageLeaveSnapshot } from './page-leave.ts'
import { addEditorRepeatItem } from './editor-repeat-item.ts'
const cards = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-feature-tiles')!.definition,
  hero = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-feature-slider')!.definition
if (cards.kind !== 'legacy' || hero.kind !== 'legacy') throw Error('Expected native fields')
const cardSlot = cards.slots.find(field => field.id === 'cards')!,
  slideSlot = hero.slots.find(field => field.id === 'slides')!,
  forms = new Map([
    ['cards:1', { slots: cards.slots }],
    ['hero:1', { slots: hero.slots }],
  ])
const doc = (values: Record<string, unknown>, id = 'cards'): EditorDocument => ({
  sections: [{ section_def_id: id, section_def_version: 1, values }],
  meta: { description: '[Keep description]' },
  identity: { title: '[Page]', address: 'page' },
})
it('removes only a new untouched card and preserves existing empty cards and metadata', () => {
  const values = { cards: { items: ['i1'] }, cards__i1__title: '' },
    opening = { document: doc(values), sectionOrigins: ['same'] },
    added = addEditorRepeatItem(values, cardSlot, { empty: true }),
    current = { document: doc(added.values), sectionOrigins: ['same'] },
    before = structuredClone(current)
  expect(pageLeaveSnapshot(current, opening, forms)).toEqual(opening)
  expect(current).toEqual(before)
})
it('retains a new authored card even if the item was autosaved before Done', () => {
  const opening = { document: doc({ cards: { items: [] } }), sectionOrigins: ['same'] },
    added = addEditorRepeatItem({ cards: { items: [] } }, cardSlot, { empty: true })
  added.values['cards__' + added.key + '__title'] = 'Protection'
  const current = { document: doc(added.values), sectionOrigins: ['same'] }
  expect(pageLeaveSnapshot(current, opening, forms)).toEqual(current)
})
it('does not treat a hero on switch or dates alone as authored slide content', () => {
  const opening = { document: doc({ slides: { items: [] } }, 'hero'), sectionOrigins: ['hero'] },
    added = addEditorRepeatItem({ slides: { items: [] } }, slideSlot)
  added.values['slides__' + added.key + '__starts_at'] = '2027-01-01T00:00:00Z'
  expect(pageLeaveSnapshot({ document: doc(added.values, 'hero'), sectionOrigins: ['hero'] }, opening, forms)).toEqual(
    opening,
  )
  added.values['slides__' + added.key + '__title'] = '[Keep words]'
  expect(
    pageLeaveSnapshot({ document: doc(added.values, 'hero'), sectionOrigins: ['hero'] }, opening, forms).document
      .sections[0]!.values,
  ).toEqual(added.values)
})
it('uses section origins after a reorder and never edits the opening snapshot', () => {
  const opening = {
      document: {
        sections: [
          doc({ cards: { items: ['i1'] }, cards__i1__title: '[Keep card]' }).sections[0]!,
          doc({ slides: { items: [] } }, 'hero').sections[0]!,
        ],
        meta: {},
      },
      sectionOrigins: ['cards', 'hero'],
    },
    before = structuredClone(opening),
    added = addEditorRepeatItem(opening.document.sections[0]!.values, cardSlot, { empty: true }),
    current = {
      document: {
        sections: [opening.document.sections[1]!, { ...opening.document.sections[0]!, values: added.values }],
        meta: {},
      },
      sectionOrigins: ['hero', 'cards'],
    }
  expect(pageLeaveSnapshot(current, opening, forms).document.sections[1]!.values).toEqual(
    opening.document.sections[0]!.values,
  )
  expect(opening).toEqual(before)
})
