import { describe, expect, it, vi } from 'vitest'
import type { MediaStore } from '@cms/platform'
import {
  createBeginMediaUploadHandler,
  createMediaUploadStatusHandler,
  createReceiveMediaUploadHandler,
  type AdminMediaUploadRepository,
  type BegunMediaUpload,
  type MediaReceipt,
} from '../../../lib/media-upload-handler.ts'

const SITE_ID = '11111111-1111-4111-8111-111111111111'
const INTENT_ID = '22222222-2222-4222-8222-222222222222'
const UPLOAD_TOKEN = '33333333-3333-4333-8333-333333333333'
const RECEIPT_TOKEN = '44444444-4444-4444-8444-444444444444'
const UPLOAD_KEY = `media-uploads/${INTENT_ID}/${'a'.repeat(64)}.upload`

const begun: BegunMediaUpload = {
  intentId: INTENT_ID,
  uploadToken: UPLOAD_TOKEN,
  uploadObjectKey: UPLOAD_KEY,
  finalKeyPrefix: `media/${SITE_ID}/`,
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  maxBytes: 1_000_000,
  allowedContentType: 'image/jpeg',
}

function receipt(overrides: Partial<MediaReceipt> = {}): MediaReceipt {
  return {
    intentId: INTENT_ID,
    receiptToken: RECEIPT_TOKEN,
    uploadObjectKey: UPLOAD_KEY,
    declaredBytes: 3,
    maxBytes: 1_000_000,
    allowedContentType: 'image/jpeg',
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    ...overrides,
  }
}

function repository(overrides: Partial<AdminMediaUploadRepository> = {}): AdminMediaUploadRepository {
  return {
    async begin() {
      return begun
    },
    async claimReceipt() {
      return receipt()
    },
    async markReceived() {},
    async failReceipt() {},
    ...overrides,
  }
}

function mediaStore(): MediaStore & { puts: { key: string; body: Uint8Array }[] } {
  const puts: { key: string; body: Uint8Array }[] = []
  return {
    puts,
    async createSignedUpload(input) {
      return {
        url: `/api/media/uploads/${input.intentId}`,
        intentId: input.intentId,
        headers: { 'x-cms-upload-token': input.uploadToken },
        expiresAt: input.expiresAt,
        maxBytes: input.maxBytes,
        allowedContentTypes: input.allowedContentTypes,
      }
    },
    async put(key, body, contentType) {
      puts.push({ key, body })
      return { objectKey: key, bytes: body.byteLength, contentType }
    },
    async get() {
      return null
    },
    async remove() {},
  }
}

function jsonRequest(body: Record<string, unknown>): Request {
  const encoded = JSON.stringify(body)
  return new Request('http://admin.test/api/sites/x/media/uploads', {
    method: 'POST',
    body: encoded,
    headers: {
      origin: 'http://admin.test',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(encoded)),
    },
  })
}

