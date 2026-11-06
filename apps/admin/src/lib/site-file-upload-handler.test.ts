import { describe, it, expect, vi } from 'vitest'
import { createSiteFileUploadHandler } from './site-file-upload-handler.ts'
const site = '11111111-1111-4111-a111-111111111111',
  user = '22222222-2222-4222-a222-222222222222'
const bytes = Buffer.from('document.documentElement.dataset.reviewed="yes";')
function setup() {
  const currentSession = vi.fn(
      async () => ({ userId: user, isSuperAdmin: true }) as { userId: string; isSuperAdmin: boolean } | null,
    ),
    upload = vi.fn(async () => ({
      id: site,
      kind: 'script' as const,
      name: 'site.js',
      source: 'local:site.js',
      sha256: 'a'.repeat(64),
      bytes: bytes.length,
    }))
  return { currentSession, upload, handle: createSiteFileUploadHandler({ currentSession, upload }) }
}
const request = (extra: Record<string, string> = {}, body: BodyInit = bytes) =>
  new Request('https://admin.example.test/api/sites/site/files', {
    method: 'POST',
    body,
    headers: {
      origin: 'https://admin.example.test',
      'content-type': 'application/octet-stream',
      'x-site-file-name': 'site.js',
      'x-site-file-source': 'local%3Asite.js',
      'x-site-file-kind': 'script',
      ...extra,
    },
  })
describe('site file upload HTTP boundary', () => {
  it('allows an exact same-origin Super Admin upload with bounded bytes and source metadata', async () => {
    const deps = setup(),
      result = await deps.handle(request(), site)
    expect(result.status).toBe(201)
    expect(deps.upload).toHaveBeenCalledWith(user, site, 'script', 'site.js', 'local:site.js', new Uint8Array(bytes))
    expect(result.headers.get('cache-control')).toBe('no-store')
  })
  it.each([
    'https://other.example.test',
    'http://admin.example.test',
    'null',
    '',
    'https://admin.example.test/path',
    'https://evil@admin.example.test',
  ])('rejects invalid origin %s before reading a session or storing bytes', async origin => {
    const deps = setup()
    expect((await deps.handle(request({ origin }), site)).status).toBe(403)
    expect(deps.currentSession).not.toHaveBeenCalled()
    expect(deps.upload).not.toHaveBeenCalled()
  })
  it('refuses logged-out, Editor, malformed-site and cross-site Fetch Metadata callers before storage', async () => {
    const deps = setup()
    deps.currentSession.mockResolvedValue(null)
    expect((await deps.handle(request(), site)).status).toBe(404)
    deps.currentSession.mockResolvedValue({ userId: user, isSuperAdmin: false })
    expect((await deps.handle(request(), site)).status).toBe(404)
    deps.currentSession.mockResolvedValue({ userId: user, isSuperAdmin: true })
    expect((await deps.handle(request(), 'foreign')).status).toBe(404)
    expect((await deps.handle(request({ 'sec-fetch-site': 'same-site' }), site)).status).toBe(403)
    expect(deps.upload).not.toHaveBeenCalled()
  })
  it('refuses unusable names, credential-bearing sources, unsupported types, corrupt bytes and invalid declared lengths', async () => {
    const deps = setup()
    for (const extra of [
      { 'x-site-file-name': '..%2Fevil.js' },
      { 'x-site-file-source': 'https%3A%2F%2Fuser%3Asecret%40example.test%2Fscript.js' },
      { 'x-site-file-kind': 'html' },
      { 'content-length': '-1' },
      { 'content-length': String(bytes.length + 1) },
    ] as Record<string, string>[])
      expect((await deps.handle(request(extra), site)).status).toBe(400)
    expect((await deps.handle(request({}, '<script>bad()</script>'), site)).status).toBe(400)
    expect((await deps.handle(request({ 'content-type': 'text/html' }), site)).status).toBe(415)
    expect((await deps.handle(request({ 'content-length': String(26 * 1024 * 1024) }), site)).status).toBe(413)
    expect(deps.upload).not.toHaveBeenCalled()
  })
  it('bounds streamed uploads without a declared length and does not register oversized bytes', async () => {
    const deps = setup()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(26 * 1024 * 1024))
        controller.close()
      },
    })
    const streamed = new Request('https://admin.example.test/api/sites/site/files', {
      method: 'POST',
      body,
      duplex: 'half',
      headers: {
        origin: 'https://admin.example.test',
        'content-type': 'application/octet-stream',
        'x-site-file-name': 'site.js',
        'x-site-file-source': 'local%3Asite.js',
        'x-site-file-kind': 'script',
      },
    } as RequestInit)
    expect((await deps.handle(streamed, site)).status).toBe(413)
    expect(deps.upload).not.toHaveBeenCalled()
  })
})
