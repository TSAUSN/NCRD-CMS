import { sectionStartingValues } from '@cms/schema'
import { describe, expect, it } from 'vitest'
import { renderSection, CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION, type ManifestSection } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection, corePreviewValues, coreUpsertArguments } from './core-library.ts'
function placed(entry: (typeof CORE_LIBRARY)[number]): ManifestSection {
  const compiled = compileCoreSection(entry)
  return {
    def: {
      section_def_id: 'core',
      version: 1,
      slug: entry.definition.slug,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      slots: compiled.slots,
      definition_kind: compiled.definitionKind,
      structured_doc: compiled.structuredDoc,
      structured_schema_version: compiled.structuredSchemaVersion,
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: {
      section_def_id: 'core',
      section_def_version: 1,
      values: corePreviewValues(entry),
      hidden: false,
      hidden_at: [],
      label: entry.definition.name,
    },
  }
}
describe('revision 8 core catalogue', () => {
  it('contains the 24 distinct P0 sections with explicit capabilities and purposes', () => {
    const widgets = [
      ...CORE_LIBRARY.filter(e => e.definition.category === 'National sections').map(e => e.definition.slug),
      'core-chapter-search',
      'core-chapter-directory',
      'core-contact-form',
      'core-chapter-board',
      'core-stories',
      'core-story-detail',
      'core-newsroom',
      'core-story-world',
      'core-story-split',
    ]
    expect(CORE_LIBRARY.filter(entry => !widgets.includes(entry.definition.slug))).toHaveLength(24)
    expect(CORE_LIBRARY).toHaveLength(59)
    expect(new Set(CORE_LIBRARY.map(entry => entry.definition.slug)).size).toBe(59)
    expect(CORE_LIBRARY.filter(entry => entry.list).map(entry => entry.list)).toEqual([
      'speakers',
      'people',
      'program',
      'resources',
    ])
    for (const entry of CORE_LIBRARY) {
      expect(entry.purpose.length).toBeGreaterThan(20)
      expect(Object.values(entry.capabilities).every(value => typeof value === 'boolean')).toBe(true)
      expect(coreUpsertArguments(entry).slice(-2)).toEqual(['global', null])
    }
  })
  it.each(CORE_LIBRARY.map(entry => [entry.definition.name, entry] as const))(
    '%s compiles without trusted code and renders its authored example',
    (_name, entry) => {
      const compiled = compileCoreSection(entry)
      expect(compiled.problems).toEqual([])
      expect(compiled.carriesTrustedCode).toBe(false)
      expect(compiled.slots[0]?.constraints).toMatchObject({ coreLibrary: 'r8', coreCapabilities: entry.capabilities })
      const html = renderSection(placed(entry), 0, { preview: false, siteThemeHooks: true })
      expect(html).toContain('<section')
      expect(html).not.toContain('{{')
      expect(html).not.toMatch(/<script|onclick=|https?:\/\/[^" ]+\.(?:css|js)/)
      expect(html.length).toBeGreaterThan(200)
    },
  )
  it('keeps people compact with native biographies and initials when a picture is missing', () => {
    const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-speakers-grid')!
    const section = placed(entry)
    const values = section.instance.values!['speakers'] as { entries: { values: Record<string, unknown> }[] }
    values.entries[0]!.values.photo = ''
    const html = renderSection(section, 0)
    expect(html).toContain('cms-initials-avatar')
    expect(html).toContain('No picture for Speaker 1 (sample)')
    expect(html).toContain('>S1</span>')
    expect(html.match(/<summary aria-label="Read bio"/g)).toHaveLength(3)
    expect(html).not.toContain('src=""')
  })
  it('uses native details for FAQ without requiring JavaScript', () => {
    const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-faq')!
    const html = renderSection(placed(entry), 0)
    expect(html.match(/<details/g)).toHaveLength(3)
    expect(html.match(/<summary/g)).toHaveLength(3)
    expect(html).toContain('Who is this for?')
  })
  it('makes photo hero genuinely photo-backed and keeps sample image paths built in', () => {
    const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-photo-hero')!
    const html = renderSection(placed(entry), 0)
    expect(html).toContain('core-backdrop')
    expect(html).toContain('/cms-samples/r8-landscape.png')
    expect(html).toContain('Original abstract illustration')
  })
})
it('groups schedule sessions by day without discarding any item', () => {
  const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-schedule')!
  const section = placed(entry)
  const collection = section.instance.values!.program as { entries: { values: Record<string, unknown> }[] }
  collection.entries[2]!.values.date = 'June 9, 2027'
  const html = renderSection(section, 0)
  expect((html.match(/class="cms-list-day"/g) ?? []).length).toBe(2)
  expect(html).toContain('A welcoming start')
  expect(html).toContain('Learning together')
  expect(html).toContain('Your next step')
})
it('keeps track filtering code-owned and excludes it from scriptless previews', async () => {
  const { renderPage, SCHEDULE_FILTER_RUNTIME, scheduleFilterScriptHash } = await import('@cms/renderer')
  const section = placed(CORE_LIBRARY.find(entry => entry.definition.slug === 'core-schedule')!)
  const collection = section.instance.values!.program as { entries: { values: Record<string, unknown> }[] }
  collection.entries[0]!.values.category = 'Community'
  collection.entries[1]!.values.category = 'Leadership'
  const input = {
    manifest: { page: { id: 'p', version_id: 'v', title: 'Program', path: '/' }, meta: {}, sections: [section] },
    shell: {
      theme: {},
      site: { id: 'core', slug: 'core', name: 'Core preview' },
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    isStaging: true,
  }
  const html = renderPage(input).html
  expect(html).toContain('data-cms-track-filter hidden')
  expect(html).toContain('All tracks')
  expect(html).toContain('Leadership')
  expect(html).toContain(`<script>${SCHEDULE_FILTER_RUNTIME}</script>`)
  expect(scheduleFilterScriptHash()).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/)
  expect(renderPage({ ...input, options: { providerEmbeds: false } }).html).not.toContain('<script')
})

it('offers an optional governed venue map without permitting arbitrary frames', () => {
  const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-venue-travel')!
  const section = placed(entry)
  section.instance.values!.map = {
    url: 'https://www.google.com/maps/embed?pb=!1m18!1m12!3d40.7!2d-74.0',
    label: 'Venue map',
  }
  expect(renderSection(section, 0)).toContain('data-cms-embed-provider="google-maps"')
  section.instance.values!.map = { url: 'https://example.org/untrusted-frame', label: 'Venue map' }
  expect(renderSection(section, 0)).not.toContain('<iframe')
})

it('keeps a schedule speaker and session detail link, with no invented optional values', () => {
  const section = placed(CORE_LIBRARY.find(entry => entry.definition.slug === 'core-schedule')!)
  const list = section.instance.values!.program as { entries: { values: Record<string, unknown> }[] }
  list.entries[0]!.values.speakers = 'Morgan Example'
  list.entries[0]!.values.session_url = 'https://example.test/session?day=1&track=2#details'
  const html = renderSection(section, 0)
  expect(html).toContain('Morgan Example')
  expect(html).toContain('href="https://example.test/session?day=1&amp;track=2#details"')
  expect(html).toContain('Session details')
  delete list.entries[0]!.values.speakers
  delete list.entries[0]!.values.session_url
  expect(renderSection(section, 0)).not.toContain('Morgan Example')
  expect(renderSection(section, 0)).not.toContain('day=1')
})

it('hides an empty Stories section only when chosen, while keeping it editable in preview', () => {
  const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-stories')!,
    section = placed(entry),
    detail = corePreviewValues(CORE_LIBRARY.find(entry => entry.definition.slug === 'core-story-detail')!)
      .story as Record<string, unknown>
  section.instance.values = { ...entry.samples, stories: { ...detail, entries: [] }, empty_mode: 'line' }
  expect(renderSection(section, 0)).toContain('Check back soon')
  section.instance.values.empty_mode = 'hide'
  expect(renderSection(section, 0)).toBe('')
  expect(renderSection(section, 0, { preview: true })).toContain('Check back soon')
})

it('starts an inserted Stories section with its declared automatic dated binding', () => {
  const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-stories')!
  expect(sectionStartingValues(compileCoreSection(entry).slots).stories).toEqual({
    readerKey: 'stories',
    selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', maxAgeMonths: 13, limit: 6 },
  })
})
