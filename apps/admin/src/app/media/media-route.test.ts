import { describe, expect, it, vi } from 'vitest'
import type { MediaStore, ResolvedMediaObject } from '@cms/platform'
import { createAdminMediaGetHandler, type AdminMediaDeliveryRepository } from '../../lib/media-delivery-handler.ts'

const MEDIA_ID = '11111111-1111-4111-8111-111111111111'
const HASH = 'b'.repeat(64)
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

function mediaStore(get = vi.fn(async () => new Uint8Array([1, 2, 3]))): MediaStore {
  return {
    async createSignedUpload() {
      throw new Error('not used')
    },
    async put(key, body, contentType) {
      return { objectKey: key, bytes: body.byteLength, contentType }
    },
    get,
    async remove() {},
  }
}

describe('admin media preview route', () => {
  it('re-checks the current session and tenant resolver on every request', async () => {
    const currentSession = vi.fn(async () => ({ userId: 'user-a' }))
    const resolve = vi.fn(async () => object)
    const handler = createAdminMediaGetHandler({
      currentSession,
      repository: { resolve },
      media: mediaStore(),
    })
    const response = await handler(MEDIA_ID, 'card')
    expect(response.status).toBe(200)
    expect(currentSession).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith('user-a', MEDIA_ID, 'card')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('does not read storage when RLS hides cross-tenant media', async () => {
    const get = vi.fn()
    const repository: AdminMediaDeliveryRepository = {
      async resolve() {
        return null
      },
    }
    const response = await createAdminMediaGetHandler({
      currentSession: async () => ({ userId: 'user-b' }),
      repository,
      media: mediaStore(get),
    })(MEDIA_ID, 'original')
    expect(response.status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })

  it('rejects traversal/arbitrary variants before session, database, or storage work', async () => {
    const currentSession = vi.fn()
    const resolve = vi.fn()
    const get = vi.fn()
    const response = await createAdminMediaGetHandler({
      currentSession,
      repository: { resolve },
      media: mediaStore(get),
    })(MEDIA_ID, '../../secret')
    expect(response.status).toBe(404)
    expect(currentSession).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('fails closed when the resolver identity does not match the stable URL', async () => {
    const repository: AdminMediaDeliveryRepository = {
      async resolve() {
        return { ...object, variant: 'wide' }
      },
    }
    const response = await createAdminMediaGetHandler({
      currentSession: async () => ({ userId: 'user-a' }),
      repository,
      media: mediaStore(),
    })(MEDIA_ID, 'card')
    expect(response.status).toBe(404)
  })
})
