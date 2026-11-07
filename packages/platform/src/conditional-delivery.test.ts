import { expect, it, vi } from 'vitest'
import { SITE_FONT_REGISTRY } from '@cms/schema'
import { deliverMediaObject, type ResolvedMediaObject } from './media.ts'
import type { MediaStore } from './ports.ts'
import { deliverSiteAsset, type ResolvedSiteAsset } from './site-assets.ts'
import { deliverReviewedSiteFile, type ResolvedSiteFile } from './site-files.ts'

const id = '11111111-1111-4111-a111-111111111111'
const site = '22222222-2222-4222-a222-222222222222'
const hash = 'b'.repeat(64)
const request = (etag: string) =>
  new Request('https://preview.example.test/file', { headers: { 'if-none-match': etag } })

it('checks publication before returning a public image validator without reading storage', async () => {
  const receipt: ResolvedMediaObject = {
    mediaId: id,
    variant: 'thumbnail',
    objectKey: 'test/image.webp',
    contentHash: hash,
    mimeType: 'image/webp',
    width: 1,
    height: 1,
    bytes: 3,
  }
  const get = vi.fn()
  const resolve = vi
    .fn<() => Promise<ResolvedMediaObject | null>>()
    .mockResolvedValueOnce(receipt)
    .mockResolvedValueOnce(null)
  const input = {
    mediaId: id,
    variant: receipt.variant,
    resolve,
    store: { get } as unknown as MediaStore,
    visibility: 'public' as const,
    request: request(`"sha256-${hash}"`),
  }
  const cached = await deliverMediaObject(input)
  expect(cached.status).toBe(304)
  expect(cached.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
  expect((await deliverMediaObject(input)).status).toBe(404)
  expect(resolve).toHaveBeenCalledTimes(2)
  expect(get).not.toHaveBeenCalled()
})

it('uses approved font receipts and still rejects a missing or invalid publication', async () => {
  const fontKey = 'trajan-regular'
  const font = SITE_FONT_REGISTRY[fontKey]
  const receipt: ResolvedSiteAsset = {
    id,
    kind: 'font',
    mime_type: font.mimeType,
    bytes: 1024,
    content_hash: font.sha256,
    font_key: fontKey,
    object_key: 'test/font',
    original_name: 'Fixture font',
  }
  const get = vi.fn(async () => null)
  const input = {
    assetId: id,
    store: { get } as unknown as MediaStore,
    visibility: 'public' as const,
    request: request(`"sha256-${font.sha256}"`),
  }
  expect((await deliverSiteAsset({ ...input, resolve: async () => receipt })).status).toBe(304)
  expect((await deliverSiteAsset({ ...input, resolve: async () => null })).status).toBe(404)
  expect(get).not.toHaveBeenCalled()
  const wrong = { ...receipt, mime_type: 'text/html' }
  expect((await deliverSiteAsset({ ...input, resolve: async () => wrong })).status).toBe(404)
})

it('uses the exact reviewed file receipt and never treats a foreign record as cached', async () => {
  const receipt: ResolvedSiteFile = {
    id,
    site_id: site,
    kind: 'script',
    name: 'site.js',
    source: 'local:js/site.js',
    sha256: hash,
    bytes: 1024,
    mime_type: 'text/javascript',
    object_key: `site-files/${site}/${id}/${hash}`,
  }
  const get = vi.fn()
  const input = {
    fileId: id,
    sha256: hash,
    name: receipt.name,
    store: { get } as unknown as MediaStore,
    visibility: 'public' as const,
    request: request(`"${hash}"`),
  }
  expect((await deliverReviewedSiteFile({ ...input, resolve: async () => receipt })).status).toBe(304)
  expect((await deliverReviewedSiteFile({ ...input, resolve: async () => ({ ...receipt, site_id: id }) })).status).toBe(
    404,
  )
  expect(get).not.toHaveBeenCalled()
})
