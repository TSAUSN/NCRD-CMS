import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { MediaStore, ResolvedMediaObject } from '@cms/platform'
import { createPublicMediaGetHandler, type PublicMediaDeliveryRepository } from '../../lib/media-delivery-handler.ts'

const MEDIA_ID = '11111111-1111-4111-8111-111111111111'
const HASH = createHash('sha256')
  .update(new Uint8Array([1, 2, 3]))
  .digest('hex')
const object: ResolvedMediaObject = {
  mediaId: MEDIA_ID,
  variant: 'card',
  objectKey: `media/objects/site/${MEDIA_ID}/variants/card/${HASH}.webp`,
  mimeType: 'image/webp',
  bytes: 3,
  width: 300,
  height: 200,
  contentHash: HASH,
}

function mediaStore(): MediaStore {
  return {
    async createSignedUpload() {
      throw new Error('not used')
    },
    async put(key, body, contentType) {
      return { objectKey: key, bytes: body.byteLength, contentType }
    },
    async get(key) {
      return key === object.objectKey ? new Uint8Array([1, 2, 3]) : null
    },
    async remove() {},
  }
}

function repository(result: ResolvedMediaObject | null = object): PublicMediaDeliveryRepository {
  return {
    async resolve() {
      return result
    },
  }
}

describe('public media route', () => {
  it('serves only a governed variant through the normalized host resolver', async () => {
    const resolve = vi.fn(async () => object)
    const response = await createPublicMediaGetHandler({
      resolveSite: async () => ({ host: 'tenant.example', siteId: 'site-a' }),
      repository: { resolve },
      media: mediaStore(),
    })(new Request('https://tenant.example/media/x/card'), MEDIA_ID, 'card')
    expect(response.status).toBe(200)
    expect(resolve).toHaveBeenCalledWith('tenant.example', MEDIA_ID, 'card')
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('etag')).toBe(`"sha256-${HASH}"`)
  })

  it('revalidates a cached image only while its current published reference still permits delivery', async () => {
    let live = true
    const get = vi.fn(mediaStore().get)
    const handler = createPublicMediaGetHandler({
      resolveSite: async () => ({ host: 'tenant.example', siteId: 'site-a' }),
      repository: { resolve: async () => (live ? object : null) },
      media: { ...mediaStore(), get },
    })
    const request = () =>
      new Request('https://tenant.example/media/x/card', { headers: { 'if-none-match': `"sha256-${HASH}"` } })
    expect((await handler(request(), MEDIA_ID, 'card')).status).toBe(304)
    live = false
    get.mockClear()
    const response = await handler(request(), MEDIA_ID, 'card')
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(get).not.toHaveBeenCalled()
  })

  it('fails neutral for an unknown host before querying media', async () => {
    const resolve = vi.fn()
    const response = await createPublicMediaGetHandler({
      resolveSite: async () => null,
      repository: { resolve },
      media: mediaStore(),
    })(new Request('https://unknown.example/media/x/card'), MEDIA_ID, 'card')
    expect(response.status).toBe(404)
    expect(resolve).not.toHaveBeenCalled()
    expect(await response.text()).toBe('')
  })

  it('does not reveal a media UUID owned by another host', async () => {
    const response = await createPublicMediaGetHandler({
      resolveSite: async () => ({ host: 'tenant-b.example', siteId: 'site-b' }),
      repository: repository(null),
      media: mediaStore(),
    })(new Request('https://tenant-b.example/media/x/card'), MEDIA_ID, 'card')
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain(MEDIA_ID)
  })

  it.each(['../../original', 'raw-key', 'card/webp'])(
    'refuses arbitrary or traversing variant %s without a store read',
    async variant => {
      const resolve = vi.fn()
      const get = vi.fn()
      const store = { ...mediaStore(), get }
      const response = await createPublicMediaGetHandler({
        resolveSite: async () => ({ host: 'tenant.example', siteId: 'site-a' }),
        repository: { resolve },
        media: store,
      })(new Request('https://tenant.example/media/x'), MEDIA_ID, variant)
      expect(response.status).toBe(404)
      expect(resolve).not.toHaveBeenCalled()
      expect(get).not.toHaveBeenCalled()
    },
  )

  it('rejects a resolver result whose identity or variant does not match the URL', async () => {
    const response = await createPublicMediaGetHandler({
      resolveSite: async () => ({ host: 'tenant.example', siteId: 'site-a' }),
      repository: repository({ ...object, mediaId: '22222222-2222-4222-8222-222222222222' }),
      media: mediaStore(),
    })(new Request('https://tenant.example/media/x/card'), MEDIA_ID, 'card')
    expect(response.status).toBe(404)
  })
  it('resolves a reviewed original identity before delivery without accepting arbitrary targets', async () => {
    const original = '33333333-3333-4333-8333-333333333333',
      resolve = vi.fn(async () => object),
      native = vi.fn(async () => ({ kind: 'media', mediaId: MEDIA_ID, variant: 'card' }))
    const handle = createPublicMediaGetHandler({
      resolveSite: async () => ({ host: 'tenant.example', siteId: 'site-a' }),
      repository: { resolve, native },
      media: mediaStore(),
    })
    const response = await handle(new Request('https://tenant.example/media/' + original + '/card'), original, 'card')
    expect(response.status).toBe(200)
    expect(native).toHaveBeenCalledWith('tenant.example', '/media/' + original + '/card')
    expect(resolve).toHaveBeenCalledWith('tenant.example', MEDIA_ID, 'card')
    native.mockResolvedValueOnce({ kind: 'media', mediaId: MEDIA_ID, variant: 'wide' })
    resolve.mockClear()
    expect((await handle(new Request('https://tenant.example/'), original, 'card')).status).toBe(404)
    expect(resolve).not.toHaveBeenCalled()
  })
  it('refuses same-length altered bytes, including cached and HEAD requests', async () => {
    const get = vi.fn(async () => new Uint8Array([3, 2, 1]))
    const handle = createPublicMediaGetHandler({
      resolveSite: async () => ({ host: 'tenant.example', siteId: 'site-a' }),
      repository: repository(),
      media: { ...mediaStore(), get },
    })
    // A matching validator returns no new bytes. An ordinary or mismatched
    // request still rejects corruption, even for HEAD.
    for (const method of ['GET', 'HEAD']) {
      const cached = await handle(
        new Request('https://tenant.example/', { method, headers: { 'if-none-match': '"sha256-' + HASH + '"' } }),
        MEDIA_ID,
        'card',
      )
      expect(cached.status).toBe(304)
      expect(cached.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
      expect(cached.body).toBeNull()
    }
    expect(get).not.toHaveBeenCalled()
    for (const method of ['GET', 'HEAD']) {
      const response = await handle(
        new Request('https://tenant.example/', { method, headers: { 'if-none-match': '"different"' } }),
        MEDIA_ID,
        'card',
      )
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(get).toHaveBeenCalledTimes(2)
  })
})
