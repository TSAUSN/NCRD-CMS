import { it, expect } from 'vitest'
import { renderSection, CSS_POLICY_VERSION, type ManifestSection } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { echelonEngagementContent } from './echelon-engagement.ts'
const defs = CORE_LIBRARY.map((entry, index) => ({
  id: String(index),
  version: 1,
  slug: entry.definition.slug,
  name: entry.definition.name,
  slots: compileCoreSection(entry).slots,
}))
it('keeps sample events labelled with one validated date and native details, and hides an empty list only publicly', () => {
  const [instance, follow] = echelonEngagementContent(defs),
    entry = CORE_LIBRARY.find(item => item.definition.slug === 'core-echelon-events')!,
    compiled = compileCoreSection(entry),
    section: ManifestSection = {
      instance: instance!,
      def: {
        section_def_id: instance!.section_def_id,
        version: 1,
        slug: entry.definition.slug,
        compiled_ast: compiled.compiledAst,
        slots: compiled.slots,
        css: compiled.compiledCss,
        css_policy_version: CSS_POLICY_VERSION,
      },
    }
  let html = renderSection(section, 0)
  expect(html).toContain('Sample events')
  expect(html).toContain('<time datetime="2026-11-07"><span>NOV</span><strong>07</strong></time>')
  expect(html.match(/<details /g)).toHaveLength(3)
  expect(instance!.values.events__i2__intro).toBe(
    'Meet other young adults and learn how to get involved with our chapter.',
  )
  expect(follow!.values.accounts_from).toBe('own')
  instance!.values.events__i1__date = '2026-02-30'
  html = renderSection(section, 0)
  expect(html).not.toContain('<time datetime="2026-02-30"')
  instance!.values.events__i1__date = '<img src=x onerror=alert(1)>'
  expect(renderSection(section, 0)).not.toContain('<img src=x')
  instance!.values.events = { items: [] }
  expect(renderSection(section, 0)).toBe('')
  expect(renderSection(section, 0, { preview: true })).toContain('Add an event')
})
