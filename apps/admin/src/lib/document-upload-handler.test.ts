import { describe, expect, it, vi } from 'vitest'
import { SITE_ASSET_LIMIT } from '@cms/platform'
import { createDocumentUploadHandler } from './document-upload-handler.ts'
const siteId = '22222222-2222-4222-a222-222222222222'
const userId = '33333333-3333-4333-a333-333333333333'
const bytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
const document = { id: siteId, originalName: 'Résumé report.pdf', bytes: bytes.length, url: `/assets/${siteId}` }
function setup() {
  const currentSession = vi.fn(async () => ({ userId }) as { userId: string } | null)
  const upload = vi.fn(async () => document)
  return { currentSession, upload, handle: createDocumentUploadHandler({ currentSession, upload }) }
}
function request(extra: Record<string, string> = {}, body: BodyInit = bytes) {
  return new Request('https://admin.example.test/api/sites/site/documents', {
    method: 'POST',
    body,
    headers: {
      origin: 'https://admin.example.test',
      'content-type': 'application/pdf',
      'x-document-name': encodeURIComponent(document.originalName),
      ...extra,
    },
  })
}
describe('document upload HTTP boundary', () => {
  it('accepts a same-origin session PDF and returns the exact document response contract', async () => {
    const deps = setup(),
      result = await deps.handle(request({ 'content-length': String(bytes.length) }), siteId)
    expect(result.status).toBe(201)
    expect(await result.json()).toEqual({ document })
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(deps.upload).toHaveBeenCalledWith(userId, siteId, new Uint8Array(bytes), 'Résumé report.pdf')
  })
  it('bounds and accepts body length even when a browser omits Content-Length', async () => {
    const deps = setup()
    expect((await deps.handle(request(), siteId)).status).toBe(201)
  })
  it.each([
    'https://other.example.test',
    'http://admin.example.test',
    'null',
    '',
    'https://admin.example.test/path',
    'https://evil@admin.example.test',
  ])('refuses invalid origin %s before session or upload', async origin => {
    const deps = setup()
    expect((await deps.handle(request({ origin }), siteId)).status).toBe(403)
    expect(deps.currentSession).not.toHaveBeenCalled()
    expect(deps.upload).not.toHaveBeenCalled()
  })
  it('rejects logged-out callers, invalid sites, and cross-site fetch metadata', async () => {
    const deps = setup()
    deps.currentSession.mockResolvedValue(null)
    expect((await deps.handle(request(), siteId)).status).toBe(404)
    deps.currentSession.mockResolvedValue({ userId })
    expect((await deps.handle(request(), 'not-an-id')).status).toBe(404)
    expect((await deps.handle(request({ 'sec-fetch-site': 'cross-site' }), siteId)).status).toBe(403)
    expect(deps.upload).not.toHaveBeenCalled()
  })
  it.each(['text/html', 'image/png', 'application/pdf; charset=utf-8', ''])(
    'refuses declared type %s',
    async contentType => {
      const deps = setup()
      expect((await deps.handle(request({ 'content-type': contentType }), siteId)).status).toBe(415)
      expect(deps.upload).not.toHaveBeenCalled()
    },
  )
  it.each(['report.txt', '../report.pdf', 'report.pdf\r\nX-Evil: yes', 'bad\\name.pdf', '', 'a'.repeat(256) + '.pdf'])(
    'refuses unusable filenames',
    async name => {
      const deps = setup()
      expect((await deps.handle(request({ 'x-document-name': encodeURIComponent(name) }), siteId)).status).toBe(400)
      expect(deps.upload).not.toHaveBeenCalled()
    },
  )
  it('refuses malformed encoding, misleading Content-Length and disguised PDFs', async () => {
    const deps = setup()
    for (const req of [
      request({ 'x-document-name': '%zz' }),
      request({ 'content-length': '-1' }),
      request({ 'content-length': '2' }),
      request({}, '<html>bad</html>'),
      request({}, '%PDF-1.4 truncated'),
    ]) {
      expect((await deps.handle(req, siteId)).status).toBe(400)
    }
    expect(deps.upload).not.toHaveBeenCalled()
  })
  it('rejects both declared and actual oversize bodies before upload', async () => {
    const deps = setup()
    expect((await deps.handle(request({ 'content-length': String(SITE_ASSET_LIMIT + 1) }), siteId)).status).toBe(413)
    expect((await deps.handle(request({}, new Uint8Array(SITE_ASSET_LIMIT + 1)), siteId)).status).toBe(413)
    expect(deps.upload).not.toHaveBeenCalled()
  })
  it.each(['not_authorized', 'not_found'])('hides a %s destination', async kind => {
    const deps = setup()
    deps.upload.mockRejectedValue({ kind })
    expect((await deps.handle(request(), siteId)).status).toBe(404)
  })
})

describe('document upload proxy origin handling', () => {
  it('ignores spoofed forwarded schemes unless proxy headers are explicitly trusted', async () => {
    const currentSession = vi.fn(async () => ({ userId })),
      upload = vi.fn(async () => document)
    const untrusted = createDocumentUploadHandler({ currentSession, upload, trustProxyHeaders: false })
    const trusted = createDocumentUploadHandler({ currentSession, upload, trustProxyHeaders: true })
    const proxied = () =>
      new Request('http://admin.example.test/api/documents', {
        method: 'POST',
        body: bytes,
        headers: {
          origin: 'https://admin.example.test',
          'x-forwarded-proto': 'https',
          'content-type': 'application/pdf',
          'x-document-name': 'report.pdf',
        },
      })
    expect((await untrusted(proxied(), siteId)).status).toBe(403)
    expect(upload).not.toHaveBeenCalled()
    expect((await trusted(proxied(), siteId)).status).toBe(201)
  })
})
