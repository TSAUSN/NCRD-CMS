import { describe, expect, it, vi } from 'vitest'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import {
  createDeleteMediaHandler,
  createRestoreMediaHandler,
  type MediaMutationRepository,
} from '../../../../lib/media-mutation-handler.ts'

const MEDIA_ID = '11111111-1111-4111-8111-111111111111'
const asset: MediaAsset = {
  id: MEDIA_ID,
  revision: 3,
  siteId: '22222222-2222-4222-8222-222222222222',
  scope: 'site',
  name: 'photo.jpg',
  altText: 'A photo',
  decorative: false,
  focal: null,
  width: 1200,
  height: 800,
  bytes: 1234,
  mimeType: 'image/jpeg',
  status: 'deleted',
  folder: '',
  attribution: '',
  source: '',
  tags: [],
  variants: { original: true, thumbnail: true, card: true, wide: true },
  previewUrl: `/media/${MEDIA_ID}/thumbnail`,
  deliveryUrl: `/media/${MEDIA_ID}/wide`,
  usedOnItems: 0,
  usedInVersions: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: '2026-02-01T00:00:00.000Z',
}

function request(method: string, body: Record<string, unknown>): Request {
  const encoded = JSON.stringify(body)
  return new Request(`http://admin.test/api/media/assets/${MEDIA_ID}`, {
    method,
    body: encoded,
    headers: {
      origin: 'http://admin.test',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(encoded)),
    },
  })
}

function repository(overrides: Partial<MediaMutationRepository> = {}): MediaMutationRepository {
  return {
    async softDelete() {
      return asset
    },
    async restore() {
      return { ...asset, revision: 4, status: 'ready', deletedAt: null }
    },
    async updateMetadata() {
      throw new Error('updateMetadata was not expected in this test')
    },
    async bulkOrganize() {
      throw new Error('bulkOrganize was not expected in this test')
    },
    async bulkDelete() {
      throw new Error('bulkDelete was not expected in this test')
    },
    ...overrides,
  }
}

describe('media delete route', () => {
  it('passes the expected revision and explicit broken-reference decision to the command', async () => {
    const softDelete = vi.fn(async () => asset)
    const response = await createDeleteMediaHandler({
      currentSession: async () => ({ userId: 'user-a' }),
      repository: repository({ softDelete }),
    })(
      request('DELETE', {
        expectedRevision: 2,
        breakReferences: true,
        reason: 'Approved replacement is already published.',
      }),
      MEDIA_ID,
    )
    expect(response.status).toBe(200)
    expect(softDelete).toHaveBeenCalledWith('user-a', MEDIA_ID, {
      expectedRevision: 2,
      breakReferences: true,
      reason: 'Approved replacement is already published.',
    })
    expect((await response.json()).asset.status).toBe('deleted')
  })

  it('requires an auditable reason before intentionally breaking references', async () => {
    const softDelete = vi.fn()
    const response = await createDeleteMediaHandler({
      currentSession: async () => ({ userId: 'user-a' }),
      repository: repository({ softDelete }),
    })(request('DELETE', { expectedRevision: 2, breakReferences: true, reason: 'short' }), MEDIA_ID)
    expect(response.status).toBe(400)
    expect(softDelete).not.toHaveBeenCalled()
  })

  it('hides cross-tenant/unauthorized media', async () => {
    const response = await createDeleteMediaHandler({
      currentSession: async () => ({ userId: 'user-b' }),
      repository: repository({
        async softDelete() {
          throw Object.assign(new Error('site A only'), { kind: 'not_authorized' })
        },
      }),
    })(request('DELETE', { expectedRevision: 2, breakReferences: false, reason: null }), MEDIA_ID)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('site A')
  })

  it('returns a conflict for a stale revision instead of overwriting', async () => {
    const response = await createDeleteMediaHandler({
      currentSession: async () => ({ userId: 'user-a' }),
      repository: repository({
        async softDelete() {
          throw Object.assign(new Error('stale'), { kind: 'stale_revision' })
        },
      }),
    })(request('DELETE', { expectedRevision: 2, breakReferences: false, reason: null }), MEDIA_ID)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('Refresh')
  })
})

describe('media restore route', () => {
  it('restores only the revision the user reviewed', async () => {
    const restore = vi.fn(async () => ({ ...asset, revision: 4, status: 'ready' as const, deletedAt: null }))
    const response = await createRestoreMediaHandler({
      currentSession: async () => ({ userId: 'user-a' }),
      repository: repository({ restore }),
    })(request('POST', { expectedRevision: 3 }), MEDIA_ID)
    expect(response.status).toBe(200)
    expect(restore).toHaveBeenCalledWith('user-a', MEDIA_ID, 3)
    expect((await response.json()).asset.status).toBe('ready')
  })

  it('fails closed without a session', async () => {
    const restore = vi.fn()
    const response = await createRestoreMediaHandler({
      currentSession: async () => null,
      repository: repository({ restore }),
    })(request('POST', { expectedRevision: 3 }), MEDIA_ID)
    expect(response.status).toBe(404)
    expect(restore).not.toHaveBeenCalled()
  })
})