describe('POST media upload intent route', () => {
  it('uses the browser-facing Host authority behind the Next listener and rejects another origin', async () => {
    const handler = createBeginMediaUploadHandler({
      currentSession: async () => ({ userId: 'user-1' }),
      repository: repository(),
      media: mediaStore(),
    })
    const body = {
      originalName: 'photo.jpg',
      contentType: 'image/jpeg',
      bytes: 3,
      altText: 'A useful description',
      decorative: false,
    }
    const proxied = jsonRequest(body)
    proxied.headers.set('host', '127.0.0.1:3200')
    proxied.headers.set('origin', 'http://127.0.0.1:3200')
    expect((await handler(proxied, SITE_ID)).status).toBe(201)

    const crossOrigin = jsonRequest(body)
    crossOrigin.headers.set('host', 'admin.test')
    crossOrigin.headers.set('origin', 'https://attacker.test')
    expect((await handler(crossOrigin, SITE_ID)).status).toBe(403)
  })

  it('requires alt text or an explicit decorative decision with helpful copy', async () => {
    const begin = vi.fn()
    const response = await createBeginMediaUploadHandler({
      currentSession: async () => ({ userId: 'user-1' }),
      repository: repository({ begin }),
      media: mediaStore(),
    })(
      jsonRequest({
        originalName: 'photo.jpg',
        contentType: 'image/jpeg',
        bytes: 3,
        altText: '',
        decorative: false,
      }),
      SITE_ID,
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('mark it decorative')
    expect(begin).not.toHaveBeenCalled()
  })

  it('returns an opaque receiver capability and never an object key', async () => {
    const response = await createBeginMediaUploadHandler({
      currentSession: async () => ({ userId: 'user-1' }),
      repository: repository(),
      media: mediaStore(),
    })(
      jsonRequest({
        originalName: 'photo.jpg',
        contentType: 'image/jpeg',
        bytes: 3,
        altText: 'A useful description',
        decorative: false,
      }),
      SITE_ID,
    )
    expect(response.status).toBe(201)
    const text = await response.text()
    expect(text).toContain(`/api/media/uploads/${INTENT_ID}`)
    expect(text).toContain('x-cms-upload-token')
    expect(text).not.toContain(UPLOAD_KEY)
    expect(text).not.toContain('finalKeyPrefix')
  })

  it('turns database tenant refusal into a neutral not-found response', async () => {
    const response = await createBeginMediaUploadHandler({
      currentSession: async () => ({ userId: 'user-b' }),
      repository: repository({
        async begin() {
          throw Object.assign(new Error('not permitted'), { kind: 'not_authorized' })
        },
      }),
      media: mediaStore(),
    })(
      jsonRequest({
        originalName: 'photo.jpg',
        contentType: 'image/jpeg',
        bytes: 3,
        altText: 'A useful description',
        decorative: false,
      }),
      SITE_ID,
    )
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('not permitted')
  })
})

function uploadRequest(bytes: Uint8Array, headers: Record<string, string> = {}): Request {
  return new Request(`http://admin.test/api/media/uploads/${INTENT_ID}`, {
    method: 'PUT',
    body: bytes as unknown as BodyInit,
    // Node's Request extension is runtime-only; Uint8Array bodies are already
    // fully buffered here, while the production path remains a web stream.
    headers: {
      origin: 'http://admin.test',
      'content-type': 'image/jpeg',
      'content-length': String(bytes.byteLength),
      'x-cms-upload-token': UPLOAD_TOKEN,
      ...headers,
    },
  })
}

describe('PUT media upload receiver route', () => {
  it('rejects the global bound before claiming an intent or reading a body', async () => {
    const claimReceipt = vi.fn()
    const request = {
      url: `http://admin.test/api/media/uploads/${INTENT_ID}`,
      headers: new Headers({
        origin: 'http://admin.test',
        'content-type': 'image/jpeg',
        'content-length': '1001',
        'x-cms-upload-token': UPLOAD_TOKEN,
      }),
      get body(): never {
        throw new Error('body was touched')
      },
    } as unknown as Request
    const response = await createReceiveMediaUploadHandler({
      repository: repository({ claimReceipt }),
      media: mediaStore(),
      maxBytes: 1_000,
    })(request, INTENT_ID)
    expect(response.status).toBe(413)
    expect(claimReceipt).not.toHaveBeenCalled()
  })

  it('uses only server-recorded key/type/size and settles an intent once', async () => {
    const markReceived = vi.fn()
    const repo = repository({ markReceived })
    const media = mediaStore()
    const response = await createReceiveMediaUploadHandler({
      repository: repo,
      media,
      now: () => new Date('2029-01-01T00:00:00Z'),
    })(uploadRequest(new Uint8Array([0xff, 0xd8, 0xff])), INTENT_ID)
    expect(response.status).toBe(202)
    expect(media.puts).toEqual([{ key: UPLOAD_KEY, body: new Uint8Array([0xff, 0xd8, 0xff]) }])
    expect(markReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadObjectKey: UPLOAD_KEY,
        receiptToken: RECEIPT_TOKEN,
      }),
      'image/jpeg',
      3,
    )
    expect(await response.json()).toEqual({ intentId: INTENT_ID, status: 'processing' })
  })

  it('refuses mismatched recorded constraints before buffering and records the failed receipt', async () => {
    const failReceipt = vi.fn()
    const request = {
      url: `http://admin.test/api/media/uploads/${INTENT_ID}`,
      headers: new Headers({
        origin: 'http://admin.test',
        'content-type': 'image/png',
        'content-length': '4',
        'x-cms-upload-token': UPLOAD_TOKEN,
      }),
      get body(): never {
        throw new Error('body was touched')
      },
    } as unknown as Request
    const response = await createReceiveMediaUploadHandler({
      repository: repository({
        claimReceipt: async () => receipt({ declaredBytes: 4, allowedContentType: 'image/jpeg' }),
        failReceipt,
      }),
      media: mediaStore(),
      now: () => new Date('2029-01-01T00:00:00Z'),
    })(request, INTENT_ID)
    expect(response.status).toBe(415)
    expect(failReceipt).toHaveBeenCalledWith(expect.anything(), 'media_type_mismatch')
  })

  it('reveals nothing for an invalid or cross-tenant capability', async () => {
    const media = mediaStore()
    const response = await createReceiveMediaUploadHandler({
      repository: repository({ claimReceipt: async () => null }),
      media,
    })(uploadRequest(new Uint8Array([0xff, 0xd8, 0xff])), INTENT_ID)
    expect(response.status).toBe(404)
    expect(media.puts).toEqual([])
    expect(await response.text()).not.toContain(SITE_ID)
  })
})

describe('GET media upload intent status route', () => {
  it('returns the honest private intent state without caching it', async () => {
    const response = await createMediaUploadStatusHandler({
      currentSession: async () => ({ userId: 'user-1' }),
      repository: {
        async read(userId, intentId) {
          expect([userId, intentId]).toEqual(['user-1', INTENT_ID])
          return {
            intentId,
            status: 'processing',
            originalName: 'photo.jpg',
            failureCode: null,
            asset: null,
          }
        },
      },
    })(INTENT_ID)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      intentId: INTENT_ID,
      status: 'processing',
      originalName: 'photo.jpg',
      failureCode: null,
      asset: null,
    })
  })

  it('reveals nothing without a session or when the repository hides the intent', async () => {
    const read = vi.fn()
    const noSession = await createMediaUploadStatusHandler({
      currentSession: async () => null,
      repository: { read },
    })(INTENT_ID)
    expect(noSession.status).toBe(404)
    expect(read).not.toHaveBeenCalled()

    const hidden = await createMediaUploadStatusHandler({
      currentSession: async () => ({ userId: 'user-b' }),
      repository: {
        async read() {
          return null
        },
      },
    })(INTENT_ID)
    expect(hidden.status).toBe(404)
  })
})
