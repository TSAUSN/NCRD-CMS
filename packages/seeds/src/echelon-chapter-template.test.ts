import { it, expect } from 'vitest'
import { renderPage, CSS_POLICY_VERSION } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import { echelonChapterTemplate } from './echelon-chapter-template.ts'
import { echelonChapterSetups } from './echelon-chapters.ts'
import { ECHELON_THEME } from './core-themes.ts'
const definitions = CORE_LIBRARY.map((entry, index) => ({
    id: String(index),
    version: 1,
    slug: entry.definition.slug,
    name: entry.definition.name,
    slots: compileCoreSection(entry).slots,
  })),
  image = {
    src: '/media/11111111-1111-4111-a111-111111111111/wide',
    alt: '[Echelon chapter photo]',
    decorative: false,
    focal: { x: 0.6, y: 0.46 },
  },
  media = { logo: image, photo: image, portrait: image, photo_two: image, photo_three: image }
it('composes the reviewed chapter order and wording from shared fields without stories, national leadership or invented people', () => {
  const content = echelonChapterTemplate(definitions, media)
  expect(content.map(row => definitions.find(def => def.id === row.section_def_id)!.slug)).toEqual([
    'core-echelon-hero',
    'core-echelon-jump-links',
    'core-echelon-about',
    'core-echelon-who',
    'core-echelon-pillars',
    'core-echelon-events',
    'core-echelon-chapter-contacts',
    'core-echelon-follow',
    'core-echelon-board',
    'core-echelon-faq',
    'core-echelon-contact',
  ])
  expect(content[0]!.values).toMatchObject({
    heading: '[Chapter name]',
    photo: image,
    logo: image,
    primary: { label: 'Explore events', url: '#ech-demo-events' },
  })
  expect(content[3]!.values).toMatchObject({
    portrait: image,
    photo_two: image,
    photo_three: image,
    paragraph_two:
      'Whether you’re new to the area or a longtime local, Echelon is a place to meet like-minded people, build lasting friendships, and turn compassion into action — together.',
  })
  const board = content.find(row => row.values.__cms_chapter_part === 'board')!
  expect(board.values.__cms_sample_fields).toEqual([
    'cards__i1__name',
    'cards__i2__name',
    'cards__i3__name',
    'cards__i4__name',
  ])
  const body = JSON.stringify(content)
  expect(body).not.toMatch(/raw_html|custom_css|core-story|core-stories|core-echelon-leadership|Alex Morgan|SAWSO/)
  expect(body).toContain('[Membership chair name]')
  expect(body).toContain('Sample events')
  expect(() => echelonChapterTemplate(definitions, { ...media, photo: null })).toThrow('Choose the Echelon logo')
  const sections = content.map(instance => {
      const entry = CORE_LIBRARY.find(
          row => row.definition.slug === definitions.find(def => def.id === instance.section_def_id)!.slug,
        )!,
        compiled = compileCoreSection(entry)
      return {
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
    }),
    html = renderPage({
      manifest: {
        page: { id: 'page', version_id: 'version', title: '[Chapter]', path: '/chapters/example' },
        sections,
        meta: {},
      },
      shell: {
        site: { id: 'site', name: '[Echelon]', slug: 'echelon-chapters' },
        theme: ECHELON_THEME,
        navigation: [],
        canonical_host: null,
        staging_host: null,
      },
      isStaging: true,
    }).html
  expect(html).toContain('<main id="cms-main" class="cms-echelon-page">')
  expect(html).not.toContain('class="national-content-panel')
  expect(html).toContain('Membership Chair')
  expect(html).not.toContain('trajan-pro-3')
  sections[0]!.instance.values.__cms_echelon_template = ''
  const ordinary = renderPage({
    manifest: { page: { id: 'page', version_id: 'version', title: '[Chapter]', path: '/' }, sections, meta: {} },
    shell: {
      site: { id: 'site', name: '[Echelon]', slug: 'echelon-chapters' },
      theme: ECHELON_THEME,
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    isStaging: true,
  }).html
  expect(ordinary).not.toContain('class="cms-echelon-page"')
})
it('keeps optional chapter sections and board display while generating only visible jump destinations', () => {
  const config = echelonChapterSetups().find(row => row.slug === 'boston')!.config,
    content = echelonChapterTemplate(definitions, media, config),
    social = content.find(row => row.values.__cms_chapter_part === 'social')!
  expect(content.indexOf(social)).toBe(1)
  expect(content.find(row => row.values.__cms_chapter_part === 'events')!.hidden).toBe(true)
  expect(content.find(row => row.values.__cms_chapter_part === 'board')!.values.__cms_board_display).toBe(
    config.boardDisplay,
  )
  const jump = content.find(row => row.values.__cms_chapter_part === 'jumps')!
  expect(JSON.stringify(jump.values)).not.toMatch(/#ech-demo-events|#ech-demo-board/)
  expect(content[0]!.values.primary).toEqual({ label: 'Get in touch', url: '#ech-local-contact-title' })
  expect(JSON.stringify(content.find(row => row.values.__cms_chapter_part === 'faq')!.values)).not.toContain(
    '#ech-demo-events',
  )
})

it('updates chapter options without replacing authored words or photos, and restores the source Follow position', async () => {
  const { applyChapterSetup } = await import('./echelon-chapter-content.ts'),
    config = echelonChapterSetups().find(row => row.slug === 'peoria')!.config,
    original = echelonChapterTemplate(definitions, media)
  original[3]!.values.paragraph_one = '[Chapter-owned words]'
  original[3]!.values.action = { label: 'Our website', url: 'https://chapter.example.test/' }
  original[3]!.values.__cms_anchor = 'our-people'
  const before = JSON.stringify(original),
    changed = applyChapterSetup(original, {
      ...config,
      sections: { ...config.sections, socialFirst: true, events: false },
    })
  expect(JSON.stringify(original)).toBe(before)
  expect(changed[1]!.values.__cms_chapter_part).toBe('social')
  const who = changed.find(row => row.values.__cms_chapter_part === 'paragraph')!
  expect(who.values.paragraph_one).toBe('[Chapter-owned words]')
  expect(who.values.portrait).toEqual(image)
  expect(who.values.action).toEqual({ label: 'Our website', url: 'https://chapter.example.test/' })
  const jumps = changed.find(row => row.values.__cms_chapter_part === 'jumps')!
  expect(JSON.stringify(jumps.values)).toContain('#our-people')
  expect(JSON.stringify(jumps.values)).not.toContain('#ech-demo-events')
  const restored = applyChapterSetup(changed, { ...config, sections: { ...config.sections, socialFirst: false } }),
    contacts = restored.findIndex(row => row.values.__cms_chapter_part === 'contact')
  expect(restored[contacts + 1]!.values.__cms_chapter_part).toBe('social')
  expect(restored[contacts + 2]!.values.__cms_chapter_part).toBe('board')
})

it('uses each source chapter name for its hero and keeps the other shared fields through setup renames', async () => {
  const { applyChapterSetup } = await import('./echelon-chapter-content.ts'),
    chapters = echelonChapterSetups().filter(row => ['peoria', 'boston'].includes(row.slug))
  for (const row of chapters) {
    const content = echelonChapterTemplate(definitions, media, row.config),
      hero = content.find(section => section.values.__cms_chapter_part === 'title')!
    expect(hero.values.heading).toBe(row.config.name)
    const changed = applyChapterSetup(content, { ...row.config, name: '[Renamed chapter]' }),
      next = changed.find(section => section.values.__cms_chapter_part === 'title')!
    expect(next.values.heading).toBe('[Renamed chapter]')
    expect({ ...next.values, heading: hero.values.heading }).toEqual(hero.values)
    expect(hero.values.heading).toBe(row.config.name)
  }
})
