import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deliverSiteAsset, inspectSiteAsset, type ResolvedSiteAsset } from './site-assets.ts'
import type { MediaStore } from './ports.ts'
const bytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
const id = '11111111-1111-4111-a111-111111111111'
const record: ResolvedSiteAsset = {
  id,
  kind: 'document',
  mime_type: 'application/pdf',
  bytes: bytes.length,
  content_hash: createHash('sha256').update(bytes).digest('hex'),
  font_key: null,
  object_key: 'asset/report',
  original_name: 'Annual report.pdf',
}
const store = { get: async () => bytes } as unknown as MediaStore
describe('asset delivery boundary', () => {
  it('downloads a checked PDF with attachment and conservative cache headers', async () => {
    const response = await deliverSiteAsset({ assetId: id, resolve: async () => record, store, visibility: 'public' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('cache-control')).toContain('must-revalidate')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
  })
  it('refuses missing authorization, corrupt bytes, mismatched identities, arbitrary fonts and disguised HTML', async () => {
    for (const asset of [
      null,
      { ...record, id: '22222222-2222-4222-a222-222222222222' },
      { ...record, content_hash: 'a'.repeat(64) },
      { ...record, kind: 'font', font_key: 'trajan-regular' },
    ] as (ResolvedSiteAsset | null)[]) {
      expect(
        (await deliverSiteAsset({ assetId: id, resolve: async () => asset, store, visibility: 'admin' })).status,
      ).toBe(404)
    }
    expect(() => inspectSiteAsset(Buffer.from('<script>alert(1)</script>'), 'document', null)).toThrow()
    expect(() => inspectSiteAsset(bytes, 'font', 'trajan-regular')).toThrow()
    expect(() => inspectSiteAsset(Buffer.from('%PDF-1.4 truncated'), 'document', null)).toThrow()
  })
})

import { vi } from 'vitest'
import { importFrozenSiteAsset, isSiteDocumentName, uploadSiteDocument } from './site-assets.ts'
import type { Queryable } from './publication.ts'
const siteId = '22222222-2222-4222-a222-222222222222'
function uploadDeps() {
  const objects = new Map<string, Uint8Array>()
  const put = vi.fn(async (key: string, value: Uint8Array) => {
    objects.set(key, value)
  })
  const get = vi.fn(async (key: string) => objects.get(key) ?? null)
  const query = vi.fn(async (sql: string, args?: unknown[]) => ({
    rows: sql.includes('AS id') ? [{ id: args?.[1] }] : [],
  }))
  return { client: { query } as unknown as Queryable, store: { put, get } as unknown as MediaStore, put, get, query }
}
describe('governed document upload', () => {
  it('checks permission before any storage and preserves frozen-import super-admin gating', async () => {
    const deps = uploadDeps()
    deps.query.mockRejectedValue(new Error('not authorized'))
    await expect(uploadSiteDocument({ ...deps, siteId, bytes, originalName: 'Report.pdf' })).rejects.toThrow(
      'not authorized',
    )
    expect(deps.put).not.toHaveBeenCalled()
    expect(deps.get).not.toHaveBeenCalled()
    const imported = uploadDeps()
    await expect(
      importFrozenSiteAsset({
        ...imported,
        siteId,
        bytes,
        kind: 'document',
        originalName: 'Report.pdf',
        provenance: { path: 'source/report.pdf', sha256: record.content_hash, manifest_sha256: 'b'.repeat(64) },
      }),
    ).rejects.toThrow('super admin')
    expect(imported.put).not.toHaveBeenCalled()
  })
  it('retries deterministically and scopes immutable identities by site, bytes and filename', async () => {
    const deps = uploadDeps()
    const first = await uploadSiteDocument({ ...deps, siteId, bytes, originalName: 'Annual report.pdf' })
    const retry = await uploadSiteDocument({ ...deps, siteId, bytes, originalName: 'Annual report.pdf' })
    expect(retry).toEqual(first)
    expect(first).toEqual({
      id: expect.any(String),
      originalName: 'Annual report.pdf',
      bytes: bytes.length,
      url: `/assets/${first.id}`,
    })
    expect(deps.query.mock.calls[0]?.[0]).toContain('authorize_site_document_upload')
    expect(deps.put.mock.calls[0]?.[0]).toBe(`site-assets/${siteId}/${first.id}/${record.content_hash}`)
    expect((await uploadSiteDocument({ ...deps, siteId: id, bytes, originalName: 'Annual report.pdf' })).id).not.toBe(
      first.id,
    )
    expect((await uploadSiteDocument({ ...deps, siteId, bytes, originalName: 'Renamed.pdf' })).id).not.toBe(first.id)
    expect(
      (
        await uploadSiteDocument({
          ...deps,
          siteId,
          bytes: Buffer.from('%PDF-1.4\nchanged\n%%EOF'),
          originalName: 'Annual report.pdf',
        })
      ).id,
    ).not.toBe(first.id)
  })
  it('refuses filenames, empty/oversized files and invalid PDF bytes before storage', async () => {
    for (const name of [
      '',
      'report.txt',
      '../report.pdf',
      'a\\report.pdf',
      ' bad.pdf',
      'bad.pdf\n',
      'a'.repeat(256) + '.pdf',
    ]) {
      expect(isSiteDocumentName(name)).toBe(false)
      const deps = uploadDeps()
      await expect(uploadSiteDocument({ ...deps, siteId, bytes, originalName: name })).rejects.toThrow()
      expect(deps.put).not.toHaveBeenCalled()
    }
    expect(isSiteDocumentName('Résumé 2026.PDF')).toBe(true)
    for (const value of [new Uint8Array(), Buffer.from('<html>bad</html>'), new Uint8Array(25 * 1024 * 1024 + 1)]) {
      const deps = uploadDeps()
      await expect(uploadSiteDocument({ ...deps, siteId, bytes: value, originalName: 'Report.pdf' })).rejects.toThrow()
      expect(deps.put).not.toHaveBeenCalled()
    }
  })
  it('never registers corrupt or missing stored bytes', async () => {
    const deps = uploadDeps()
    deps.get.mockResolvedValue(Buffer.from('corrupt'))
    await expect(uploadSiteDocument({ ...deps, siteId, bytes, originalName: 'Report.pdf' })).rejects.toThrow('checksum')
    expect(deps.query.mock.calls.every(([sql]) => !sql.includes('app.upload_site_document'))).toBe(true)
  })
})
