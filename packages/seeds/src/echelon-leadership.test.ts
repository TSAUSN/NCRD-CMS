import { it, expect } from 'vitest'
import { renderSection, CSS_POLICY_VERSION, type ManifestSection } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { echelonLeadershipContent } from './echelon-leadership.ts'
const defs = CORE_LIBRARY.map((entry, index) => ({
  id: String(index),
  version: 1,
  slug: entry.definition.slug,
  name: entry.definition.name,
  slots: compileCoreSection(entry).slots,
}))
it('requires five selected pictures and retains the approved national council as independent ordinary fields', () => {
  expect(() => echelonLeadershipContent(defs, {})).toThrow(
    'Choose the council group photo and all four portraits first.',
  )
  const photo = (name: string) => ({ src: '/cms-samples/r8-landscape.png', alt: name, decorative: false }),
    media = {
      photo: photo('[Council group]'),
      portrait_one: photo('[Portrait 1]'),
      portrait_two: photo('[Portrait 2]'),
      portrait_three: photo('[Portrait 3]'),
      portrait_four: photo('[Portrait 4]'),
    },
    instance = echelonLeadershipContent(defs, media)
  expect(instance.values.cards).toEqual({ items: ['i1', 'i2', 'i3', 'i4'] })
  expect(instance.values.cards__i4__portrait).toEqual(media.portrait_four)
  expect(instance.values.cards__i1__name).toBe('Madilyn Maruna')
  expect(instance.values.cards__i4__role).toBe('Strategic Initiatives Chair')
  expect(instance.values.__cms_anchor).toBe('ech-demo-leadership')
  const entry = CORE_LIBRARY.find(item => item.definition.slug === 'core-echelon-leadership')!,
    compiled = compileCoreSection(entry),
    section: ManifestSection = {
      instance,
      def: {
        section_def_id: instance.section_def_id,
        version: 1,
        slug: entry.definition.slug,
        compiled_ast: compiled.compiledAst,
        slots: compiled.slots,
        css: compiled.compiledCss,
        css_policy_version: CSS_POLICY_VERSION,
      },
    },
    html = renderSection(section, 0)
  expect(html.match(/<img /g)).toHaveLength(5)
  expect(html).toContain('target="_blank"')
  expect(html).toContain('Meet the full council')
  expect(html).not.toMatch(/raw_html|custom_css|<script/)
})
