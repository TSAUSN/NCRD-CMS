import { expect, it } from 'vitest'
import { CORE_LIBRARY } from '@cms/seeds/core-library'
import { structureFields } from './structure-fields.ts'
const def = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-feature-slider')!.definition
if (def.kind !== 'legacy') throw Error('fixture')
it('navigates a hero by one photo target per slide and retains all words for search', () => {
  const values = {
    slides: { items: ['i1', 'i2'] },
    slides__i1__title: '[First story]',
    slides__i1__intro: '[Find these details]',
    slides__i2__title: '[Second story]',
  }
  const fields = structureFields(def.slots, values),
    slides = fields.filter(field => field.id.startsWith('slides__'))
  expect(slides.map(field => [field.id, field.label])).toEqual([
    ['slides__i1__photo', 'Slide 1: [First story]'],
    ['slides__i2__photo', 'Slide 2: [Second story]'],
  ])
  expect(slides[0]!.searchValues).toContain('[Find these details]')
  expect(slides[0]!.memberIds).toContain('slides')
  expect(slides[0]!.memberIds).toContain('slides__i1__ends_at')
  expect(slides[0]!.memberIds).toContain('slides__i1__title')
  expect(fields.some(field => field.id === 'heading')).toBe(true)
})
it('keeps ordinary repeated card fields and their original selection targets', () => {
  const card = {
    id: 'cards',
    kind: 'repeat',
    label: 'Cards',
    constraints: { item: { fields: [{ id: 'title', kind: 'text', label: 'Title' }] } },
  }
  expect(
    structureFields([card], { cards: { items: ['i1'] }, cards__i1__title: '[Card]' }).map(field => field.id),
  ).toEqual(['cards__i1__title'])
})

it('groups native cards into one navigation row while retaining every field for selection and search', () => {
  const card = {
    id: 'cards',
    kind: 'repeat',
    label: 'Cards',
    constraints: {
      item: {
        unit: 'Card',
        fields: [
          { id: 'icon', kind: 'text', label: 'Icon', constraints: { presentation: 'icon' } },
          { id: 'title', kind: 'text', label: 'Title' },
          { id: 'body', kind: 'richtext', label: 'Text' },
          { id: 'action', kind: 'link', label: 'Link' },
        ],
      },
    },
  }
  const values = {
    cards: { items: ['i1', 'i2'] },
    cards__i1__icon: 'shield',
    cards__i1__title: '',
    cards__i1__body: '<p>Meeting <strong>human need</strong></p>',
    cards__i1__action: { label: 'Find this destination', url: '/help' },
    cards__i2__title: '[Second card]',
  }
  const rows = structureFields([card], values, true)
  expect(rows.map(row => [row.id, row.label])).toEqual([
    ['cards__i1__icon', 'Card 1: Meeting human need'],
    ['cards__i2__icon', 'Card 2: [Second card]'],
  ])
  expect(rows[0]!.memberIds).toEqual([
    'cards',
    'cards__i1__icon',
    'cards__i1__title',
    'cards__i1__body',
    'cards__i1__action',
  ])
  expect(rows[0]!.searchValues).toContainEqual(values.cards__i1__action)
  expect(structureFields([card], values).length).toBe(8)
})
