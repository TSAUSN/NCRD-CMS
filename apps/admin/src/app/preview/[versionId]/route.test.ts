import { beforeEach, describe, expect, it, vi } from 'vitest'
const stubs = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), buildPreview: vi.fn(), renderPage: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found')
  },
}))
vi.mock('../../../lib/session.ts', () => ({ currentSession: stubs.session }))
vi.mock('../../../lib/queries.ts', () => ({ buildPreview: stubs.buildPreview }))
vi.mock('@cms/platform', () => ({
  asUser: (_identity: unknown, work: (client: unknown) => unknown) => work({ query: stubs.query }),
}))
vi.mock('@cms/renderer', async original => ({
  ...(await original<object>()),
  renderPage: stubs.renderPage,
  previewScriptHash: () => 'sha256-preview',
}))
import { GET } from './route.ts'
import { scriptlessPreviewCsp, SCRIPTLESS_RENDER_OPTIONS } from '../../../lib/scriptless-preview.ts'

function request(query = '') {
  return GET(new Request(`http://localhost/preview/version-a${query}`), {
    params: Promise.resolve({ versionId: 'version-a' }),
  })
}
function version(status = 'archived', initial = false) {
  stubs.query.mockResolvedValue({
    rows: [{ site_id: 'site-a', site_status: status, initial_release_required: initial }],
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  stubs.session.mockResolvedValue({ principal: { userId: 'editor' } })
  version()
  stubs.buildPreview.mockResolvedValue({ manifest: {}, shell: {}, navigationPaths: {} })
  stubs.renderPage.mockReturnValue({ html: '<p>Saved content</p>' })
})
describe('saved page preview archive guard', () => {
  it('forces a scriptless response after archive even when a stale editor requests an editable preview', async () => {
    const response = await request('?site=draft&hidden=1')
    expect(stubs.renderPage.mock.calls[0]![0].options).toEqual({
      ...SCRIPTLESS_RENDER_OPTIONS,
      storyWidgets: { path: '/preview/version-a', query: {}, fixedQuery: { site: 'draft', hidden: '1' } },
    })
    expect(response.headers.get('content-security-policy')).toBe(scriptlessPreviewCsp('http://localhost'))
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(stubs.buildPreview).toHaveBeenCalledWith('editor', 'version-a', 'site-a', false, false)
  })
  it('retains private saved appearance when an archived site has never had a release', async () => {
    version('archived', true)
    await request('?readonly=1&site=draft')
    expect(stubs.buildPreview).toHaveBeenCalledWith('editor', 'version-a', 'site-a', true, false)
    expect(stubs.renderPage.mock.calls[0]![0].options).toEqual({
      ...SCRIPTLESS_RENDER_OPTIONS,
      storyWidgets: { path: '/preview/version-a', query: {}, fixedQuery: { readonly: '1', site: 'draft' } },
    })
  })
  it('keeps ordinary active canvases editable with the requested saved appearance', async () => {
    version('active')
    const response = await request('?site=draft&hidden=1')
    expect(stubs.buildPreview).toHaveBeenCalledWith('editor', 'version-a', 'site-a', true, true)
    expect(stubs.renderPage.mock.calls[0]![0].options).toEqual({ preview: true, showHiddenSections: true })
    expect(response.headers.get('content-security-policy')).toContain('sha256-preview')
  })
  it('does not replace published history appearance with newer drafts for an existing active site', async () => {
    version('active')
    await request('?readonly=1&site=draft')
    expect(stubs.buildPreview).toHaveBeenCalledWith('editor', 'version-a', 'site-a', false, false)
    expect(stubs.renderPage.mock.calls[0]![0].options).toEqual({
      ...SCRIPTLESS_RENDER_OPTIONS,
      storyWidgets: { path: '/preview/version-a', query: {}, fixedQuery: { readonly: '1', site: 'draft' } },
    })
  })
  it('keeps ordinary history published even before the first release or without a context parameter', async () => {
    version('active', true)
    await request('?readonly=1&site=draft')
    expect(stubs.buildPreview).toHaveBeenLastCalledWith('editor', 'version-a', 'site-a', false, false)
    await request('?readonly=1')
    expect(stubs.buildPreview).toHaveBeenLastCalledWith('editor', 'version-a', 'site-a', false, false)
  })
  it('requires an authorized session and version before rendering content', async () => {
    stubs.session.mockResolvedValueOnce(null)
    await expect(request()).rejects.toThrow('not found')
    expect(stubs.query).not.toHaveBeenCalled()
    stubs.query.mockResolvedValueOnce({ rows: [] })
    await expect(request()).rejects.toThrow('not found')
    expect(stubs.buildPreview).not.toHaveBeenCalled()
    expect(stubs.renderPage).not.toHaveBeenCalled()
  })
})

it('renders an authenticated visitor preview without editor scripts and honors its saved-look choice', async () => {
  version('active')
  const response = await request('?visit=1&site=draft&hidden=1')
  expect(stubs.buildPreview).toHaveBeenCalledWith('editor', 'version-a', 'site-a', true, false)
  expect(stubs.renderPage.mock.calls[0]![0].options).toEqual({
    ...SCRIPTLESS_RENDER_OPTIONS,
    visitorPreview: true,
    showHiddenSections: true,
    storyWidgets: { path: '/preview/version-a', query: {}, fixedQuery: { visit: '1', site: 'draft', hidden: '1' } },
  })
  expect(response.headers.get('content-security-policy')).toBe(scriptlessPreviewCsp('http://localhost'))
  expect(response.headers.get('cache-control')).toBe('no-store, private')
})

it('allows list drafts only in the editing canvas or an explicit private visitor choice, never in history', async () => {
  version('active')
  await request('?visit=1&lists=draft')
  expect(stubs.buildPreview).toHaveBeenLastCalledWith('editor', 'version-a', 'site-a', false, true)
  await request('?readonly=1&lists=draft')
  expect(stubs.buildPreview).toHaveBeenLastCalledWith('editor', 'version-a', 'site-a', false, false)
})

it('allows governed styles at the browser Host when Next names an internal listener', async () => {
  version('active')
  const response = await GET(
    new Request('http://localhost:3200/preview/version-a?readonly=1', { headers: { host: '127.0.0.1:3200' } }),
    { params: Promise.resolve({ versionId: 'version-a' }) },
  )
  const policy = response.headers.get('content-security-policy')!
  expect(policy).toContain('http://127.0.0.1:3200/site-files/')
  expect(policy).not.toContain('http://localhost:3200/site-files/')
  expect(policy).toContain("script-src 'none'")
  expect(policy).toContain('sandbox allow-same-origin')
})

it('returns an inert Home tile before rendering authored file aliases', async () => {
  version('active')
  const file = '11111111-1111-4111-8111-111111111111'
  stubs.buildPreview.mockResolvedValue({
    manifest: {},
    shell: {
      site_files: {
        versionId: '22222222-2222-4222-8222-222222222222',
        bundle: {
          version: 1,
          files: [file],
          scripts: [],
          styles: [{ fileId: file, pages: [] }],
          paths: [{ path: '/css/original.css', fileId: file }],
        },
        files: [
          {
            id: file,
            kind: 'stylesheet',
            name: 'original.css',
            sha256: 'a'.repeat(64),
            bytes: 1,
            source: 'local:original.css',
          },
        ],
      },
    },
    navigationPaths: {},
  })
  const response = await request('?readonly=1&thumbnail=1'),
    html = await response.text()
  expect(html).toContain('Reviewed site files')
  expect(html).toContain('data-cms-preview-placeholder="site-files"')
  expect(html).not.toMatch(/<(?:script|link|img)\b/i)
  expect(stubs.renderPage).not.toHaveBeenCalled()
  expect(response.headers.get('content-security-policy')).toContain("script-src 'none'")
  expect(stubs.buildPreview).toHaveBeenCalledWith('editor', 'version-a', 'site-a', false, false)
})

it('labels a saved original draft even while its published appearance has no files', async () => {
  stubs.query.mockResolvedValue({
    rows: [{ site_id: 'site-a', site_status: 'active', initial_release_required: false, original_design: true }],
  })
  const response = await request('?readonly=1&thumbnail=1'),
    html = await response.text()
  expect(html).toContain('Original design')
  expect(stubs.renderPage).not.toHaveBeenCalled()
  expect(html).not.toMatch(/<(?:script|link|img)\b/i)
})
