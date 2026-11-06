import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFilesystemMediaStore, isSafeObjectKey, sha256Hex } from './index.ts'

describe('filesystem media store', () => {
  it('issues an existing receiver shape without exposing an object key', async () => {
    const store = createFilesystemMediaStore(await mkdtemp(join(tmpdir(), 'cms-media-')), '/api/media')
    const expiresAt = new Date('2030-01-01T00:00:00Z')
    const upload = await store.createSignedUpload({
      intentId: '11111111-1111-4111-8111-111111111111',
      expiresAt,
      uploadToken: '22222222-2222-4222-8222-222222222222',
      maxBytes: 1024,
      allowedContentTypes: ['image/jpeg'],
    })
    expect(upload).toEqual({
      url: '/api/media/uploads/11111111-1111-4111-8111-111111111111',
      intentId: '11111111-1111-4111-8111-111111111111',
      expiresAt,
      headers: { 'x-cms-upload-token': '22222222-2222-4222-8222-222222222222' },
      maxBytes: 1024,
      allowedContentTypes: ['image/jpeg'],
    })
    expect(upload).not.toHaveProperty('objectKey')
  })

  it.each(['../secret', 'media/../../secret', '/absolute/file.jpg', 'media/..\\secret'])(
    'refuses traversal key %s',
    async key => {
      const store = createFilesystemMediaStore(await mkdtemp(join(tmpdir(), 'cms-media-')))
      expect(isSafeObjectKey(key)).toBe(false)
      await expect(store.put(key, new Uint8Array([1]), 'image/jpeg')).rejects.toThrow('media-object-key-invalid')
    },
  )

  it('allows an idempotent put and refuses replacement at an immutable key', async () => {
    const store = createFilesystemMediaStore(await mkdtemp(join(tmpdir(), 'cms-media-')))
    const key = `media/original/${'a'.repeat(64)}.jpg`
    await store.put(key, new Uint8Array([1, 2, 3]), 'image/jpeg')
    await expect(store.put(key, new Uint8Array([1, 2, 3]), 'image/jpeg')).resolves.toMatchObject({ bytes: 3 })
    await expect(store.put(key, new Uint8Array([3, 2, 1]), 'image/jpeg')).rejects.toThrow('media-object-key-collision')
  })

  it('returns the full digest used by media metadata', () => {
    expect(sha256Hex(new TextEncoder().encode('cms'))).toMatch(/^[a-f0-9]{64}$/)
  })
})
