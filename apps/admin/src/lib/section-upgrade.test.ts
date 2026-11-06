import { describe, expect, it } from 'vitest'
import { planSectionUpgrade } from './section-upgrade.ts'

describe('explicit section version changes', () => {
  const old = [
    { id: 'heading', kind: 'text', label: 'Heading' },
    { id: 'body', kind: 'richtext', label: 'Body' },
  ]
  it('preserves matching values and reports added and removed fields', () => {
    const next = [
      { ...old[0]!, label: 'Title' },
      { id: 'link', kind: 'link', label: 'Action' },
    ]
    expect(planSectionUpgrade(old, next, { heading: 'Keep this', body: '<p>Recover from checkpoint</p>' })).toEqual({
      added: ['Action'],
      removed: ['Body'],
      changed: [],
      values: { heading: 'Keep this' },
    })
  })
  it('does not reinterpret text containing markup as formatted text after a type change', () => {
    const result = planSectionUpgrade(old, [{ ...old[0]!, kind: 'richtext' }], { heading: '<img src=x>', body: 'old' })
    expect(result.changed).toEqual(['Heading'])
    expect(result.values).toEqual({})
  })
  it('asks for an icon choice when ordinary text becomes an icon field', () => {
    expect(
      planSectionUpgrade(old, [{ ...old[0]!, constraints: { presentation: 'cms-line-icons-v1' } }], {
        heading: 'A heading',
      }),
    ).toMatchObject({ changed: ['Heading'], values: {} })
  })
  it('keeps the value shape shared by labelled links and buttons', () => {
    expect(
      planSectionUpgrade([{ id: 'cta', kind: 'button', label: 'CTA' }], [{ id: 'cta', kind: 'link', label: 'CTA' }], {
        cta: { label: 'Read more', url: '/' },
      }).values,
    ).toEqual({ cta: { label: 'Read more', url: '/' } })
  })
  it('keeps the font, document and media references stored beside the fields', () => {
    const references = {
      'v1-asset-0': { asset_id: '58c8cac6-b0be-4e6b-ab86-7590154c2e86' },
      'v1-media-0': { media_id: '7a9932e3-ca0f-4f48-a8d8-1899d11882e6', variant: 'original' },
    }
    expect(planSectionUpgrade(old, old, { heading: 'Keep this', ...references }).values).toEqual({
      heading: 'Keep this',
      ...references,
    })
    // A removed field's value is not a reference, even when it looks like one.
    expect(
      planSectionUpgrade([...old, { id: 'photo', kind: 'image', label: 'Photo' }], old, {
        photo: references['v1-media-0'],
      }).values,
    ).toEqual({})
  })
  it('does not mistake inherited object properties for saved field values', () => {
    expect(
      planSectionUpgrade(
        [{ id: 'toString', kind: 'text', label: 'Text' }],
        [{ id: 'toString', kind: 'text', label: 'Text' }],
        {},
      ).values,
    ).toEqual({})
  })

  // LIB-02: a repeated list's items travel with it.
  const cards = (
    fields: { id: string; kind: string; label: string; constraints?: Record<string, unknown> }[],
    extra: Record<string, unknown> = {},
  ) => ({ id: 'cards', kind: 'repeat', label: 'Cards', constraints: { item: { unit: 'Card', fields, ...extra } } })
  it('keeps a list’s items and every item field that keeps its id and kind', () => {
    const before = [
      cards([
        { id: 'title', kind: 'text', label: 'Title' },
        { id: 'body', kind: 'text', label: 'Body' },
      ]),
    ]
    const after = [
      cards([
        { id: 'title', kind: 'text', label: 'Title' },
        { id: 'body', kind: 'richtext', label: 'Body' },
        { id: 'more', kind: 'link', label: 'Link' },
      ]),
    ]
    const values = {
      cards: { items: ['i2', 'i1'] },
      cards__i1__title: 'One',
      cards__i2__title: 'Two',
      cards__i1__body: 'Plain',
      cards__i9__title: 'Removed earlier',
    }
    expect(planSectionUpgrade(before, after, values)).toEqual({
      added: ['Cards · Link'],
      changed: ['Cards · Body'],
      removed: [],
      values: { cards: { items: ['i2', 'i1'] }, cards__i1__title: 'One', cards__i2__title: 'Two' },
    })
  })
  it('moves what an editor wrote in numbered copies into the list that replaces them', () => {
    const numbered = [
      { id: 'heading', kind: 'text', label: 'Heading' },
      { id: 'v1-a', kind: 'text', label: 'Card 1 Title' },
      { id: 'v1-b', kind: 'text', label: 'Card 2 Title' },
    ]
    const after = [
      numbered[0]!,
      cards(
        [
          { id: 'icon', kind: 'text', label: 'Icon', constraints: { presentation: 'v1-source-drawings' } },
          { id: 'title', kind: 'text', label: 'Title' },
        ],
        {
          samples: [
            { icon: 'd0000000001', title: 'Sample one' },
            { icon: 'd0000000002', title: 'Sample two' },
          ],
          from: [{ title: 'v1-a' }, { title: 'v1-b' }],
        },
      ),
    ]
    expect(planSectionUpgrade(numbered, after, { heading: 'Why', 'v1-a': 'Edited one', 'v1-b': 'Edited two' })).toEqual(
      {
        added: [],
        changed: [],
        removed: [],
        values: {
          heading: 'Why',
          cards: { items: ['i1', 'i2'] },
          cards__i1__title: 'Edited one',
          cards__i2__title: 'Edited two',
          // The drawing each copy kept as markup is its starting drawing.
          cards__i1__icon: 'd0000000001',
          cards__i2__icon: 'd0000000002',
        },
      },
    )
  })
})
