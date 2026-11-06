import { it, expect } from 'vitest'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { echelonNationalTemplate, ECHELON_NATIONAL_SOCIAL } from './echelon-national-template.ts'
import { ECHELON_MEDIA_KEYS } from './echelon-media-values.ts'
import { chapterAllowsSection } from '@cms/schema'
const definitions = CORE_LIBRARY.map((entry, index) => ({
    id: String(index),
    version: 1,
    name: entry.definition.name,
    slug: entry.definition.slug,
    slots: compileCoreSection(entry).slots,
  })),
  media = Object.fromEntries(
    Object.values(ECHELON_MEDIA_KEYS).map(key => [
      key,
      {
        src: '/media/' + key + '/original',
        alt: '[Described reference image]',
        decorative: false,
        focal: { x: 0.5, y: 0.5 },
      },
    ]),
  )
it('assembles the approved national map with all reference Media,exact approved replacements and no chapter events', () => {
  const content = echelonNationalTemplate(definitions, media),
    slugs = content.map(section => definitions.find(def => def.id === section.section_def_id)!.slug)
  expect(slugs).toEqual([
    'core-echelon-hero',
    'core-echelon-jump-links',
    'core-echelon-directory',
    'core-echelon-about',
    'core-echelon-who',
    'core-echelon-pillars',
    'core-echelon-stories',
    'core-echelon-leadership',
    'core-echelon-faq',
    'core-echelon-contact',
  ])
  expect(content.every(section => section.values.__cms_echelon_template === 'national')).toBe(true)
  expect(content[1]!.values.accounts_from).toBe('site')
  expect(content[4]!.values.paragraph_one).toContain('emerging professionals across the country')
  expect(content[4]!.values.paragraph_three).toBe(
    'Through hands-on service, social gatherings and fundraising, our chapters bring people together to support their neighbors and learn about the needs of their communities.',
  )
  expect(content[5]!.values.intro).toContain('ongoing community needs')
  expect(content[9]!.values.level).toBe('National')
  const cards = content[6]!.values
  expect(cards.cards).toEqual({ items: ['i1', 'i2', 'i3'] })
  expect(cards.cards__i1__photo).toEqual(media[ECHELON_MEDIA_KEYS.story_one])
  expect(cards.cards__i2__photo).toEqual(media[ECHELON_MEDIA_KEYS.story_two])
  expect(cards.cards__i3__photo).toEqual(media[ECHELON_MEDIA_KEYS.story_three])
  expect((cards.cards__i1__action as { newTab: boolean }).newTab).toBe(true)
  expect(ECHELON_NATIONAL_SOCIAL).toHaveLength(3)
  expect(JSON.stringify(content)).not.toMatch(/cms-samples|raw_html|custom_css|core-echelon-events|trajan/)
  expect(() => echelonNationalTemplate(definitions, {})).toThrow('Choose the Echelon logo')
  const stories = definitions.find(def => def.slug === 'core-echelon-stories')!
  expect(chapterAllowsSection({ ...stories, slots: stories.slots })).toBe(false)
})
