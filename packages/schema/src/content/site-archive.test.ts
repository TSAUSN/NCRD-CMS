import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HEADER_CONFIG, DEFAULT_FOOTER_CONFIG } from './global-elements.ts'
import { DEFAULT_THEME_TOKENS } from './theme.ts'
import { parseSiteArchive, type SiteArchive } from './site-archive.ts'

function fixture(): SiteArchive {
  const now = new Date().toISOString()
  const theme = randomUUID(),
    nav = randomUUID(),
    settings = randomUUID()
  const header = randomUUID(),
    footer = randomUUID(),
    headerVersion = randomUUID(),
    footerVersion = randomUUID()
  return {
    format: 'cms-site-content',
    version: 1,
    exported_at: now,
    objects: [],
    content: {
      site: { name: 'Portable', slug: 'portable', kind: 'resource' },
      pages: [],
      page_versions: [],
      themes: [{ id: theme, revision: 1, draft_version_id: null, published_version_id: null }],
      theme_versions: [
        { id: randomUUID(), theme_id: theme, revision: 1, created_at: now, tokens: DEFAULT_THEME_TOKENS },
      ],
      navigations: [{ id: nav, revision: 0, draft_version_id: null, published_version_id: null, mode: 'manual' }],
      navigation_versions: [],
      site_settings: [{ id: settings, revision: 0, draft_version_id: null, published_version_id: null }],
      site_setting_versions: [],
      global_elements: [
        {
          id: header,
          kind: 'header',
          revision: 1,
          draft_version_id: headerVersion,
          published_version_id: null,
          use_on_live: false,
        },
        {
          id: footer,
          kind: 'footer',
          revision: 1,
          draft_version_id: footerVersion,
          published_version_id: null,
          use_on_live: false,
        },
      ],
      global_element_versions: [
        { id: headerVersion, global_element_id: header, revision: 1, created_at: now, content: DEFAULT_HEADER_CONFIG },
        { id: footerVersion, global_element_id: footer, revision: 1, created_at: now, content: DEFAULT_FOOTER_CONFIG },
      ],
      section_defs: [],
      section_def_versions: [],
      collections: [],
      collection_schema_versions: [],
      collection_entries: [],
      collection_entry_versions: [],
      media: [],
      media_variants: [],
    },
  }
}

function frame(archive: SiteArchive, kind: 'header' | 'footer') {
  const id = randomUUID(),
    owner = archive.content.global_elements.find(row => row.kind === kind)!
  const def: SiteArchive['content']['section_defs'][number] = {
    id,
    slug: `frame-${id}`,
    name: 'Frame',
    category: 'Frame',
    scope: 'global',
    status: 'active',
    placement: kind,
  }
  archive.content.section_defs.push(def)
  archive.content.section_def_versions.push({
    id: randomUUID(),
    section_def_id: id,
    version: 1,
    source_html: '<nav>{{menu}}</nav>',
    source_css: '',
    slots: [{ id: 'menu', label: 'Navigation', kind: 'navigation', constraints: {} }],
    definition_kind: 'legacy',
    structured_doc: null,
    structured_schema_version: null,
    changelog: '',
    created_at: archive.exported_at,
  })
  archive.content.global_element_versions.find(row => row.global_element_id === owner.id)!.content = {
    schemaVersion: 2,
    enabled: true,
    ...(kind === 'header' ? { sticky: false } : {}),
    component: { section_def_id: id, section_def_version: 1, values: { caption: 'Keep this exact value' } },
  }
  return def
}

