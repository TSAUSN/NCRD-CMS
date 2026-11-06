import { describe, it, expect } from 'vitest'
import { compileSection } from './compile.ts'
import { renderSiteFiles, siteFileIntegrity } from './site-files.ts'
import { renderPage, type SiteShell, type RenderManifest } from './render.ts'
const first = '11111111-1111-4111-a111-111111111111',
  second = '22222222-2222-4222-a222-222222222222',
  style = '33333333-3333-4333-a333-333333333333',
  page = '44444444-4444-4444-a444-444444444444'
const file = (id: string, kind = 'script', name = 'site.js') => ({
  id,
  kind,
  name,
  sha256: 'a'.repeat(64),
  bytes: 100,
  source: 'local:' + name,
})
const projection = {
  versionId: first,
  files: [file(first), file(second), file(style, 'stylesheet', 'site.css')],
  bundle: {
    version: 1,
    files: [first, second, style],
    scripts: [
      { fileId: first, position: 'head', loading: 'normal', pages: [] },
      { fileId: second, position: 'body-end', loading: 'defer', pages: [page] },
    ],
    styles: [{ fileId: style, pages: [] }],
  },
}
const shell: SiteShell = {
  site: { id: 's', name: 'Example', slug: 'example' },
  theme: {},
  navigation: [],
  canonical_host: null,
  staging_host: null,
  site_files: projection,
}
const manifest: RenderManifest = {
  page: { id: page, version_id: 'v', title: 'Example', path: '/' },
  meta: {},
  sections: [],
}
describe('approved site file rendering', () => {
  it('preserves position and order, exact SRI hashes and selected-page scope', () => {
    const result = renderSiteFiles(projection, page)
    expect(result.head).toContain(`<link rel="stylesheet" href="/site-files/${style}/`)
    expect(result.head).toContain(`<script src="/site-files/${first}/`)
    expect(result.bodyEnd).toContain(`<script src="/site-files/${second}/`)
    expect(result.bodyEnd).toContain(' defer>')
    expect(result.scriptHashes).toEqual([siteFileIntegrity('a'.repeat(64)), siteFileIntegrity('a'.repeat(64))])
    const other = renderSiteFiles(projection, first)
    expect(other.bodyEnd).toBe('')
    expect(other.head).toContain(first)
  })
  it('loads approved files at their exact original addresses with unchanged SRI and original relative-URL bases', () => {
    const mounted = {
      ...projection,
      bundle: {
        ...projection.bundle,
        paths: [
          { path: '/js/original.js', fileId: first },
          { path: '/css/styles-new.css', fileId: style },
        ],
      },
    }
    const result = renderSiteFiles(mounted, page)
    expect(result.head).toContain(`<script src="/js/original.js" integrity="${siteFileIntegrity('a'.repeat(64))}">`)
    expect(result.head).toContain(
      `<link rel="stylesheet" href="/css/styles-new.css" integrity="${siteFileIntegrity('a'.repeat(64))}">`,
    )
    expect(result.bodyEnd).toContain(`/site-files/${second}/`)
    expect(result.scriptHashes).toEqual(renderSiteFiles(projection, page).scriptHashes)
    expect(
      renderSiteFiles(
        {
          ...mounted,
          bundle: { ...mounted.bundle, paths: [{ path: 'https://foreign.test/script.js', fileId: first }] },
        },
        page,
      ).head,
    ).toBe('')
  })
  it('refuses malformed/unknown/foreign metadata and mismatched file kinds', () => {
    expect(renderSiteFiles({ ...projection, inline: 'bad()' }, page).head).toBe('')
    expect(renderSiteFiles({ ...projection, files: [file(first)] }, page).head).toBe('')
    expect(
      renderSiteFiles(
        {
          ...projection,
          files: [file(first, 'stylesheet', 'wrong.css'), file(second), file(style, 'stylesheet', 'site.css')],
        },
        page,
      ).scriptHashes,
    ).toHaveLength(1)
    expect(renderSiteFiles(undefined, page).scriptHashes).toEqual([])
  })
  it('emits only external approved files, with no change to sites without files or section-only previews', () => {
    const html = renderPage({ manifest, shell, isStaging: true }).html
    expect(html.indexOf(`/site-files/${first}/`)).toBeLessThan(html.indexOf('</head>'))
    expect(html.indexOf(`/site-files/${second}/`)).toBeGreaterThan(html.indexOf('<body>'))
    expect(html).not.toMatch(/<script(?! [^>]*src=)[^>]*>/)
    expect(renderPage({ manifest, shell: { ...shell, site_files: undefined }, isStaging: true }).html).not.toContain(
      '/site-files/',
    )
    expect(renderPage({ manifest, shell, isStaging: true, options: { sectionOnly: true } }).html).not.toContain(
      '/site-files/',
    )
  })
  it('automatically externalizes governed enhancements on public pages carrying approved scripts', () => {
    const ast = compileSection({
      sourceHtml:
        '<section><input type="search" disabled data-cms-faq-filter aria-label="Search"><details><summary>Question</summary><p>Answer</p></details></section>',
      slots: [],
    }).ast
    const content = {
      ...manifest,
      sections: [
        {
          instance: { section_def_id: 'faq', section_def_version: 1, values: {} },
          def: { section_def_id: 'faq', version: 1, slug: 'faq', compiled_ast: ast },
        },
      ],
    }
    const html = renderPage({ manifest: content, shell, isStaging: true }).html
    expect(html).toContain(`/site-files/${first}/`)
    expect(html).toMatch(/<script src="\/__cms\/runtime\/faq\.[A-Za-z0-9_-]{43}\.js" integrity="sha256-/)
    expect(html).not.toMatch(/<script(?! [^>]*src=)[^>]*>/)
    expect(
      renderPage({ manifest: content, shell: { ...shell, site_files: undefined }, isStaging: true }).html,
    ).toContain('<script>')
  })
  it('keeps the existing same-origin admin canvas and scriptless evidence inert until explicit isolated-canvas activation', () => {
    for (const options of [{ preview: true }, { providerEmbeds: false }, { siteFiles: false }]) {
      const html = renderPage({ manifest, shell, isStaging: true, options }).html
      expect(html).not.toContain(`<script src="/site-files/${first}/`)
      expect(html).not.toContain(`<script src="/site-files/${second}/`)
      expect(html).toContain(`<link rel="stylesheet" href="/site-files/${style}/`)
    }
    expect(
      renderPage({ manifest, shell, isStaging: true, options: { preview: true, siteFiles: true } }).html,
    ).toContain(`<script src="/site-files/${first}/`)
  })
})
