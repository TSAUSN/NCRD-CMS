import { createFilesystemMediaStore, defaultMediaRoot, isSafeObjectKey } from './local/index.ts'
import { createMetadataAccessTokenProvider, type GoogleAccessToken } from './google-access.ts'
import type { MediaStore } from './ports.ts'

export function createGoogleCloudMediaStore(options: {
  bucket: string
  accessToken?: GoogleAccessToken
  fetcher?: typeof fetch
}): MediaStore {
  if (!/^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]$/.test(options.bucket))
    throw new Error('Configure the private Google storage bucket')
  const fetcher = options.fetcher ?? fetch
  const accessToken = options.accessToken ?? createMetadataAccessTokenProvider()
  const objectPath = (key: string) => {
    if (!isSafeObjectKey(key)) throw new Error('media-object-key-invalid')
    return `https://storage.googleapis.com/storage/v1/b/${options.bucket}/o/${encodeURIComponent(key)}`
  }
  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await accessToken()
    try {
      return await fetcher(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new Error('Google storage is unavailable')
    }
  }
  async function get(key: string): Promise<Uint8Array | null> {
    const response = await request(`${objectPath(key)}?alt=media`)
    if (response.status === 404) {
      await response.body?.cancel()
      return null
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Storage download returned HTTP ${response.status}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }
  return {
    createSignedUpload: createFilesystemMediaStore(defaultMediaRoot()).createSignedUpload,
    get,
    async put(key, bytes, contentType) {
      objectPath(key)
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType)) throw new Error('media-content-type-invalid')
      const response = await request(
        `https://storage.googleapis.com/upload/storage/v1/b/${options.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}&ifGenerationMatch=0`,
        {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: Buffer.from(bytes),
        },
      )
      if (response.status === 412) {
        await response.body?.cancel()
        const existing = await get(key)
        if (!existing || existing.length !== bytes.length || !existing.every((byte, index) => byte === bytes[index])) {
          throw new Error('media-object-key-collision')
        }
      } else if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Storage upload returned HTTP ${response.status}`)
      } else await response.body?.cancel()
      return { objectKey: key, bytes: bytes.byteLength, contentType }
    },
    async remove(key) {
      const response = await request(objectPath(key), { method: 'DELETE' })
      await response.body?.cancel()
      if (!response.ok && response.status !== 404) throw new Error(`Storage deletion returned HTTP ${response.status}`)
    },
  }
}