describe('authored site frame archive references', () => {
  it('retains authored placements, navigation declarations and values without rewriting the archive', () => {
    const archive = fixture()
    frame(archive, 'header')
    frame(archive, 'footer')
    const before = JSON.stringify(archive)
    expect(parseSiteArchive(archive)).toBe(archive)
    expect(JSON.stringify(archive)).toBe(before)
  })

  it('accepts legacy page definitions without inserting a placement default into immutable bytes', () => {
    const archive = fixture(),
      def = frame(archive, 'header')
    delete def.placement
    archive.content.global_element_versions[0]!.content = DEFAULT_HEADER_CONFIG
    expect(parseSiteArchive(archive).content.section_defs[0]).not.toHaveProperty('placement')
  })

  it.each(['page', 'footer', undefined] as const)(
    'rejects header placement %s instead of degrading to a preset',
    placement => {
      const archive = fixture(),
        def = frame(archive, 'header')
      if (placement === undefined) delete def.placement
      else def.placement = placement
      expect(() => parseSiteArchive(archive)).toThrow(/wrong header placement/)
    },
  )

  it('checks every historical frame pin, including versions that are no longer draft or live', () => {
    const archive = fixture()
    frame(archive, 'header')
    archive.content.global_elements[0]!.draft_version_id = null
    archive.content.section_def_versions = []
    expect(() => parseSiteArchive(archive)).toThrow(/missing pinned frame version/)
  })

  it('rejects malformed authored content at the archive boundary', () => {
    const archive = fixture()
    frame(archive, 'footer')
    const content = archive.content.global_element_versions[1]!.content as Record<string, unknown>
    content['sticky'] = true
    expect(() => parseSiteArchive(archive)).toThrow(/invalid footer content/)
  })

  it.each([null, 'sidebar', 2])('rejects an explicit invalid placement %s instead of defaulting it', placement => {
    const archive = fixture(),
      def = frame(archive, 'header')
    Object.assign(def, { placement })
    expect(() => parseSiteArchive(archive)).toThrow(/placement/)
  })

  it('preserves disabled and retired frame pins while checking their dependencies', () => {
    const archive = fixture(),
      def = frame(archive, 'header')
    def.status = 'retired'
    const content = archive.content.global_element_versions[0]!.content as Record<string, unknown>
    content['enabled'] = false
    expect(parseSiteArchive(archive)).toBe(archive)
    archive.content.section_def_versions = []
    expect(() => parseSiteArchive(archive)).toThrow(/missing pinned frame version/)
  })

  it.each(['asset-id', 'asset-url', 'media-url', 'navigation-page', 'nested'] as const)(
    'checks references held only by authored frame values: %s',
    reference => {
      const archive = fixture()
      frame(archive, 'footer')
      const content = archive.content.global_element_versions[1]!.content as {
        component: { values: Record<string, unknown> }
      }
      const missing = randomUUID()
      if (reference === 'asset-id') content.component.values['download'] = { asset_id: missing }
      if (reference === 'asset-url') content.component.values['download'] = `<a href="/assets/${missing}">Report</a>`
      if (reference === 'media-url') content.component.values['portrait'] = `/media/${missing}/wide`
      if (reference === 'navigation-page') content.component.values['link'] = { type: 'page', page_id: missing }
      if (reference === 'nested') {
        let nested: unknown = { media_id: missing }
        for (let depth = 0; depth < 81; depth++) nested = { nested }
        content.component.values['nested'] = nested
      }
      expect(() => parseSiteArchive(archive)).toThrow(/missing|nested too deeply/)
    },
  )

  it('refuses frame definitions in page bodies even when their pinned version exists', () => {
    const archive = fixture(),
      def = frame(archive, 'header'),
      page = randomUUID(),
      version = randomUUID()
    archive.content.pages.push({
      id: page,
      revision: 1,
      draft_version_id: version,
      published_version_id: null,
      slug: '',
      title: 'Home',
      layout_mode: 'sections',
      status: 'draft',
      editor_label: '',
      sort_index: 0,
      archived_at: null,
    })
    archive.content.page_versions.push({
      id: version,
      page_id: page,
      revision: 1,
      created_at: archive.exported_at,
      content: [
        { section_def_id: def.id, section_def_version: 1, values: {}, hidden: false, hidden_at: [], label: '' },
      ],
      meta: { noindex: false },
      kind: 'checkpoint',
      note: '',
      page_title: 'Home',
      page_slug: '',
    })
    expect(() => parseSiteArchive(archive)).toThrow(/frame component in page content/)
  })
})

