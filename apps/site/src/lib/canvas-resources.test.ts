import { describe, expect, it, vi } from 'vitest'
import { compileSection } from '@cms/renderer'
import { createHash } from 'node:crypto'
import type { MediaStore, ResolvedSiteFile } from '@cms/platform'
import { canvasDocument, canvasResourceUrl, canvasStylesheet } from './canvas-resources.ts'
import { createCanvasResourceHandler, type CanvasResourceRepository } from './canvas-resource-handler.ts'
import { createCanvasPageHandler } from './canvas-page-handler.ts'
import type { CanvasSnapshot } from './canvas-preview-repository.ts'
const token = 'a'.repeat(64),
  id = '11111111-1111-4111-8111-111111111111',
  site = '22222222-2222-4222-8222-222222222222'
const source = new TextEncoder().encode(
  `.card:hover{background:url("/media/${id}/wide");transition:opacity .2s}@keyframes slide{to{transform:translateX(10px)}}`,
)
const hash = createHash('sha256').update(source).digest('hex')
const file: ResolvedSiteFile = {
  id,
  site_id: site,
  kind: 'stylesheet',
  name: 'site.css',
  source: 'local:site.css',
  object_key: `site-files/${site}/${id}/${hash}`,
  mime_type: 'text/css',
  bytes: source.length,
  sha256: hash,
}
const store: MediaStore = {
  async createSignedUpload() {
    throw Error('unused')
  },
  async put() {
    throw Error('unused')
  },
  async get() {
    return source
  },
  async remove() {},
}
const request = () => new Request('http://site.staging.localhost:3201/__cms/read/' + token)
const repo = (): CanvasResourceRepository => ({
  file: vi.fn(async () => file),
  asset: vi.fn(async () => null),
  media: vi.fn(async () => null),
})
const runtime = {
  head:
    '<script src="/__cms/editor/prelude.js" integrity="sha256-' + Buffer.alloc(32).toString('base64') + '"></script>',
  body: '<script src="/__cms/editor/preview.js"></script>',
  hashes: ['sha256-' + Buffer.alloc(32).toString('base64')],
}
const snapshot: CanvasSnapshot = {
  manifest: { page: { id, version_id: site, title: 'Private page', path: '/' }, meta: {}, sections: [] },
  shell: {
    site: { id: site, name: 'Private site', slug: 'private' },
    theme: {},
    navigation: [],
    canonical_host: null,
    staging_host: 'site.staging.localhost',
  },
  parentOrigin: 'http://127.0.0.1:3200',
  channel: 'valid-channel-123456789',
  navigationPaths: {},
  showHiddenSections: false,
}

