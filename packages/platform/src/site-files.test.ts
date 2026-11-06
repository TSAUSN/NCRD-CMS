import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import {
  deliverReviewedSiteFile,
  deliverReviewedSiteFileAtPath,
  inspectReviewedSiteFile,
  registerReviewedSiteFile,
  siteFileUrl,
  type ResolvedSiteFile,
} from './site-files.ts'
import type { MediaStore } from './ports.ts'
import type { Queryable } from './publication.ts'
const id = '11111111-1111-4111-a111-111111111111',
  site = '22222222-2222-4222-a222-222222222222'
const bytes = Buffer.from('document.documentElement.dataset.approved="yes";')
const hash = createHash('sha256').update(bytes).digest('hex')
const receipt: ResolvedSiteFile = {
  id,
  site_id: site,
  kind: 'script',
  name: 'site.js',
  source: 'local:js/site.js',
  sha256: hash,
  bytes: bytes.length,
  mime_type: 'text/javascript',
  object_key: `site-files/${site}/${id}/${hash}`,
}
const store = { get: async () => bytes } as unknown as MediaStore
const deliver = (
  file: ResolvedSiteFile | null = receipt,
  overrides: Partial<Parameters<typeof deliverReviewedSiteFile>[0]> = {},
) =>
  deliverReviewedSiteFile({
    fileId: id,
    sha256: hash,
    name: 'site.js',
    store,
    resolve: async () => file,
    visibility: 'public',
    ...overrides,
  })
describe('reviewed site files', () => {
  it('serves only exact approved bytes with an immutable hash address and conservative headers', async () => {
    const response = await deliver()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(bytes.toString())
    expect(response.headers.get('content-type')).toBe('text/javascript')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toContain('must-revalidate')
    expect(siteFileUrl(receipt)).toBe(`/site-files/${id}/${hash}/site.js`)
  })
  it('refuses unapproved, foreign-site, changed, missing, renamed and wrongly typed files', async () => {
    for (const file of [
      null,
      { ...receipt, id: site },
      { ...receipt, site_id: id },
      { ...receipt, sha256: 'a'.repeat(64) },
      { ...receipt, name: 'other.js' },
      { ...receipt, mime_type: 'text/html' },
      { ...receipt, bytes: 1 },
    ])
      expect((await deliver(file)).status).toBe(404)
    expect(
      (await deliver(receipt, { store: { get: async () => Buffer.from('changed') } as unknown as MediaStore })).status,
    ).toBe(404)
    expect((await deliver(receipt, { store: { get: async () => null } as unknown as MediaStore })).status).toBe(404)
    expect((await deliver(receipt, { name: '../site.js' })).status).toBe(404)
  })
  it('delivers an approved original path through the same receipt and changed-byte verification', async () => {
    const resolve = vi.fn(async () => receipt),
      get = vi.fn(async () => bytes),
      input = {
        path: '/js/original.js',
        store: { get } as unknown as MediaStore,
        resolve,
        visibility: 'public' as const,
      }
    const response = await deliverReviewedSiteFileAtPath(input)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(bytes.toString())
    expect(resolve).toHaveBeenCalledWith('/js/original.js')
    expect(get).toHaveBeenCalledWith(receipt.object_key)
    expect(response.headers.get('cache-control')).toContain('must-revalidate')
    expect((await deliverReviewedSiteFileAtPath({ ...input, resolve: async () => null })).status).toBe(404)
    expect(
      (
        await deliverReviewedSiteFileAtPath({
          ...input,
          store: { get: async () => Buffer.from('changed') } as unknown as MediaStore,
        })
      ).status,
    ).toBe(404)
    get.mockClear()
    resolve.mockClear()
    for (const path of ['/api/private.js', 'https://foreign.test/file.js', '/js/../file.js', '/index.html'])
      expect((await deliverReviewedSiteFileAtPath({ ...input, path })).status).toBe(404)
    expect(resolve).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
  it('rejects disguised HTML, invalid text/data/fonts, executable SVG and external stylesheet imports', () => {
    for (const [value, kind, name] of [
      ['<script>alert(1)</script>', 'script', 'bad.js'],
      ['ok\0bad', 'script', 'bad.js'],
      ['@import "https://example.test/a.css";', 'stylesheet', 'bad.css'],
      ['{}x', 'data', 'bad.json'],
      ['not a font', 'font', 'bad.woff2'],
      ['<svg onload="bad()"></svg>', 'image', 'bad.svg'],
    ] as const)
      expect(() => inspectReviewedSiteFile(Buffer.from(value), kind, name)).toThrow()
    expect(
      inspectReviewedSiteFile(Buffer.from('@keyframes turn{to{transform:rotate(1turn)}}'), 'stylesheet', 'motion.css')
        .mimeType,
    ).toBe('text/css')
    expect(inspectReviewedSiteFile(Buffer.from('[{"title":"Workshop"}]'), 'data', 'items.json').mimeType).toBe(
      'application/json',
    )
  })
  it('refuses an unavailable site before creating any stored object', async () => {
    const put = vi.fn(),
      query = vi.fn(async () => ({ rows: [{ allowed: true, available: false }] }))
    await expect(
      registerReviewedSiteFile({
        client: { query } as unknown as Queryable,
        store: { put, get: async () => bytes } as unknown as MediaStore,
        siteId: site,
        kind: 'script',
        name: 'site.js',
        source: 'local:site.js',
        bytes,
      }),
    ).rejects.toThrow('site is unavailable')
    expect(put).not.toHaveBeenCalled()
  })
  it('checks the Super Admin before any storage write and validates exact readback before registering metadata', async () => {
    const put = vi.fn(),
      query = vi.fn(async (_sql: string, _args?: unknown[]) => ({ rows: [{ allowed: false, available: true }] }))
    const input = {
      client: { query } as unknown as Queryable,
      store: { put, get: async () => bytes } as unknown as MediaStore,
      siteId: site,
      kind: 'script' as const,
      name: 'site.js',
      source: 'local:js/site.js',
      bytes,
    }
    await expect(registerReviewedSiteFile(input)).rejects.toThrow('Super Admin')
    expect(put).not.toHaveBeenCalled()
    query.mockResolvedValue({ rows: [{ allowed: true, available: true }] })
    await expect(
      registerReviewedSiteFile({
        ...input,
        store: { put, get: async () => Buffer.from('changed') } as unknown as MediaStore,
      }),
    ).rejects.toThrow('Stored bytes differ')
    expect(query).toHaveBeenCalledTimes(2)
    const saved = await registerReviewedSiteFile(input)
    expect(saved.sha256).toBe(hash)
    expect(query.mock.calls.at(-1)?.[0]).toBe('SELECT app.register_site_file($1,$2,$3,$4,$5,$6,$7,$8)')
  })
})
