import { it, expect } from 'vitest'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { echelonBodyContent } from './echelon-body-library.ts'
const definitions = CORE_LIBRARY.map((entry, index) => ({
    id: String(index),
    version: 1,
    slug: entry.definition.slug,
    name: entry.definition.name,
    slots: compileCoreSection(entry).slots,
  })),
  image = { src: '/cms-samples/r8-landscape.png', alt: '[Echelon fixture photo]', decorative: false },
  photos = { portrait: image, photo_two: image, photo_three: image }
it('assembles shared Echelon field values with only the approved national/chapter differences and preserves supplied Media focus points', () => {
  const chapter = echelonBodyContent('chapter', definitions, {
      ...photos,
      portrait: { ...image, focal: { x: 0.3, y: 0.4 } },
    }),
    national = echelonBodyContent('national', definitions, photos)
  expect(chapter).toHaveLength(3)
  expect(chapter.map(section => section.values.__cms_anchor)).toEqual([
    'ech-demo-about-intro',
    'ech-demo-about',
    'ech-demo-participate',
  ])
  expect(chapter[1]!.values.portrait).toMatchObject({ focal: { x: 0.3, y: 0.4 } })
  expect(chapter[0]!.values).toEqual(national[0]!.values)
  expect(chapter[2]!.values.cards__i1__label).toBe('Service')
  expect(chapter[2]!.values.cards__i2__label).toBe('Fellowship')
  expect(chapter[2]!.values.cards__i3__label).toBe('Fundraising')
  expect(national[1]!.values.paragraph_one).toContain('emerging professionals across the country')
  expect(national[1]!.values.paragraph_two).toBe(chapter[1]!.values.paragraph_two)
  expect(national[1]!.values.paragraph_three).toBe(
    'Through hands-on service, social gatherings and fundraising, our chapters bring people together to support their neighbors and learn about the needs of their communities.',
  )
  expect(national[2]!.values.intro).toContain('ongoing community needs.')
  expect(JSON.stringify(chapter)).not.toMatch(/raw_html|custom_css|<script|SAWSO|Education/)
  expect(() => echelonBodyContent('chapter', definitions, {})).toThrow('Choose all three Echelon photos first.')
})
