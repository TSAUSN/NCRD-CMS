import { createFilesystemMediaStore, defaultMediaRoot, isSafeObjectKey } from './local/index.ts'
import type { MediaStore } from './ports.ts'
import { createGoogleCloudMediaStore } from './google-storage.ts'

/** Private bucket only. Every browser operation still passes the CMS intent or
 * published-media authorization boundary; provider tokens/keys never leave it. */
export function createSupabaseMediaStore(options: {
  url: string
  key: string
  bucket: string
  fetcher?: typeof fetch
}): MediaStore {
  const origin = new URL(options.url)
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !options.key ||
    /\s/.test(options.key) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(options.bucket)
  ) {
    throw new Error('Configure an HTTPS STORAGE_SUPABASE_URL, STORAGE_SUPABASE_KEY and STORAGE_BUCKET')
  }
  const fetcher = options.fetcher ?? fetch
  const prefix = `${origin.origin}/storage/v1/object`
  const path = (key: string) => {
    if (!isSafeObjectKey(key)) throw new Error('media-object-key-invalid')
    return `${options.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  }
  const request = async (url: string, init: RequestInit = {}) => {
    try {
      return await fetcher(url, {
        ...init,
        headers: { apikey: options.key, Authorization: `Bearer ${options.key}`, ...init.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new Error('Storage provider is unavailable')
    }
  }
  const get = async (key: string): Promise<Uint8Array | null> => {
    const result = await request(`${prefix}/authenticated/${path(key)}`)
    if (result.status === 404) return null
    // Supabase also represents absent objects as 400 with a structured code.
    if (!result.ok) {
      const body = (await result.json().catch(() => null)) as { code?: string } | null
      if (result.status === 400 && body?.code === 'NoSuchKey') return null
      throw new Error(`Storage download returned HTTP ${result.status}`)
    }
    return new Uint8Array(await result.arrayBuffer())
  }
  return {
    // Reuse the existing intent-scoped application upload receiver. Supabase's
    // generic signed URL cannot enforce all of the CMS MIME/size constraints.
    createSignedUpload: createFilesystemMediaStore(defaultMediaRoot()).createSignedUpload,
    get,
    async put(key, bytes, contentType) {
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType)) throw new Error('media-content-type-invalid')
      const result = await request(`${prefix}/${path(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
        body: Buffer.from(bytes),
      })
      if (!result.ok) {
        const error = (await result.json().catch(() => null)) as { code?: string; error?: string } | null
        if (
          [400, 409].includes(result.status) &&
          (error?.code === 'KeyAlreadyExists' ||
            error?.code === 'ResourceAlreadyExists' ||
            error?.error === 'Duplicate')
        ) {
          const existing = await get(key)
          if (
            !existing ||
            existing.length !== bytes.length ||
            !existing.every((byte, index) => byte === bytes[index])
          ) {
            throw new Error('media-object-key-collision')
          }
        } else throw new Error(`Storage upload returned HTTP ${result.status}`)
      }
      return { objectKey: key, bytes: bytes.byteLength, contentType }
    },
    async remove(key) {
      path(key)
      const result = await request(`${prefix}/${options.bucket}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [key] }),
      })
      if (!result.ok && result.status !== 404) throw new Error(`Storage deletion returned HTTP ${result.status}`)
    },
  }
}

export function configuredMediaStore(env: Record<string, string | undefined> = process.env): MediaStore {
  if (env['MEDIA_PROVIDER'] === 'google') return createGoogleCloudMediaStore({ bucket: env['STORAGE_BUCKET'] ?? '' })
  if (env['MEDIA_PROVIDER'] === 'supabase')
    return createSupabaseMediaStore({
      url: env['STORAGE_SUPABASE_URL'] ?? '',
      key: env['STORAGE_SUPABASE_KEY'] ?? '',
      bucket: env['STORAGE_BUCKET'] ?? '',
    })
  if (
    (!env['MEDIA_PROVIDER'] || env['MEDIA_PROVIDER'] === 'filesystem') &&
    (env['NODE_ENV'] !== 'production' ||
      env['CMS_LOCAL_TEST_MODE'] === 'true' ||
      (env['MEDIA_PROVIDER'] === 'filesystem' && env['MEDIA_ROOT']?.startsWith('/')))
  ) {
    return createFilesystemMediaStore(env['MEDIA_ROOT'] || defaultMediaRoot())
  }
  // Do not throw at import/build time: route handlers construct dependencies at
  // module scope. Runtime requests fail closed instead of writing local files.
  const fail = async (): Promise<never> => {
    throw new Error('Production media storage is not configured')
  }
  return { createSignedUpload: fail, put: fail, get: fail, remove: fail }
}
