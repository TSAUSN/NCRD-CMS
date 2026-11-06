import { describe, expect, it } from 'vitest'
import { planSectionReplacement, replacementSection } from './section-replacement.ts'
const field = (id: string, kind = 'text', constraints: Record<string, unknown> = {}) => ({
  id,
  kind,
  label: id,
  constraints,
})
describe('deliberate section layout mapping', () => {
  it('transfers exact compatible IDs without inventing content for new or incompatible fields', () => {
    const plan = planSectionReplacement(
      [field('heading'), field('body', 'richtext'), field('photo', 'image')],
      [field('heading'), field('body'), field('caption')],
      { heading: 'Actual title', body: '<p>Formatted</p>', photo: { src: '/a.png', alt: 'A' } },
    )
    expect(plan.values).toEqual({ heading: 'Actual title' })
    expect(plan.unmapped).toEqual(['body', 'photo'])
    expect(plan.fields[1]!.sourceId).toBeNull()
  })
  it('supports explicit renamed fields, intentional blanks and independent object values', () => {
    const photo = { src: '/a.png?crop=1#view', alt: 'A' }
    const plan = planSectionReplacement(
      [field('heading'), field('image', 'image'), field('button', 'button')],
      [field('title'), field('picture', 'image'), field('link', 'link')],
      { heading: 'Title', image: photo, button: { url: '/next', label: 'Next' } },
      { title: null, picture: 'image', link: 'button' },
    )
    expect(plan.values).toEqual({ picture: photo, link: { url: '/next', label: 'Next' } })
    expect(plan.values.picture).not.toBe(photo)
    expect(plan.unmapped).toEqual(['heading'])
  })
  it('keeps the font, document and media references stored beside the fields', () => {
    const font = { asset_id: '58c8cac6-b0be-4e6b-ab86-7590154c2e86' }
    const plan = planSectionReplacement([field('heading')], [field('title')], { heading: 'Title', 'v1-asset-0': font })
    expect(plan.values).toEqual({ 'v1-asset-0': font })
    expect(plan.unmapped).toEqual(['heading'])
  })
  it('refuses forged fields and incompatible content instead of silently discarding it', () => {
    expect(() =>
      planSectionReplacement([field('body', 'richtext')], [field('title')], { body: '<p>X</p>' }, { title: 'body' }),
    ).toThrow('compatible')
    expect(() => planSectionReplacement([], [], {}, { missing: null })).toThrow('unavailable target')
  })
  it('brings a repeated list’s items into a layout that declares the same item fields', () => {
    const list = (fields: ReturnType<typeof field>[]) => field('cards', 'repeat', { item: { unit: 'Card', fields } })
    const plan = planSectionReplacement(
      [list([field('title'), field('photo', 'image')])],
      [list([field('title'), field('photo', 'text')])],
      {
        cards: { items: ['i2', 'i1'] },
        cards__i1__title: 'One',
        cards__i2__title: 'Two',
        cards__i1__photo: { src: '/media/x/wide', alt: 'X' },
      },
    )
    expect(plan.values).toEqual({ cards: { items: ['i2', 'i1'] }, cards__i1__title: 'One', cards__i2__title: 'Two' })
  })
})
describe('what a replaced section keeps', () => {
  const section = {
    section_def_id: 'old',
    section_def_version: 2,
    values: { heading: 'Old' },
    label: 'Spring appeal',
    hidden: true,
    hidden_at: ['sm'],
    appearance: { surface: 'soft' as const, width: 'wide' as const, mobileOrder: 'reverse' as const },
    raw_html: '<div>custom</div>',
    custom_css: '.x{color:red}',
  }
  it('keeps the page label and visibility, carries only supported appearance and never the old custom source', () => {
    const result = replacementSection(
      section,
      { section_def_id: 'new', version: 4, appearance_support: { layout: true, surface: false } },
      { title: 'Mapped' },
    )
    expect(result.section).toEqual({
      section_def_id: 'new',
      section_def_version: 4,
      values: { title: 'Mapped' },
      label: 'Spring appeal',
      hidden: true,
      hidden_at: ['sm'],
      appearance: { width: 'wide' },
    })
    expect(result.droppedAppearance).toEqual(['Background', 'Phone order'])
    expect(result.droppedSource).toBe(true)
  })
  it('drops every appearance choice for a layout that controls its own appearance and copies values independently', () => {
    const values = { picture: { src: '/a.png', alt: 'A' } }
    const result = replacementSection(
      { ...section, raw_html: undefined, custom_css: ' ' },
      { section_def_id: 'new', version: 1 },
      values,
    )
    expect(result.section).not.toHaveProperty('appearance')
    expect(result.droppedAppearance).toEqual(['Background', 'Width', 'Phone order'])
    expect(result.droppedSource).toBe(false)
    expect(result.section.values.picture).toEqual(values.picture)
    expect(result.section.values.picture).not.toBe(values.picture)
  })
})

it('carries sample consent through renamed fields and repeated items, without marking real content', () => {
  const plan = planSectionReplacement(
    [field('heading'), field('body')],
    [field('title'), field('body')],
    { heading: 'Sample heading', body: 'Real body', __cms_sample_fields: ['heading'] },
    { title: 'heading' },
  )
  expect(plan.values).toEqual({ title: 'Sample heading', body: 'Real body', __cms_sample_fields: ['title'] })
  const list = (id: string) => field(id, 'repeat', { item: { unit: 'Card', fields: [field('title')] } })
  const repeated = planSectionReplacement(
    [list('cards')],
    [list('items')],
    { cards: { items: ['i1'] }, cards__i1__title: 'Example', __cms_sample_fields: ['cards', 'cards__i1__title'] },
    { items: 'cards' },
  )
  expect(repeated.values.__cms_sample_fields).toEqual(['items', 'items__i1__title'])
})