describe('isolated canvas resource transport', () => {
  it('aliases only closed own-site resource paths, preserving suffixes', () => {
    for (const path of [`/media/${id}/wide`, `/assets/${id}`, `/site-files/${id}/${hash}/site.css?x=1#fragment`])
      expect(canvasResourceUrl(path, token)).toBe(`/__cms/read/${token}${path}`)
    for (const path of [
      'https://evil.test/assets/' + id,
      '//evil.test/x',
      '/api/sites/x',
      '/media/../../secret',
      '/__cms/read/other/assets/' + id,
      'data:image/png,ok',
    ])
      expect(canvasResourceUrl(path, token)).toBe(path)
    expect(() => canvasResourceUrl('/assets/' + id, 'invalid')).toThrow()
  })
  it('rewrites only approved original addresses relative to the original page or stylesheet', () => {
    const context = {
      paths: ['/css/site.css', '/images/proof.svg', '/fonts/original.woff2', '/js/items.json', '/js/site.js'],
      basePath: '/workshops.html',
    }
    expect(canvasResourceUrl('images/proof.svg?size=2#photo', token, context)).toBe(
      `/__cms/read/${token}/images/proof.svg?size=2#photo`,
    )
    expect(
      canvasStylesheet(
        '@font-face{src:url(../fonts/original.woff2)}.photo{background:url(../images/proof.svg)}',
        token,
        { ...context, basePath: '/css/site.css' },
      ),
    ).toContain(`/__cms/read/${token}/fonts/original.woff2`)
    for (const url of [
      'https://foreign.test/images/proof.svg',
      '//foreign.test/images/proof.svg',
      '/private/unknown.json',
      '/about',
      '#details',
    ])
      expect(canvasResourceUrl(url, token, context)).toBe(url)
    const html =
      '<html><head><link rel="stylesheet" href="css/site.css" integrity="original-style"></head><body><section class="swiper-slide" data-exact="yes"><img src="images/proof.svg" srcset="images/proof.svg 400w, /images/proof.svg 800w"><a href="/about">About</a><table data-url="js/items.json"></table></section><script src="js/site.js" integrity="exact-script"></script></body></html>'
    const output = canvasDocument(
      html,
      token,
      {
        parentOrigin: snapshot.parentOrigin,
        channel: snapshot.channel,
        expiresAt: '2026-10-26T12:00:00Z',
        paths: context.paths,
        path: context.basePath,
      },
      runtime,
    )
    expect(output).toContain('<section class="swiper-slide" data-exact="yes">')
    expect(output).toContain('<a href="/about">About</a>')
    expect(output).toContain(`data-url="/__cms/read/${token}/js/items.json"`)
    expect(output).toContain(
      `srcset="/__cms/read/${token}/images/proof.svg 400w, /__cms/read/${token}/images/proof.svg 800w"`,
    )
    expect(output).toContain('integrity="exact-script"')
    expect(output).not.toContain('original-style')
    expect(output).toContain('data-cms-resource-paths=')
    expect(output).toContain('data-cms-page-path="/workshops.html"')
  })
  it('verifies mapped private file bytes before deriving relative CSS and refuses unknown addresses without storage reads', async () => {
    const css = new TextEncoder().encode('.photo{background:url(../images/proof.svg)}'),
      sha = createHash('sha256').update(css).digest('hex'),
      mapped = { ...file, sha256: sha, bytes: css.length, object_key: `site-files/${site}/${id}/${sha}` },
      repository = repo(),
      get = vi.fn(async () => css)
    repository.path = vi.fn(async (_host, _token, path) =>
      path === '/css/site.css' ? { file: mapped, paths: ['/css/site.css', '/images/proof.svg'] } : null,
    )
    const handle = createCanvasResourceHandler({
      repository,
      store: { ...store, get },
      host: () => 'site.staging.localhost',
    })
    const response = await handle(
      new Request(`http://site.staging.localhost/__cms/read/${token}/css/site.css`),
      token,
      ['css', 'site.css'],
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(`/__cms/read/${token}/images/proof.svg`)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('etag')).toBeNull()
    expect(repository.path).toHaveBeenCalledWith('site.staging.localhost', token, '/css/site.css')
    get.mockClear()
    expect(
      (
        await handle(new Request(`http://site.staging.localhost/__cms/read/${token}/private/unknown.json`), token, [
          'private',
          'unknown.json',
        ])
      ).status,
    ).toBe(404)
    expect(get).not.toHaveBeenCalled()
    const changed = createCanvasResourceHandler({
      repository,
      store: { ...store, get: async () => new TextEncoder().encode('changed') },
      host: () => 'site.staging.localhost',
    })
    expect(
      (
        await changed(new Request(`http://site.staging.localhost/__cms/read/${token}/css/site.css`), token, [
          'css',
          'site.css',
        ])
      ).status,
    ).toBe(404)
  })
  it('rewrites parsed CSS URLs, including escaped functions and image sets, without changing selectors/keyframes/content', () => {
    const css = `.card:hover{content:"/media/${id}/wide";background:u\\72l(/media/${id}/wide);mask:image-set("/assets/${id}" 1x,url('/assets/${id}') 2x)}@keyframes slide{to{opacity:1;transform:translateX(10px)}}`
    const actual = canvasStylesheet(css, token)
    expect(actual).toContain(`content:"/media/${id}/wide"`)
    expect(actual.match(/__cms\/read/g)).toHaveLength(3)
    expect(actual).toContain('.card:hover')
    expect(actual).toContain('@keyframes slide{to{opacity:1;transform:translateX(10px)}}')
    expect(() => canvasStylesheet('p{color:red', token)).toThrow()
  })
  it('preserves HTML structure while isolating resources and retaining script SRI', () => {
    const html = `<!doctype html><html><head><link rel="stylesheet" href="/site-files/${id}/${hash}/site.css" integrity="original-style"><style>.photo{background:url(/media/${id}/wide)}</style></head><body class="original"><section class='swiper-container' data-original="yes"><img src="/media/${id}/wide" srcset="/media/${id}/card 400w, /media/${id}/wide 1000w"><a href="/about">About</a></section><script src="/site-files/${id}/${hash}/script.js" integrity="original-script"></script></body></html>`
    const actual = canvasDocument(
      html,
      token,
      { parentOrigin: snapshot.parentOrigin, channel: snapshot.channel, expiresAt: '2026-10-26T12:00:00Z' },
      runtime,
    )
    expect(actual).toContain('<section class=\'swiper-container\' data-original="yes">')
    expect(actual).toContain('<body class="original">')
    expect(actual).toContain('<a href="/about">About</a>')
    expect(actual).toContain('integrity="original-script"')
    expect(actual).not.toContain('original-style')
    expect(actual.match(/__cms\/read/g)).toHaveLength(6)
    expect(actual).toContain('data-cms-parent-origin="http://127.0.0.1:3200"')
    expect(actual.indexOf(runtime.head)).toBeLessThan(actual.indexOf('<link'))
    expect(actual).toContain(runtime.body + '</body>')
  })
  it('verifies original stylesheet bytes before private-only URL derivation', async () => {
    const repository = repo(),
      get = vi.fn(store.get)
    const response = await createCanvasResourceHandler({
      repository,
      store: { ...store, get },
      host: () => 'site.staging.localhost',
    })(request(), token, ['site-files', id, hash, 'site.css'])
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('etag')).toBeNull()
    const css = await response.text()
    expect(css).toContain(`/__cms/read/${token}/media/${id}/wide`)
    expect(css).toContain('@keyframes slide')
    expect(repository.file).toHaveBeenCalledWith('site.staging.localhost', token, id)
    const changed = createCanvasResourceHandler({
      repository,
      store: { ...store, get: async () => new TextEncoder().encode('changed') },
      host: () => 'site.staging.localhost',
    })
    expect((await changed(request(), token, ['site-files', id, hash, 'site.css'])).status).toBe(404)
  })
  it('refuses unapproved and malformed resource requests without a storage read', async () => {
    const repository = repo(),
      get = vi.fn(store.get),
      handle = createCanvasResourceHandler({
        repository,
        store: { ...store, get },
        host: () => 'site.staging.localhost',
      })
    for (const path of [
      ['api', id],
      ['assets', '../../secret'],
      ['media', id, 'other'],
      ['site-files', id, '../', 'site.css'],
    ])
      expect((await handle(request(), token, path)).status).toBe(404)
    expect((await handle(request(), 'invalid', ['assets', id])).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
    repository.file = vi.fn(async () => null)
    expect((await handle(request(), token, ['site-files', id, hash, 'site.css'])).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })
  it('uses only a frozen native target, verifies its digest and retains private delivery', async () => {
    const target = '33333333-3333-4333-8333-333333333333',
      bytes = new Uint8Array([1, 2, 3]),
      digest = createHash('sha256').update(bytes).digest('hex'),
      repository = repo()
    repository.native = vi.fn(async () => ({ kind: 'media', mediaId: target, variant: 'original' }))
    repository.media = vi.fn(async () => ({
      mediaId: target,
      variant: 'original' as const,
      objectKey: 'owned/image',
      mimeType: 'image/png' as const,
      bytes: 3,
      width: 1,
      height: 1,
      contentHash: digest,
    }))
    const get = vi.fn(async () => bytes),
      handle = createCanvasResourceHandler({
        repository,
        store: { ...store, get },
        host: () => 'site.staging.localhost',
      })
    const response = await handle(request(), token, ['media', id, 'original'])
    expect(response.status).toBe(200)
    expect(repository.native).toHaveBeenCalledWith('site.staging.localhost', token, `/media/${id}/original`)
    expect(repository.media).toHaveBeenCalledWith('site.staging.localhost', token, target, 'original')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    get.mockResolvedValueOnce(new Uint8Array([3, 2, 1]))
    expect((await handle(request(), token, ['media', id, 'original'])).status).toBe(404)
    repository.native = vi.fn(async () => ({ kind: 'asset', assetId: target }))
    get.mockClear()
    expect((await handle(request(), token, ['media', id, 'original'])).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })
  it('renders only on the isolated origin under exact runtime hashes and parent framing policy', async () => {
    const handle = createCanvasPageHandler({
      host: () => 'site.staging.localhost',
      snapshot: async () => ({ snapshot, expiresAt: '2026-10-26T12:00:00Z' }),
      runtime: async () => runtime,
    })
    const response = await handle(new Request('http://site.staging.localhost:3201/__cms/canvas/' + token), token)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const csp = response.headers.get('content-security-policy')!
    expect(csp).toContain(`script-src '${runtime.hashes[0]}'`)
    expect(csp).toContain('frame-ancestors http://127.0.0.1:3200')
    expect(csp).not.toContain("script-src 'self'")
    expect(csp).toContain("form-action 'none'")
    const html = await response.text()
    expect(html).toContain('Private page')
    expect(html).toContain('data-cms-ticket="' + token + '"')
    expect(html).not.toContain('<script>')
    expect(html).toContain(runtime.body)
    expect((await handle(new Request('http://127.0.0.1:3200/__cms/canvas/' + token), token)).status).toBe(404)
    expect(
      (await handle(new Request('http://site.staging.localhost:3201/__cms/canvas/' + token, { method: 'HEAD' }), token))
        .body,
    ).toBeNull()
  })
  it('visitor mode keeps SSR content and private assets without editor instrumentation or controls', async () => {
    const definition = {
      section_def_id: id,
      version: 1,
      slug: 'hero',
      slots: [{ id: 'heading', kind: 'text' as const, label: 'Heading', constraints: {} }],
      compiled_ast: compileSection({
        sourceHtml: '<section><h1>{{heading}}</h1></section>',
        slots: [{ id: 'heading', kind: 'text', label: 'Heading', constraints: {} }],
      }).ast,
    }
    const data = {
      ...snapshot,
      manifest: {
        ...snapshot.manifest,
        sections: [
          {
            instance: { section_def_id: id, section_def_version: 1, values: { heading: 'Server rendered first' } },
            def: definition,
          },
        ],
      },
    }
    const runtimeFor = vi.fn(async (visitor?: boolean) => (visitor ? { ...runtime, body: '' } : runtime))
    const handle = createCanvasPageHandler({
      host: () => 'site.staging.localhost',
      snapshot: async () => ({ snapshot: data, expiresAt: '2026-10-26T12:00:00Z' }),
      runtime: runtimeFor,
    })
    const response = await handle(
        new Request('http://site.staging.localhost:3201/__cms/canvas/' + token + '?visit=1'),
        token,
      ),
      html = await response.text()
    expect(runtimeFor).toHaveBeenCalledWith(true)
    expect(html).toContain('<h1>Server rendered first</h1>')
    expect(html).not.toContain('data-cms-slot=')
    expect(html).not.toContain('data-cms-section=')
    expect(html).not.toContain('/__cms/editor/preview.js')
    expect(html).toContain('data-cms-ticket="' + token + '"')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('fails closed for expired/foreign tickets and missing code-owned build output', async () => {
    const unavailable = createCanvasPageHandler({
      host: () => 'site.staging.localhost',
      snapshot: async () => null,
      runtime: vi.fn(),
    })
    expect((await unavailable(request(), token)).status).toBe(404)
    const missing = createCanvasPageHandler({
      host: () => 'site.staging.localhost',
      snapshot: async () => ({ snapshot, expiresAt: '2026-10-26T12:00:00Z' }),
      runtime: async () => {
        throw Error('missing')
      },
    })
    expect((await missing(request(), token)).status).toBe(503)
  })
})
