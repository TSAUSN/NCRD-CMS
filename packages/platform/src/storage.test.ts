import { describe, expect, it, vi } from 'vitest'
import { configuredMediaStore, createSupabaseMediaStore } from './storage.ts'
const key = `media/original/${'a'.repeat(64)}.png`
const create = (fetcher: typeof fetch) =>
  createSupabaseMediaStore({
    url: 'https://storage.example.org',
    key: 'server-secret',
    bucket: 'private-media',
    fetcher,
  })
describe('private Supabase storage contract', () => {
  it('sends immutable uploads and never exposes storage credentials in the browser capability', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const store = create(fetcher)
    await store.put(key, new Uint8Array([1, 2]), 'image/png')
    expect(fetcher).toHaveBeenCalledWith(
      `https://storage.example.org/storage/v1/object/private-media/${key}`,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({ 'x-upsert': 'false', Authorization: 'Bearer server-secret' }),
      }),
    )
    const upload = await store.createSignedUpload({
      intentId: '11111111-1111-4111-8111-111111111111',
      uploadToken: 'intent-token',
      expiresAt: new Date(),
      maxBytes: 1024,
      allowedContentTypes: ['image/png'],
    })
    expect(upload.url).toMatch(/^\/api\/media\/uploads\//)
    expect(JSON.stringify(upload)).not.toMatch(/server-secret|private-media|original/)
  })
  it('requires equal bytes after an already-existing response, including concurrent puts', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 'KeyAlreadyExists' }, { status: 409 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2])))
    await expect(create(fetcher).put(key, new Uint8Array([1, 2]), 'image/png')).resolves.toMatchObject({ bytes: 2 })
    fetcher
      .mockResolvedValueOnce(Response.json({ error: 'Duplicate' }, { status: 400 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9])))
    await expect(create(fetcher).put(key, new Uint8Array([1, 2]), 'image/png')).rejects.toThrow('collision')
  })
  it('treats only absent objects as missing, surfaces permission errors without leaking response bodies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 'NoSuchKey' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ message: 'secret' }, { status: 403 }))
    const store = create(fetcher)
    await expect(store.get(key)).resolves.toBeNull()
    await expect(store.get(key)).rejects.toThrow('HTTP 403')
    expect(fetcher.mock.calls[0]![0]).toContain('/object/authenticated/')
  })
  it('uses exact-key deletion and refuses traversal before any provider call', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const store = create(fetcher)
    await store.remove(key)
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ prefixes: [key] })
    for (const path of ['../secret', '/absolute', 'x/%2fsecret'])
      await expect(store.get(path)).rejects.toThrow('media-object-key-invalid')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('fails closed in production without a deliberate persistent provider', async () => {
    await expect(configuredMediaStore({ NODE_ENV: 'production' }).get(key)).rejects.toThrow('not configured')
    await expect(
      configuredMediaStore({ NODE_ENV: 'production', MEDIA_PROVIDER: 'filesystem' }).get(key),
    ).rejects.toThrow('not configured')
    expect(() => createSupabaseMediaStore({ url: 'http://bad.example.org', key: 'secret', bucket: 'media' })).toThrow(
      'HTTPS',
    )
  })
})
