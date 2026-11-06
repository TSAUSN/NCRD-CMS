import { randomUUID, createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_THEME_TOKENS,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_FOOTER_CONFIG,
  parseSiteArchive,
  type SiteArchive,
} from '@cms/schema'
import { DomainError } from '@cms/domain'
import { type MediaStore } from '@cms/platform'
import {
  importSiteArchiveInTransaction,
  prepareSiteArchive,
  importedId,
  inspectArchiveObjects,
  remapArchiveValue,
} from './site-portability.ts'
import { createSiteExportHandler, createSiteImportHandler } from './site-portability-handler.ts'
function fixture(): SiteArchive {
  const now = new Date().toISOString(),
    theme = randomUUID(),
    themeVersion = randomUUID(),
    nav = randomUUID(),
    navVersion = randomUUID(),
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
      site: { name: 'Archive', slug: 'archive', kind: 'resource' },
      pages: [],
      page_versions: [],
      themes: [{ id: theme, revision: 1, draft_version_id: themeVersion, published_version_id: themeVersion }],
      theme_versions: [
        { id: themeVersion, theme_id: theme, revision: 1, created_at: now, tokens: DEFAULT_THEME_TOKENS },
      ],
      navigations: [
        { id: nav, revision: 1, draft_version_id: navVersion, published_version_id: navVersion, mode: 'manual' },
      ],
      navigation_versions: [{ id: navVersion, navigation_id: nav, revision: 1, created_at: now, tree: [] }],
      site_settings: [{ id: settings, revision: 0, draft_version_id: null, published_version_id: null }],
      site_setting_versions: [],
      global_elements: [
        {
          id: header,
          revision: 1,
          draft_version_id: headerVersion,
          published_version_id: headerVersion,
          kind: 'header',
          use_on_live: true,
        },
        {
          id: footer,
          revision: 1,
          draft_version_id: footerVersion,
          published_version_id: footerVersion,
          kind: 'footer',
          use_on_live: true,
        },
      ],
      global_element_versions: [
        { id: headerVersion, global_element_id: header, revision: 1, created_at: now, content: DEFAULT_HEADER_CONFIG },
        { id: footerVersion, global_element_id: footer, revision: 1, created_at: now, content: DEFAULT_FOOTER_CONFIG },
      ],
      collections: [],
      collection_entries: [],
      collection_schema_versions: [],
      collection_entry_versions: [],
      section_defs: [],
      section_def_versions: [],
      media: [],
      media_variants: [],
    },
  }
}
const media = {} as MediaStore
const session = async () => ({ userId: randomUUID(), isSuperAdmin: true, recentlyAuthenticated: true })
function request(body: unknown, origin = 'http://localhost') {
  return new Request('http://localhost/api/sites/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  })
}

describe('site content archive boundary', () => {
  it('retains exact JSON, including absent optional metadata, while refusing future formats and authority data', () => {
    const archive = fixture()
    expect(parseSiteArchive(archive)).toBe(archive)
    expect(() => parseSiteArchive({ ...archive, version: 2 })).toThrow()
    expect(() => parseSiteArchive({ ...archive, memberships: [] })).toThrow()
    archive.content.themes[0]!.published_version_id = randomUUID()
    expect(() => parseSiteArchive(archive)).toThrow(/foreign themes version pointer/)
  })
  it('refuses duplicate IDs and dangling navigation/media references', () => {
    const archive = fixture()
    archive.content.navigations[0]!.id = archive.content.themes[0]!.id
    expect(() => parseSiteArchive(archive)).toThrow(/reuses an ID/)
    const nav = fixture()
    nav.content.navigation_versions[0]!.tree = [
      { label: 'Missing', target: { type: 'page', page_id: randomUUID() }, visible: true },
    ]
    expect(() => parseSiteArchive(nav)).toThrow(/missing navigation page/)
    const image = fixture()
    image.content.global_element_versions[0]!.content = {
      ...DEFAULT_HEADER_CONFIG,
      brand: { ...DEFAULT_HEADER_CONFIG.brand, logoMediaId: randomUUID() },
    }
    expect(() => parseSiteArchive(image)).toThrow(/missing media/)
  })
  it('remaps exact identifiers and embedded media URLs while retaining ordinary text bytes', () => {
    const source = randomUUID(),
      requestId = randomUUID(),
      mapped = importedId(requestId, source)
    expect(importedId(requestId, source)).toBe(mapped)
    expect(importedId(randomUUID(), source)).not.toBe(mapped)
    const content = {
      media_id: source,
      html: `<img src="/media/${source}/wide">`,
      text: `A UUID appears in prose: ${source}`,
      number: 5,
    }
    expect(remapArchiveValue(content, new Map([[source, mapped]]))).toEqual({
      ...content,
      media_id: mapped,
      html: `<img src="/media/${mapped}/wide">`,
    })
  })
  it('refuses surplus object bytes even when their own hash is valid', async () => {
    const archive = fixture(),
      bytes = Buffer.from('not an image')
    archive.objects = [
      {
        media_id: randomUUID(),
        kind: 'original',
        base64: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ]
    await expect(inspectArchiveObjects(archive)).rejects.toThrow(/incomplete|duplicates/)
  })
  it('refuses cross-origin, signed-out, editor and old-auth requests before storage', async () => {
    const imported = vi.fn(),
      factory = vi.fn(() => media)
    expect(
      (await createSiteImportHandler({ session, media: factory, import: imported })(request({}, 'https://other.test')))
        .status,
    ).toBe(403)
    for (const principal of [
      null,
      { userId: randomUUID(), isSuperAdmin: false, recentlyAuthenticated: true },
      { userId: randomUUID(), isSuperAdmin: true, recentlyAuthenticated: false },
    ]) {
      expect(
        (
          await createSiteImportHandler({ session: async () => principal, media: factory, import: imported })(
            request({}),
          )
        ).status,
      ).toBe(principal?.isSuperAdmin ? 403 : 404)
    }
    expect(imported).not.toHaveBeenCalled()
    expect(factory).not.toHaveBeenCalled()
  })
  it('bounds streamed input even without Content-Length', async () => {
    const response = await createSiteImportHandler({ session, media: () => media })(
      request('x'.repeat(64 * 1024 * 1024 + 5000)),
    )
    expect(response.status).toBe(413)
  })
  it('returns only a draft result and stable request identity to the import command', async () => {
    const id = randomUUID(),
      imported = vi.fn(async () => id),
      archive = fixture(),
      destination = { name: 'Copy', slug: 'copy' }
    const response = await createSiteImportHandler({ session, media: () => media, import: imported })(
      request({ requestId: id, destination, archive }),
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ siteId: id, status: 'draft' })
    expect(imported.mock.calls[0]?.slice(1)).toEqual([id, destination, archive, media])
  })
  it('explains export media recovery without import instructions or raw database detail', async () => {
    const id = randomUUID()
    const failed = createSiteExportHandler({
      session,
      media: () => media,
      export: async () => {
        throw new DomainError('invalid_state', 'A media object is missing. Recover it before exporting.')
      },
    })
    const response = await failed(new Request('http://localhost'), id)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: 'A media object is missing. Recover it before exporting.',
      recovery: 'media',
    })
    const unavailable = createSiteExportHandler({
      session,
      media: () => media,
      export: async () => {
        throw new Error('secret-internal-storage-detail')
      },
    })
    const retry = await unavailable(new Request('http://localhost'), id)
    expect(retry.status).toBe(503)
    const text = await retry.text()
    expect(text).toContain('archive could not be prepared')
    expect(text).not.toContain('secret-internal')
    expect(text).not.toContain('duplicate site')
  })
  it('downloads a real archive attachment with private no-store headers', async () => {
    const archive = fixture(),
      id = randomUUID()
    const response = await createSiteExportHandler({ session, media: () => media, export: async () => archive })(
      new Request('http://localhost'),
      id,
    )
    expect(await response.json()).toEqual(archive)
    expect(response.headers.get('content-disposition')).toContain('attachment; filename=')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('reviewed script file archive bytes', () => {
  function withFile() {
    const archive = fixture(),
      bytes = Buffer.from('window.originalProof=1;'),
      file = randomUUID(),
      version = randomUUID(),
      hash = createHash('sha256').update(bytes).digest('hex')
    archive.content.site_files = [
      {
        id: file,
        kind: 'script',
        name: 'original.js',
        source: 'local:js/original.js',
        bytes: bytes.length,
        sha256: hash,
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
          paths: [{ path: '/js/original.js', fileId: file }],
        },
        reviewed_at: archive.exported_at,
      },
    ]
    archive.content.site_file_heads = [{ revision: 1, draft_version_id: version, published_version_id: version }]
    archive.objects = [{ media_id: file, kind: 'site-file', sha256: hash, base64: bytes.toString('base64') }]
    return { archive, bytes, file, version, hash }
  }
  it('preserves exact script bytes, original paths, source and checksum aliases with deterministic new identities', async () => {
    const { archive, bytes, file, version, hash } = withFile(),
      requestId = randomUUID(),
      prepared = await prepareSiteArchive(requestId, { slug: 'script-copy', name: 'Script copy' }, archive)
    expect(prepared.objects[0]!.bytes).toEqual(bytes)
    expect(prepared.objects[0]!.objectKey).toBe(`site-files/${requestId}/${importedId(requestId, file)}/${hash}`)
    expect(prepared.bundle.site_files![0]).toMatchObject({
      id: importedId(requestId, file),
      source: 'local:js/original.js',
      mime_type: 'text/javascript',
    })
    expect(prepared.bundle.site_file_versions![0]).toMatchObject({
      id: importedId(requestId, version),
      bundle: {
        files: [importedId(requestId, file)],
        paths: [
          { path: '/js/original.js', fileId: importedId(requestId, file) },
          { path: `/site-files/${file}/${hash}/original.js`, fileId: importedId(requestId, file) },
        ],
      },
    })
    expect(await prepareSiteArchive(requestId, { slug: 'script-copy', name: 'Script copy' }, archive)).toEqual(prepared)
  })
  it('requires explicit review before writing and verifies exact site file readback before the import command', async () => {
    const { archive } = withFile(),
      query = vi.fn().mockResolvedValue({ rows: [{ allowed: true }] }),
      put = vi.fn(),
      get = vi.fn().mockResolvedValue(new Uint8Array([1])),
      store = { ...media, put, get }
    await expect(
      importSiteArchiveInTransaction(
        { query } as never,
        randomUUID(),
        { slug: 'review-copy', name: 'Review copy' },
        archive,
        store,
      ),
    ).rejects.toThrow(/Review every site file/)
    expect(put).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(1)
    query.mockClear()
    await expect(
      importSiteArchiveInTransaction(
        { query } as never,
        randomUUID(),
        { slug: 'review-copy', name: 'Review copy' },
        archive,
        store,
        true,
      ),
    ).rejects.toThrow(/Stored site file bytes differ/)
    expect(put).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(1)
  })
  it('refuses altered bytes, incomplete objects and HTML disguised as a script before writing', async () => {
    const { archive } = withFile()
    archive.objects[0]!.base64 = Buffer.from('changed').toString('base64')
    await expect(inspectArchiveObjects(archive)).rejects.toThrow(/checksum|byte count/)
    archive.objects = []
    await expect(inspectArchiveObjects(archive)).rejects.toThrow(/incomplete/)
    const other = withFile(),
      bad = Buffer.from('<script>bad()</script>'),
      hash = createHash('sha256').update(bad).digest('hex')
    Object.assign(other.archive.content.site_files![0]!, { bytes: bad.length, sha256: hash })
    Object.assign(other.archive.objects[0]!, { base64: bad.toString('base64'), sha256: hash })
    await expect(inspectArchiveObjects(other.archive)).rejects.toThrow(/complete supported file/)
  })
  it('keeps native source identities through repeated transfers and derives mappings for unchanged file references', async () => {
    const { archive } = withFile(),
      asset = randomUUID(),
      image = randomUUID(),
      requestId = randomUUID(),
      digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),
      sharp = (await import('sharp')).default,
      png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
        .png()
        .toBuffer()
    archive.content.site_assets = [
      {
        id: asset,
        kind: 'document',
        mime_type: 'application/pdf',
        bytes: pdf.length,
        content_hash: digest(pdf),
        original_name: 'original.pdf',
        font_key: null,
        provenance: { path: 'local:original.pdf', sha256: digest(pdf), manifest_sha256: 'a'.repeat(64) },
        created_at: archive.exported_at,
      },
    ]
    archive.content.media = [
      {
        id: image,
        width: 2,
        height: 2,
        bytes: png.length,
        mime_type: 'image/png',
        content_hash: digest(png),
        original_name: 'portrait.png',
        alt_text: 'A sample portrait',
        decorative: false,
        focal: null,
        status: 'ready',
        deleted_at: null,
        folder: '',
        attribution: '',
        source: 'local:portrait.png',
        tags: [],
        created_at: archive.exported_at,
      },
    ]
    archive.objects.push(
      { media_id: asset, kind: 'asset', sha256: digest(pdf), base64: pdf.toString('base64') },
      { media_id: image, kind: 'original', sha256: digest(png), base64: png.toString('base64') },
    )
    const privateImage = randomUUID(),
      privateAsset = randomUUID(),
      js = Buffer.from(
        `window.imageId='${image}';new Image().src='/media/'+window.imageId+'/original';fetch('/assets/${asset}');`,
      ),
      script = archive.content.site_files![0]!,
      scriptObject = archive.objects.find(object => object.kind === 'site-file')!
    Object.assign(script, { bytes: js.length, sha256: digest(js) })
    Object.assign(scriptObject, { sha256: digest(js), base64: js.toString('base64') })
    archive.content.media.push({ ...archive.content.media[0]!, id: privateImage, original_name: 'private-draft.png' })
    archive.content.site_assets.push({
      ...archive.content.site_assets[0]!,
      id: privateAsset,
      original_name: 'private-draft.pdf',
    })
    archive.objects.push(
      { media_id: privateImage, kind: 'original', sha256: digest(png), base64: png.toString('base64') },
      { media_id: privateAsset, kind: 'asset', sha256: digest(pdf), base64: pdf.toString('base64') },
    )
    const prepared = await prepareSiteArchive(requestId, { slug: 'native-copy', name: 'Native copy' }, archive),
      native = prepared.bundle.site_file_versions![0]!.bundle.native!
    expect(native).toEqual([
      { kind: 'asset', sourceId: asset, assetId: importedId(requestId, asset) },
      { kind: 'media', sourceId: image, mediaId: importedId(requestId, image), variants: ['original'] },
    ])
    expect(native.some(alias => alias.sourceId === privateImage || alias.sourceId === privateAsset)).toBe(false)
    archive.content.site_file_versions![0]!.bundle.native = [
      { kind: 'media', sourceId: image, mediaId: image, variants: ['original'] },
    ]
    const explicit = await prepareSiteArchive(requestId, { slug: 'native-copy', name: 'Native copy' }, archive)
    expect(explicit.bundle.site_file_versions![0]!.bundle.native).toContainEqual({
      kind: 'media',
      sourceId: image,
      mediaId: importedId(requestId, image),
      variants: ['original'],
    })
    const copied = structuredClone(archive),
      ids = new Map<string, string>()
    for (const rows of Object.values(archive.content))
      if (Array.isArray(rows)) for (const row of rows) if ('id' in row) ids.set(row.id, importedId(requestId, row.id))
    copied.content = remapArchiveValue(archive.content, ids) as typeof copied.content
    copied.content.site_file_versions = explicit.bundle.site_file_versions
    copied.objects = copied.objects.map(object => ({ ...object, media_id: ids.get(object.media_id)! }))
    const next = randomUUID(),
      again = await prepareSiteArchive(next, { slug: 'second-native-copy', name: 'Second native copy' }, copied),
      againNative = again.bundle.site_file_versions![0]!.bundle.native!
    for (const sourceId of [image, importedId(requestId, image)])
      expect(againNative).toContainEqual({
        kind: 'media',
        sourceId,
        mediaId: importedId(next, importedId(requestId, image)),
        variants: ['original'],
      })
    expect(
      againNative.some(alias =>
        [privateImage, privateAsset, importedId(requestId, privateImage), importedId(requestId, privateAsset)].includes(
          alias.sourceId,
        ),
      ),
    ).toBe(false)
    expect(again.objects.find(object => object.kind === 'site-file')!.bytes).toEqual(
      explicit.objects.find(object => object.kind === 'site-file')!.bytes,
    )
  })
})

describe('original page layout archive transfer', () => {
  function originalArchive() {
    const archive = fixture(),
      id = randomUUID(),
      pageId = randomUUID(),
      pageVersion = randomUUID(),
      version = randomUUID()
    archive.content.section_defs = [
      {
        id,
        slug: 'source-section',
        name: 'Source section',
        category: 'Imported',
        status: 'active',
        scope: 'site',
        placement: 'page',
      },
    ]
    archive.content.section_def_versions = [
      {
        id: randomUUID(),
        section_def_id: id,
        version: 1,
        source_html: '<section class="original"><h1>Original</h1></section>',
        source_css: '',
        slots: [],
        definition_kind: 'legacy',
        structured_doc: null,
        structured_schema_version: null,
        changelog: 'Import',
        created_at: archive.exported_at,
      },
    ]
    archive.content.pages = [
      {
        id: pageId,
        revision: 1,
        draft_version_id: pageVersion,
        published_version_id: null,
        slug: '',
        title: 'Original',
        layout_mode: 'sections',
        status: 'draft',
        editor_label: '',
        sort_index: 0,
        archived_at: null,
      },
    ]
    archive.content.page_versions = [
      {
        id: pageVersion,
        page_id: pageId,
        revision: 1,
        created_at: archive.exported_at,
        content: [
          { section_def_id: id, section_def_version: 1, values: {}, hidden: false, hidden_at: [], label: 'Original' },
        ],
        meta: { noindex: false },
        kind: 'checkpoint',
        note: '',
        page_title: 'Original',
        page_slug: '',
      },
    ]
    archive.content.site_files = []
    archive.content.site_file_versions = [
      {
        id: version,
        version: 1,
        bundle: {
          version: 1,
          files: [],
          scripts: [],
          styles: [],
          original: {
            version: 1,
            definitions: [{ section_def_id: id, section_def_version: 1 }],
            pages: [
              { pageId, html: { lang: 'en' }, body: { id, 'data-original-id': pageId }, header: false, footer: false },
            ],
          },
        },
        reviewed_at: archive.exported_at,
      },
    ]
    archive.content.site_file_heads = [{ revision: 1, draft_version_id: version, published_version_id: null }]
    return { archive, id, pageId }
  }
  it('remaps only CMS pins and page references, retaining literal authored document identities', async () => {
    const { archive, id, pageId } = originalArchive(),
      requestId = randomUUID()
    const prepared = await prepareSiteArchive(requestId, { name: 'Original copy', slug: 'original-copy' }, archive)
    expect(prepared.bundle.site_file_versions![0]!.bundle.original).toEqual({
      version: 1,
      definitions: [{ section_def_id: importedId(requestId, id), section_def_version: 1 }],
      pages: [
        {
          pageId: importedId(requestId, pageId),
          html: { lang: 'en' },
          body: { id, 'data-original-id': pageId },
          header: false,
          footer: false,
        },
      ],
    })
  })
  it('requires an explicit fresh review even when the imported layout has no executable files', async () => {
    const { archive } = originalArchive(),
      query = vi.fn().mockResolvedValue({ rows: [{ allowed: true }] }),
      put = vi.fn()
    await expect(
      importSiteArchiveInTransaction(
        { query } as never,
        randomUUID(),
        { name: 'Original copy', slug: 'original-copy' },
        archive,
        { ...media, put },
      ),
    ).rejects.toThrow(/Review every site file/)
    expect(query).toHaveBeenCalledTimes(1)
    expect(put).not.toHaveBeenCalled()
  })
  it('preserves reviewed new-page defaults literally across repeated archive transfers', async () => {
    const { archive, pageId } = originalArchive(),
      defaults = {
        html: { lang: 'en' },
        body: { id: pageId, 'data-note': 'source identity' },
        header: true,
        footer: true,
        quirks: false,
      }
    archive.content.site_file_versions![0]!.bundle.original!.newPages = defaults
    const requestId = randomUUID(),
      first = await prepareSiteArchive(requestId, { name: 'New pages copy', slug: 'new-pages-copy' }, archive)
    expect(first.bundle.site_file_versions![0]!.bundle.original!.newPages).toEqual(defaults)
    const ids = new Map<string, string>()
    for (const rows of Object.values(archive.content))
      if (Array.isArray(rows)) for (const row of rows) if ('id' in row) ids.set(row.id, importedId(requestId, row.id))
    const copied = structuredClone(archive)
    copied.content = remapArchiveValue(archive.content, ids) as typeof copied.content
    copied.content.site_file_versions = first.bundle.site_file_versions
    const second = await prepareSiteArchive(
      randomUUID(),
      { name: 'Second defaults copy', slug: 'second-defaults-copy' },
      copied,
    )
    expect(second.bundle.site_file_versions![0]!.bundle.original!.newPages).toEqual(defaults)
    expect(second.bundle.site_file_versions![0]!.bundle.original!.pages[0]!.pageId).not.toBe(pageId)
  })
  it('refuses missing original pages and definition versions before preparing any objects', async () => {
    const { archive } = originalArchive()
    archive.content.site_file_versions![0]!.bundle.original!.pages[0]!.pageId = randomUUID()
    await expect(
      prepareSiteArchive(randomUUID(), { name: 'Original copy', slug: 'original-copy' }, archive),
    ).rejects.toThrow(/missing page/)
    archive.content.site_file_versions![0]!.bundle.original!.pages = []
    archive.content.site_file_versions![0]!.bundle.original!.definitions[0]!.section_def_version = 2
    await expect(
      prepareSiteArchive(randomUUID(), { name: 'Original copy', slug: 'original-copy' }, archive),
    ).rejects.toThrow(/missing original layout version/)
  })
})
