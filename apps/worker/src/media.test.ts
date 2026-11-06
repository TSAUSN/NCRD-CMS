import sharp from 'sharp'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { sha256Hex, type MediaStore } from '@cms/platform'
import { PermanentJobError, defaultHandlers, type OutboxEvent } from './handlers.ts'
import {
  DEFAULT_MEDIA_LIMITS,
  MEDIA_DELETED_EVENT,
  MEDIA_PROCESS_EVENT,
  MEDIA_READY_EVENT,
  MEDIA_RESTORED_EVENT,
  MEDIA_VARIANTS,
  MediaValidationError,
  mediaProcessingHandler,
  processMediaBytes,
  type MediaForInspection,
  type MediaProcessingRepository,
  type ProcessedMediaMetadata,
} from './media.ts'
import { MEDIA_CLEANUP_EVENT, mediaCleanupHandler, type MediaCleanupRepository } from './media-cleanup.ts'

const INTENT_ID = '11111111-1111-4111-8111-111111111111'
const SITE_ID = '22222222-2222-4222-8222-222222222222'

function intent(overrides: Partial<MediaForInspection> = {}): MediaForInspection {
  return {
    intentId: INTENT_ID,
    siteId: SITE_ID,
    uploadObjectKey: `media-uploads/${INTENT_ID}/${'a'.repeat(64)}.upload`,
    finalKeyPrefix: `media/${SITE_ID}/`,
    declaredMime: 'image/jpeg',
    declaredBytes: 0,
    ...overrides,
  }
}

async function jpeg(width = 1200, height = 800): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 52, g: 96, b: 140 } },
    })
      .jpeg({ quality: 95 })
      .toBuffer(),
  )
}

async function png(width = 10, height = 10): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
    })
      .png()
      .toBuffer(),
  )
}

