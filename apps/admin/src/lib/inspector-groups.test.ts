import { describe, expect, it } from 'vitest'
import { focusedInspectorGroups, inspectorFieldGroups, linkWordsName } from './inspector-groups.ts'

const slot = (id: string, kind: string, label: string, constraints: Record<string, unknown> = {}) => ({
  id,
  kind,
  label,
  constraints,
})
const destination = (id: string, label: string) => slot(id, 'link', label, { destinationOnly: true })

describe('inspector field groups', () => {
  it('keeps linked words together and brings the chosen field or repeated item first', () => {
    const fields = [
      slot('photo', 'image', 'Photo'),
      destination('link', 'Action · destination'),
      slot('words', 'text', 'Action · label'),
      slot('cards', 'repeat', 'Cards'),
    ]
    expect(focusedInspectorGroups(fields, 'words')[0]).toMatchObject({ kind: 'link', destination: { id: 'link' } })
    expect(focusedInspectorGroups(fields, 'cards__i2__title')[0]).toMatchObject({
      kind: 'single',
      slot: { id: 'cards' },
    })
    expect(focusedInspectorGroups(fields, null)).toEqual(inspectorFieldGroups(fields))
  })
  it('shows an imported link’s words and destination together, in source order', () => {
    const groups = inspectorFieldGroups([
      slot('t', 'text', 'Hero title'),
      destination('d1', 'Home overview link · destination'),
      slot('w1', 'text', 'Home overview link · label'),
      destination('d2', 'Card · destination'),
      slot('w2a', 'text', 'Card · label · part 1'),
      slot('w2b', 'text', 'Card · label · part 2'),
      slot('after', 'text', 'Closing line'),
    ])
    expect(
      groups.map(group =>
        group.kind === 'single'
          ? group.slot.id
          : `${group.name}: ${group.destination.id} ${group.words.map(word => word.id).join(',')}`,
      ),
    ).toEqual(['t', 'Home overview link: d1 w1', 'Card: d2 w2a,w2b', 'after'])
  })

  it('keeps fields apart when they are not one imported link', () => {
    const groups = inspectorFieldGroups([
      // A whole link field already holds its own words.
      slot('full', 'link', 'Call to action · destination'),
      slot('x', 'text', 'Call to action · label'),
      // Words that belong to a different link, or come later, are not taken.
      destination('d', 'Learn more · destination'),
      slot('y', 'text', 'Methodology · label'),
      destination('e', 'Lone · destination'),
      slot('z', 'text', 'Lone · label'),
    ])
    expect(groups.filter(group => group.kind === 'link').map(group => group.kind === 'link' && group.name)).toEqual([
      'Lone',
    ])
    expect(groups).toHaveLength(5)
    // Two links with the same name each keep their own words.
    const twins = inspectorFieldGroups([
      destination('a', 'More · destination · part 1'),
      slot('a1', 'text', 'More · label · part 1'),
      destination('b', 'More · destination · part 2'),
      slot('b1', 'text', 'More · label · part 2'),
    ])
    expect(
      twins.map(group =>
        group.kind === 'link' ? `${group.destination.id}:${group.words.map(word => word.id)}` : 'single',
      ),
    ).toEqual(['a:a1', 'b:b1'])
  })

  it('names a link’s words by which words they are when the importer split them', () => {
    const [card] = inspectorFieldGroups([
      destination('d', 'About card (link) · destination'),
      slot('h', 'text', 'About card (link) · label · heading'),
      slot('p', 'text', 'About card (link) · label · paragraph'),
      slot('x', 'text', 'Closing line'),
    ])
    if (card?.kind !== 'link') throw new Error('expected a link group')
    expect(card.words.map(word => linkWordsName(card, word))).toEqual([
      'Words people click · heading',
      'Words people click · paragraph',
    ])
    const [older] = inspectorFieldGroups([
      destination('d', 'Card · destination'),
      slot('a', 'text', 'Card · label · part 1'),
      slot('b', 'text', 'Card · label · part 2'),
    ])
    if (older?.kind !== 'link') throw new Error('expected a link group')
    expect(older.words.map(word => linkWordsName(older, word))).toEqual([
      'Words people click · part 1',
      'Words people click · part 2',
    ])
    const [single] = inspectorFieldGroups([destination('d', 'Learn · destination'), slot('w', 'text', 'Learn · label')])
    if (single?.kind !== 'link') throw new Error('expected a link group')
    expect(linkWordsName(single, single.words[0]!)).toBe('Words people click')
  })
})