function reviewedFileArchive() {
  const archive = fixture(),
    file = randomUUID(),
    version = randomUUID()
  archive.content.site_files = [
    {
      id: file,
      kind: 'script',
      name: 'original.js',
      source: 'local:js/original.js',
      sha256: 'a'.repeat(64),
      bytes: 18,
      created_at: archive.exported_at,
    },
  ]
  archive.content.site_file_versions = [
    {
      id: version,
      version: 1,
      bundle: {
        version: 1,
        files: [file],
        scripts: [{ fileId: file, position: 'body-end', loading: 'normal', pages: [] }],
        styles: [],
      },
      reviewed_at: archive.exported_at,
    },
  ]
  archive.content.site_file_heads = [{ revision: 1, draft_version_id: version, published_version_id: version }]
  return archive
}
describe('reviewed site file archive references', () => {
  it('retains the complete immutable receipt, version and head without inserting defaults', () => {
    const archive = reviewedFileArchive(),
      before = JSON.stringify(archive)
    expect(parseSiteArchive(archive)).toBe(archive)
    expect(JSON.stringify(archive)).toBe(before)
  })
  it('requires all optional reviewed-file lists together', () => {
    const archive = reviewedFileArchive()
    delete archive.content.site_file_heads
    expect(() => parseSiteArchive(archive)).toThrow(/missing reviewed file history/)
  })
  it('rejects a missing receipt in any historical version', () => {
    const archive = reviewedFileArchive()
    archive.content.site_files = []
    expect(() => parseSiteArchive(archive)).toThrow(/missing reviewed file/)
  })
  it('rejects a foreign head pointer and incomplete version history', () => {
    const archive = reviewedFileArchive()
    archive.content.site_file_heads![0]!.draft_version_id = randomUUID()
    expect(() => parseSiteArchive(archive)).toThrow(/foreign reviewed file version pointer/)
    archive.content.site_file_heads![0]!.draft_version_id = archive.content.site_file_versions![0]!.id
    archive.content.site_file_heads![0]!.revision = 8
    expect(parseSiteArchive(archive)).toBe(archive)
    archive.content.site_file_versions![0]!.version = 2
    expect(() => parseSiteArchive(archive)).toThrow(/incomplete reviewed file history/)
  })
  it('refuses repeated version numbers even when all UUIDs are unique', () => {
    const archive = reviewedFileArchive()
    archive.content.site_file_versions!.push({ ...archive.content.site_file_versions![0]!, id: randomUUID() })
    expect(() => parseSiteArchive(archive)).toThrow(/duplicate, orphaned or future reviewed file versions/)
  })
  it('refuses a script binding to image bytes and bindings to missing pages', () => {
    const archive = reviewedFileArchive()
    archive.content.site_files![0]!.kind = 'image'
    expect(() => parseSiteArchive(archive)).toThrow(/non-script/)
    archive.content.site_files![0]!.kind = 'script'
    archive.content.site_file_versions![0]!.bundle.scripts[0]!.pages = [randomUUID()]
    expect(() => parseSiteArchive(archive)).toThrow(/missing page/)
  })
  it('rejects authority and storage keys in portable receipts', () => {
    const archive = reviewedFileArchive()
    Object.assign(archive.content.site_files![0]!, { created_by: randomUUID(), object_key: 'private/key' })
    expect(() => parseSiteArchive(archive)).toThrow()
  })
})

it('refuses native aliases to resources missing from the content archive', () => {
  for (const alias of [
    { kind: 'asset' as const, sourceId: randomUUID(), assetId: randomUUID() },
    { kind: 'media' as const, sourceId: randomUUID(), mediaId: randomUUID(), variants: ['original' as const] },
  ]) {
    const archive = reviewedFileArchive()
    archive.content.site_file_versions![0]!.bundle.native = [alias]
    expect(() => parseSiteArchive(archive)).toThrow(/missing original/)
  }
})
