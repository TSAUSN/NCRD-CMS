import { it, expect } from 'vitest'
import { renderSection, CSS_POLICY_VERSION, type ManifestSection } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { echelonChapterSetups, echelonChapterContent, applyChapterSetup } from './echelon-chapters.ts'
const definitions = CORE_LIBRARY.map((entry, index) => ({
  id: String(index),
  version: 1,
  name: entry.definition.name,
  slug: entry.definition.slug,
  slots: compileCoreSection(entry).slots,
}))
const config = (slug: string) => echelonChapterSetups().find(row => row.slug === slug)!.config
function board(count: number, display: 'all' | 'first-eight' = 'first-eight') {
  const content = echelonChapterContent({ ...config('north-texas'), boardDisplay: display }, definitions, count),
    instance = content.find(section => section.values.__cms_chapter_part === 'board')!,
    entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-chapter-board')!,
    compiled = compileCoreSection(entry)
  const placed: ManifestSection = {
    instance,
    def: {
      section_def_id: instance.section_def_id,
      version: 1,
      slug: entry.definition.slug,
      slots: compiled.slots,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      css_policy_version: CSS_POLICY_VERSION,
    },
  }
  return { placed, html: renderSection(placed, 0, { siteThemeHooks: true }) }
}
it('composes the requested social-first and standard sections without a roster or chapter stories', () => {
  const boston = echelonChapterContent(config('boston'), definitions)
  expect(boston.map(section => section.values.__cms_chapter_part)).toEqual([
    'title',
    'social',
    'paragraph',
    'what',
    'events',
    'board',
    'photos',
    'memberLogin',
    'contact',
    'join',
  ])
  expect(boston.filter(section => section.hidden).map(section => section.values.__cms_chapter_part)).toEqual([
    'events',
    'board',
    'photos',
    'memberLogin',
  ])
  expect(JSON.stringify(boston)).not.toMatch(/roster|stories|Jordan Lee|Maya Patel/)
  expect(boston.find(section => section.values.__cms_chapter_part === 'what')!.values.body).toContain(
    'emerging professionals arm',
  )
  const standard = echelonChapterContent(config('peoria'), definitions)
  expect(standard[1]!.values.__cms_chapter_part).toBe('paragraph')
  const changed = applyChapterSetup(standard, {
    ...config('peoria'),
    sections: { ...config('peoria').sections, socialFirst: true, events: false },
  })
  expect(changed[1]!.values.__cms_chapter_part).toBe('social')
  expect(changed.find(section => section.values.__cms_chapter_part === 'events')!.hidden).toBe(true)
  expect(
    applyChapterSetup(changed, config('peoria'))
      .slice(0, 4)
      .map(section => section.values.__cms_chapter_part),
  ).toEqual(['title', 'paragraph', 'social', 'what'])
  expect(changed.find(section => section.values.__cms_chapter_part === 'board')!.values).toEqual(
    standard.find(section => section.values.__cms_chapter_part === 'board')!.values,
  )
})
it.each([0, 1, 8, 16])('renders %i board members as server HTML with disclosure only when needed', count => {
  const { placed, html } = board(count)
  expect(html.match(/<article /g) ?? []).toHaveLength(count)
  if (count > 8) {
    expect(html).toContain('<details class="core-board-more"><summary>Show all 16 board members</summary>')
    expect(html.indexOf('Show all')).toBeGreaterThan(html.indexOf('[Board member 8]'))
    expect(html.indexOf('Show all')).toBeLessThan(html.indexOf('[Board member 9]'))
  } else expect(html).not.toContain('core-board-more')
  if (count === 0) expect(html).toBe('')
  expect(html).not.toContain('<script')
  expect(renderSection(placed, 0, { preview: true })).toContain('data-cms-section="0"')
})
it('retains all cards, safe long text, missing pictures and native item instrumentation', () => {
  const { placed } = board(16, 'all')
  placed.instance.values!.cards__i1__title = '<img onerror=alert(1)> ' + 'Long name '.repeat(50)
  placed.instance.values!.cards__i1__photo = ''
  const html = renderSection(placed, 0, { preview: true })
  expect(html.match(/<article /g)).toHaveLength(16)
  expect(html).not.toContain('Show all')
  expect(html).toContain('&lt;img onerror=alert(1)&gt;')
  expect(html).not.toContain('src=""')
  expect(html).toContain('data-cms-slot="cards__i16__title"')
})
