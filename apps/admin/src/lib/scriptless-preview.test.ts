import { describe, it, expect } from 'vitest'
import {
  SCRIPTLESS_PREVIEW_CSP,
  SCRIPTLESS_PREVIEW_META_CSP,
  SCRIPTLESS_PREVIEW_SANDBOX,
  SCRIPTLESS_RENDER_OPTIONS,
  scriptlessPreviewHtml,
  scriptlessSrcDocPolicy,
  scriptlessPreviewCsp,
  previewStyleSource,
  previewRequestOrigin,
} from './scriptless-preview.ts'
import { compileSection, renderPage } from '@cms/renderer'
import { HNI_TABLEAU_EMBEDS } from '@cms/schema'

describe('authenticated scriptless previews', () => {
  it('renders an inert provider description that remains readable under the actual scriptless CSP', () => {
    const { html } = renderPage({
      manifest: {
        page: { id: 'page', version_id: 'version', title: 'Chart review', path: '/' },
        meta: {},
        sections: [
          {
            instance: { section_def_id: 'chart', section_def_version: 1, values: {} },
            def: {
              section_def_id: 'chart',
              version: 1,
              slug: 'chart',
              compiled_ast: compileSection({ sourceHtml: '', slots: [] }).ast,
              definition_kind: 'structured',
              structured_schema_version: 3,
              structured_doc: { schemaVersion: 3, fields: [], nodes: [HNI_TABLEAU_EMBEDS.map] },
            },
          },
        ],
      },
      shell: {
        site: { id: 'site', name: 'Preview', slug: 'preview' },
        theme: {},
        navigation: [],
        canonical_host: null,
        staging_host: null,
      },
      isStaging: true,
      options: SCRIPTLESS_RENDER_OPTIONS,
    })
    const preview = scriptlessPreviewHtml(html)
    expect(preview).toContain('Interactive Tableau chart')
    expect(preview).toContain('Open larger on Tableau')
    expect(preview).not.toMatch(/<iframe|<script|srcdoc=/)
    expect(preview).not.toContain('Load interactive chart')
    expect(preview).toContain("frame-src 'none'")
    expect(preview).toContain("script-src 'none'")
  })
  it('retains origin without granting scripts, forms, popups or navigation capabilities', () => {
    expect(SCRIPTLESS_PREVIEW_SANDBOX).toBe('allow-same-origin')
    expect(SCRIPTLESS_PREVIEW_CSP).toContain("script-src 'none'")
    expect(SCRIPTLESS_PREVIEW_CSP).toContain("form-action 'none'")
    expect(SCRIPTLESS_PREVIEW_CSP).toContain("frame-src 'none'")
    expect(SCRIPTLESS_PREVIEW_CSP).toContain("connect-src 'none'")
    expect(SCRIPTLESS_PREVIEW_CSP).toContain('sandbox allow-same-origin')
    expect(SCRIPTLESS_PREVIEW_META_CSP).not.toContain('frame-ancestors')
  })
  it('places CSP before authored content in srcDoc instead of relying on discarded response headers', () => {
    const html =
      '<!doctype html><html><head><style>body{color:red}</style></head><body><img src="/media/example/wide"><script>window.parent.compromised=true</script></body></html>'
    const result = scriptlessPreviewHtml(html)
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<style>'))
    expect(result).toContain("img-src 'self' data:")
    expect(result).toContain('<img src="/media/example/wide">')
    expect(scriptlessPreviewHtml('<p>Fragment</p>')).toContain('<head><meta http-equiv="Content-Security-Policy"')
  })
})

it('names only the embedding image origin and owned font paths for srcdoc, replacing the exact generated meta once', () => {
  const origin = 'http://127.0.0.1:3200',
    policy = scriptlessSrcDocPolicy(origin)
  expect(policy.split('; ').find(value => value.startsWith('img-src '))).toBe(
    "img-src 'self' http://127.0.0.1:3200 data: https://p.typekit.net",
  )
  expect(policy.split('; ').find(value => value.startsWith('font-src '))).toBe(
    "font-src 'self' http://127.0.0.1:3200/cms-samples/fonts/ http://127.0.0.1:3200/assets/ http://127.0.0.1:3200/__cms/fonts/ https://use.typekit.net",
  )
  expect(policy).toContain("script-src 'none'")
  expect(policy).toContain("connect-src 'none'")
  expect(policy).toContain("form-action 'none'")
  expect(policy).toContain("frame-src 'none'")
  for (const invalid of [
    'javascript:alert(1)',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test/\"',
  ])
    expect(scriptlessSrcDocPolicy(invalid)).toBe(SCRIPTLESS_PREVIEW_META_CSP)
  const html = scriptlessPreviewHtml(scriptlessPreviewHtml('<h1>Preview</h1>'), origin)
  expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1)
  expect(html).toContain(policy)
  const authored = '<meta http-equiv="Content-Security-Policy" content="font-src none">'
  expect(scriptlessPreviewHtml('<head>' + authored + '</head>', origin)).toContain(authored)
})

it('allows local styles only through the authenticated immutable-file path, without enabling scripts or general same-origin CSS', () => {
  const origin = 'http://127.0.0.1:3200'
  for (const policy of [scriptlessPreviewCsp(origin), scriptlessSrcDocPolicy(origin)]) {
    const styles = policy.split('; ').find(part => part.startsWith('style-src '))!
    expect(styles).toContain(origin + '/site-files/')
    expect(styles).not.toContain("'self'")
    expect(styles).not.toContain('*')
    for (const directive of [
      "script-src 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "connect-src 'none'",
      "object-src 'none'",
    ])
      expect(policy).toContain(directive)
  }
  expect(scriptlessPreviewCsp(origin)).toContain('sandbox allow-same-origin')
  for (const invalid of [
    undefined,
    'javascript:alert(1)',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test/\"',
  ]) {
    expect(previewStyleSource(invalid)).toBe('')
    expect(scriptlessPreviewCsp(invalid)).toBe(SCRIPTLESS_PREVIEW_CSP)
  }
})

it('binds private styles to the browser authority and fails closed for malformed Host values', () => {
  expect(
    previewRequestOrigin(new Request('http://localhost:3200/preview/page', { headers: { host: '127.0.0.1:3200' } })),
  ).toBe('http://127.0.0.1:3200')
  expect(previewRequestOrigin(new Request('http://localhost:3200/preview/page'))).toBe('http://localhost:3200')
  for (const host of ['example.test/path', 'user:pass@example.test', 'example.test#fragment'])
    expect(
      previewRequestOrigin(new Request('http://localhost:3200/preview/page', { headers: { host } })),
    ).toBeUndefined()
})
