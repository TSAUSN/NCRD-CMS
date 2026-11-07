import { expect, it } from 'vitest'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { CORE_PAGE_TEMPLATES, coreTemplateContent } from './core-templates.ts'
import { sampleFieldNames } from '@cms/schema'
const definitions = CORE_LIBRARY.map((entry, index) => ({
  id: `definition-${index}`,
  version: 1,
  slug: entry.definition.slug,
  name: entry.definition.name,
  slots: compileCoreSection(entry).slots,
}))
it.each(CORE_PAGE_TEMPLATES)(
  '$name is an ordered composition of global core sections with no empty inserts',
  template => {
    const content = coreTemplateContent(template.id, definitions, 'Our next chapter', 'A real introduction')
    expect(content).toHaveLength(template.sections.length)
    expect(content[0]!.values.heading).toBe('Our next chapter')
    expect(content[0]!.values.intro).toBe('A real introduction')
    expect(sampleFieldNames(content[0]!.values)).not.toContain('heading')
    expect(sampleFieldNames(content[0]!.values)).not.toContain('intro')
    for (const section of content) {
      expect(definitions.some(definition => definition.id === section.section_def_id)).toBe(true)
      expect(Object.keys(section.values).length).toBeGreaterThan(0)
    }
  },
)
it('preserves a supplied body when a simple page header has no story field', () => {
  const content = coreTemplateContent('blank', definitions, 'About', '', '<p>Our own story.</p>')
  expect(content).toHaveLength(2)
  expect(content[1]!.values.body).toBe('<p>Our own story.</p>')
  expect(sampleFieldNames(content[1]!.values)).not.toContain('body')
})
it('fails clearly rather than creating site-scoped copies when a global section is absent', () => {
  expect(() => coreTemplateContent('landing', [], 'Welcome')).toThrow('shared page sections need to be installed')
})

it('keeps the event-home lists short and the dedicated speaker page complete within the safe render bound', () => {
  const home = coreTemplateContent('event-home', definitions, 'Our event')
  expect(home.find(section => section.values.speakers)?.values.speakers).toEqual({
    readerKey: 'speakers',
    selection: { mode: 'automatic', limit: 6 },
  })
  expect(home.find(section => section.values.program)?.values.program).toEqual({
    readerKey: 'program',
    selection: { mode: 'automatic', limit: 3 },
  })
  const speakers = coreTemplateContent('speakers', definitions, 'Speakers')
  expect(speakers[1]!.values.speakers).toEqual({ readerKey: 'speakers', selection: { mode: 'automatic', limit: 100 } })
})

it('starts chapter boards and photos hidden, with page-owned samples and no member or story list', () => {
  const content = coreTemplateContent('chapter', definitions, '[Chapter name]')
  expect(content.map(section => section.label)).toEqual([
    'Page header',
    'About this chapter',
    'Board',
    'Photos',
    'Join us',
  ])
  expect(content.map(section => section.hidden)).toEqual([false, false, true, true, false])
  expect(
    content.every(
      section =>
        !Object.values(section.values).some(value => value && typeof value === 'object' && 'readerKey' in value),
    ),
  ).toBe(true)
  const board = content[2]!.values
  expect(board.cards__i1__title).toBe('[Board member 1] (sample)')
  expect(board.cards__i2__title).toBe('[Board member 2] (sample)')
  expect(sampleFieldNames(board)).toContain('cards__i1__title')
  expect(content[1]!.values.body).toBe('<p>[Chapter paragraph]</p>')
  expect(JSON.stringify(content)).not.toMatch(/roster|stories|news|Jordan Lee/)
})

it('keeps the generic Echelon News images as explicit template samples instead of clearing them to broken links', () => {
  const content = coreTemplateContent('echelon-home', definitions, '[Page]'),
    news = content.find(s => definitions.find(d => d.id === s.section_def_id)?.slug === 'core-image-link-cards')!
  for (const key of ['cards__i1__photo', 'cards__i2__photo']) {
    expect(news.values[key]).toEqual({
      src: '/cms-samples/r8-square.png',
      alt: 'Abstract illustration (sample)',
      decorative: false,
    })
    expect(sampleFieldNames(news.values)).toContain(key)
  }
})

it('keeps an explicit hero sample in the generic Echelon starting design', () => {
  const content = coreTemplateContent('echelon-home', definitions, '[Page]')
  expect(content[0]!.values.photo).toMatchObject({ src: '/cms-samples/r8-landscape.png' })
})

it('starts a blank page with a styled header and editable, explicitly marked sample text', () => {
  const content = coreTemplateContent('blank', definitions, 'Our information')
  expect(
    content.map(section => definitions.find(definition => definition.id === section.section_def_id)?.slug),
  ).toEqual(['core-page-header', 'core-text-block'])
  expect(content[0]!.values.heading).toBe('Our information')
  expect(content[1]!.values.body).toEqual(expect.any(String))
  expect(String(content[1]!.values.body).length).toBeGreaterThan(0)
  expect(sampleFieldNames(content[1]!.values)).toContain('body')
})