describe('media byte inspection', () => {
  it('refuses spoofed MIME even when both types are individually allowed', async () => {
    const bytes = await png()
    await expect(processMediaBytes(intent({ declaredBytes: bytes.byteLength }), bytes)).rejects.toMatchObject({
      code: 'media_mime_mismatch',
    })
  })

  it('refuses SVG and non-image content before decoding', async () => {
    for (const source of ['<svg><script>alert(1)</script></svg>', '<html>not an image</html>']) {
      const bytes = new TextEncoder().encode(source)
      await expect(processMediaBytes(intent({ declaredBytes: bytes.byteLength }), bytes)).rejects.toBeInstanceOf(
        MediaValidationError,
      )
    }
  })

  it('enforces compressed-byte and decoded-pixel boundaries', async () => {
    const atBoundary = await png(100, 100)
    const limits = { ...DEFAULT_MEDIA_LIMITS, maxInputBytes: atBoundary.byteLength, maxInputPixels: 10_000 }
    await expect(
      processMediaBytes(
        intent({
          declaredMime: 'image/png',
          declaredBytes: atBoundary.byteLength,
        }),
        atBoundary,
        limits,
      ),
    ).resolves.toBeDefined()

    await expect(
      processMediaBytes(intent({ declaredBytes: atBoundary.byteLength }), atBoundary, {
        ...limits,
        maxInputBytes: atBoundary.byteLength - 1,
      }),
    ).rejects.toMatchObject({ code: 'media_input_too_large' })

    const pixelBomb = await png(101, 100)
    await expect(
      processMediaBytes(
        intent({
          declaredMime: 'image/png',
          declaredBytes: pixelBomb.byteLength,
        }),
        pixelBomb,
        limits,
      ),
    ).rejects.toMatchObject({ code: 'media_decode_failed' })
  })

  it('normalizes orientation/metadata and records exact variant dimensions, bytes, and hashes', async () => {
    const bytes = new Uint8Array(
      await sharp({
        create: { width: 1200, height: 800, channels: 3, background: '#725193' },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    )
    const processed = await processMediaBytes(intent({ declaredBytes: bytes.byteLength }), bytes)
    const originalMetadata = await sharp(processed.original.data).metadata()
    expect([processed.original.width, processed.original.height]).toEqual([800, 1200])
    expect(originalMetadata.orientation).toBeUndefined()
    expect(originalMetadata.exif).toBeUndefined()
    expect(processed.original.bytes).toBe(processed.original.data.byteLength)
    expect(processed.original.sha256).toBe(sha256Hex(processed.original.data))

    expect(processed.variants.map(variant => variant.kind)).toEqual(Object.keys(MEDIA_VARIANTS))
    for (const variant of processed.variants) {
      const metadata = await sharp(variant.data).metadata()
      expect([variant.width, variant.height]).toEqual([metadata.width, metadata.height])
      expect(variant.bytes).toBe(variant.data.byteLength)
      expect(variant.sha256).toBe(sha256Hex(variant.data))
      expect(variant.objectKey).toContain(`/variants/${variant.kind}/${variant.sha256}.webp`)
    }
    expect(processed.variants.find(variant => variant.kind === 'card')!.bytes).toBeLessThanOrEqual(200 * 1024)
  })

  it('turns a 4MB+ photograph into a card no larger than 200KB', async () => {
    const width = 2_200
    const height = 1_600
    const bytes = new Uint8Array(
      await sharp(randomBytes(width * height * 3), {
        raw: { width, height, channels: 3 },
      })
        .jpeg({ quality: 100 })
        .toBuffer(),
    )
    expect(bytes.byteLength).toBeGreaterThan(4 * 1024 * 1024)
    const processed = await processMediaBytes(intent({ declaredBytes: bytes.byteLength }), bytes)
    expect(processed.variants.find(variant => variant.kind === 'card')!.bytes).toBeLessThanOrEqual(200 * 1024)
    // This intentionally high-entropy fixture may require several WebP passes.
    // The contract here is output size, not a five-second hardware benchmark.
  }, 30_000)

  it('refuses a traversing database key prefix before storing', async () => {
    const bytes = await jpeg()
    await expect(
      processMediaBytes(
        intent({
          declaredBytes: bytes.byteLength,
          finalKeyPrefix: '../../escape/',
        }),
        bytes,
      ),
    ).rejects.toMatchObject({ code: 'media_final_key_invalid' })
  })
})

function memoryMedia(
  sourceKey: string,
  source: Uint8Array,
): MediaStore & {
  objects: Map<string, Uint8Array>
  gets: string[]
} {
  const objects = new Map([[sourceKey, source]])
  const gets: string[] = []
  return {
    objects,
    gets,
    async createSignedUpload() {
      throw new Error('not used')
    },
    async get(key) {
      gets.push(key)
      return objects.get(key) ?? null
    },
    async put(key, body, contentType) {
      const existing = objects.get(key)
      if (existing && sha256Hex(existing) !== sha256Hex(body)) throw new Error('collision')
      objects.set(key, body)
      return { objectKey: key, bytes: body.byteLength, contentType }
    },
    async remove(key) {
      objects.delete(key)
    },
  }
}

function event(): OutboxEvent {
  return {
    id: '77',
    site_id: SITE_ID,
    event_type: MEDIA_PROCESS_EVENT,
    payload: { intent_id: INTENT_ID },
    attempts: 1,
    lease_token: 'lease',
  }
}

describe('media processing delivery', () => {
  it('is durably idempotent before touching storage on redelivery', async () => {
    const bytes = await jpeg()
    const pending = intent({ declaredBytes: bytes.byteLength })
    let ready = false
    const finalized: ProcessedMediaMetadata[] = []
    const repository: MediaProcessingRepository = {
      async forInspection() {
        return ready ? null : pending
      },
      async finalize(_intent, processed) {
        finalized.push(processed)
        ready = true
      },
      async fail() {
        throw new Error('unexpected')
      },
    }
    const media = memoryMedia(pending.uploadObjectKey, bytes)
    const handler = mediaProcessingHandler({ repository, media })
    await handler.handle(event())
    await handler.handle(event())

    expect(finalized).toHaveLength(1)
    expect(media.gets).toEqual([pending.uploadObjectKey])
    expect(finalized[0]!.variants).toHaveLength(3)
    expect(finalized[0]!.variants[0]).not.toHaveProperty('data')
  })

  it('records a stable failure code and makes invalid input permanent', async () => {
    const bytes = new TextEncoder().encode('<svg onload="alert(1)"/>')
    const pending = intent({ declaredBytes: bytes.byteLength })
    const failures: string[] = []
    const repository: MediaProcessingRepository = {
      async forInspection() {
        return pending
      },
      async finalize() {
        throw new Error('unexpected')
      },
      async fail(_intent, code) {
        failures.push(code)
      },
    }
    await expect(
      mediaProcessingHandler({
        repository,
        media: memoryMedia(pending.uploadObjectKey, bytes),
      }).handle(event()),
    ).rejects.toBeInstanceOf(PermanentJobError)
    expect(failures).toEqual(['media_svg_refused'])
  })

  it('registers a retrying media handler even in a drain process without sharp wiring', async () => {
    const handlers = defaultHandlers({ async invalidate() {} })
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        MEDIA_PROCESS_EVENT,
        MEDIA_READY_EVENT,
        MEDIA_DELETED_EVENT,
        MEDIA_RESTORED_EVENT,
        MEDIA_CLEANUP_EVENT,
      ]),
    )
    const handler = handlers.get(MEDIA_PROCESS_EVENT)!
    expect(handler.idempotency).toBe('guarded')
    await expect(handler.handle(event())).rejects.toThrow('media-processor-unconfigured')
    await expect(
      handlers.get(MEDIA_CLEANUP_EVENT)!.handle({
        ...event(),
        event_type: MEDIA_CLEANUP_EVENT,
      }),
    ).rejects.toThrow('media-cleanup-unconfigured')
  })

  it.each([MEDIA_READY_EVENT, MEDIA_DELETED_EVENT, MEDIA_RESTORED_EVENT])(
    'invalidates every stable UUID route for %s',
    async eventType => {
      const calls: unknown[] = []
      const handler = defaultHandlers({
        async invalidate(input) {
          calls.push(input)
        },
      }).get(eventType)!
      await handler.handle({ ...event(), event_type: eventType, payload: { media_id: INTENT_ID, revision: 4 } })
      expect(calls).toEqual([
        {
          siteId: SITE_ID,
          revision: 4,
          paths: ['original', 'thumbnail', 'card', 'wide'].map(variant => `/media/${INTENT_ID}/${variant}`),
        },
      ])
    },
  )

  it('invalidates the immutable affected-page set after a reviewed-file release', async () => {
    const calls: unknown[] = [],
      handler = defaultHandlers({
        async invalidate(input) {
          calls.push(input)
        },
      }).get('site.files.published')!
    expect(handler.idempotency).toBe('natural')
    await handler.handle({
      ...event(),
      event_type: 'site.files.published',
      payload: { version_id: INTENT_ID, revision: 8, paths: ['/', '/program'] },
    })
    expect(calls).toEqual([{ siteId: SITE_ID, revision: 8, paths: ['/', '/program'] }])
  })

  it('physically cleans only database-resolved keys at the exact delete revision', async () => {
    const removed: string[] = []
    const finalized: [string, number][] = []
    const repository: MediaCleanupRepository = {
      async forCleanup(eventId, lease, mediaId, revision) {
        expect([eventId, lease, mediaId, revision]).toEqual(['77', 'lease', INTENT_ID, 7])
        return [
          { kind: 'original', objectKey: `media/objects/${INTENT_ID}/${'a'.repeat(64)}.jpg` },
          { kind: 'card', objectKey: `media/objects/${INTENT_ID}/variants/card/${'b'.repeat(64)}.webp` },
        ]
      },
      async finalize(_eventId, _lease, mediaId, revision) {
        finalized.push([mediaId, revision])
      },
    }
    const media = memoryMedia('unrelated/source.upload', new Uint8Array([1]))
    media.remove = async key => {
      removed.push(key)
    }
    await mediaCleanupHandler({ repository, media }).handle({
      ...event(),
      event_type: MEDIA_CLEANUP_EVENT,
      payload: {
        media_id: INTENT_ID,
        deleted_revision: 7,
        // A hostile payload key is ignored because keys only come from DB.
        object_key: '../../secret',
      },
    })
    expect(removed).toEqual([
      `media/objects/${INTENT_ID}/${'a'.repeat(64)}.jpg`,
      `media/objects/${INTENT_ID}/variants/card/${'b'.repeat(64)}.webp`,
    ])
    expect(finalized).toEqual([[INTENT_ID, 7]])
  })

  it('makes a restored/stale cleanup event a silent no-op', async () => {
    const remove = vi.fn()
    const finalize = vi.fn()
    await mediaCleanupHandler({
      repository: {
        async forCleanup() {
          return []
        },
        finalize,
      },
      media: { ...memoryMedia('source/file.upload', new Uint8Array([1])), remove },
    }).handle({
      ...event(),
      event_type: MEDIA_CLEANUP_EVENT,
      payload: { media_id: INTENT_ID, deleted_revision: 8 },
    })
    expect(remove).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
  })
})
