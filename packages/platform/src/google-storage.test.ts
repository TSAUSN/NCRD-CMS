import { describe, expect, it, vi } from 'vitest'
import { createGoogleCloudMediaStore } from './google-storage.ts'
import { createMetadataAccessTokenProvider } from './google-access.ts'

const key = `media/original/${'a'.repeat(64)}.png`
const create = (fetcher: typeof fetch) =>
  createGoogleCloudMediaStore({ bucket: 'cms-private-media', accessToken: async () => 'workload-token', fetcher })

describe('Google private media storage', () => {
  it('uses create-only uploads and keeps provider authority out of the browser upload intent', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const store = create(fetcher)
    await store.put(key, new Uint8Array([1, 2]), 'image/png')
    expect(String(fetcher.mock.calls[0]![0])).toContain('ifGenerationMatch=0')
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer workload-token' },
    })
    const upload = await store.createSignedUpload({
      intentId: '11111111-1111-4111-8111-111111111111',
      uploadToken: 'intent-token',
      expiresAt: new Date(),
      maxBytes: 1024,
      allowedContentTypes: ['image/png'],
    })
    expect(upload.url).toMatch(/^\/api\/media\/uploads\//)
    expect(JSON.stringify(upload)).not.toMatch(/workload-token|googleapis|cms-private-media/)
  })
  it('accepts a concurrent identical put but refuses different bytes under an existing immutable key', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])))
    await expect(create(fetcher).put(key, new Uint8Array([1, 2]), 'image/png')).resolves.toMatchObject({ bytes: 2 })
    fetcher
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9])))
    await expect(create(fetcher).put(key, new Uint8Array([1, 2]), 'image/png')).rejects.toThrow('collision')
  })
  it('distinguishes absence from denied access, uses exact-key deletion and rejects traversal before access', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('private detail', { status: 403 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
    const store = create(fetcher)
    await expect(store.get(key)).resolves.toBeNull()
    await expect(store.get(key)).rejects.toThrow('HTTP 403')
    await store.remove(key)
    expect(String(fetcher.mock.calls[2]![0]).endsWith(encodeURIComponent(key))).toBe(true)
    expect(fetcher.mock.calls[2]![1]!.method).toBe('DELETE')
    for (const unsafe of ['../secret', '/absolute', 'x/%2fsecret'])
      await expect(store.get(unsafe)).rejects.toThrow('media-object-key-invalid')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})

it('shares metadata token refresh across callers, refreshes early, and retries failed retrieval without caching it', async () => {
  let now = 0
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: 'first', expires_in: 3600, token_type: 'Bearer' }))
    .mockRejectedValueOnce(new Error('network details'))
    .mockResolvedValueOnce(Response.json({ access_token: 'second', expires_in: 3600, token_type: 'Bearer' }))
  const token = createMetadataAccessTokenProvider(fetcher, () => now)
  expect(await Promise.all([token(), token()])).toEqual(['first', 'first'])
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { 'Metadata-Flavor': 'Google' } })
  now = 3_541_000
  await expect(token()).rejects.toThrow('identity is unavailable')
  await expect(token()).resolves.toBe('second')
})
