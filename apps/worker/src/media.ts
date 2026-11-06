// Upload inspection and responsive media production (SPEC §6.11).
//
// `sharp` is deliberately the only image dependency: it is a mature libvips
// binding with bounded pixel decoding, EXIF orientation support, metadata
// stripping by default, and deterministic WebP encoders. Hand-parsing image
// headers would not prove that the bytes can safely be decoded, while handing
// the original bytes through would preserve active metadata/polyglot tails.
import sharp from 'sharp'
import { isSafeObjectKey, sha256Hex, type CacheInvalidator, type MediaStore } from '@cms/platform'
import { PermanentJobError, type EventHandler, type OutboxEvent } from './handlers.ts'

export const MEDIA_PROCESS_EVENT = 'media.upload_received'
export const MEDIA_READY_EVENT = 'media.ready'
export const MEDIA_DELETED_EVENT = 'media.deleted'
export const MEDIA_RESTORED_EVENT = 'media.restored'

export const MEDIA_VARIANTS = {
  thumbnail: { width: 320, maxBytes: 100 * 1024 },
  card: { width: 960, maxBytes: 200 * 1024 },
  wide: { width: 1600, maxBytes: 512 * 1024 },
} as const

export type MediaProcessingLimits = {
  maxInputBytes: number
  maxInputPixels: number
  maxDimension: number
}

export const DEFAULT_MEDIA_LIMITS: MediaProcessingLimits = {
  maxInputBytes: 10 * 1024 * 1024,
  maxInputPixels: 40_000_000,
  maxDimension: 12_000,
}

export type MediaForInspection = {
  intentId: string
  siteId: string | null
  uploadObjectKey: string
  finalKeyPrefix: string
  declaredMime: string
  declaredBytes: number
}

export type ProcessedMediaObject = {
  objectKey: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  bytes: number
  width: number
  height: number
  sha256: string
}

export type ProcessedMediaVariant = ProcessedMediaObject & {
  kind: keyof typeof MEDIA_VARIANTS
  mimeType: 'image/webp'
}

export type ProcessedMediaAsset = ProcessedMediaObject & { data: Uint8Array }
export type ProcessedMediaVariantAsset = ProcessedMediaVariant & { data: Uint8Array }

export type ProcessedMedia = {
  original: ProcessedMediaAsset
  variants: ProcessedMediaVariantAsset[]
}

export type ProcessedMediaMetadata = {
  original: ProcessedMediaObject
  variants: ProcessedMediaVariant[]
}

/** The only database surface the processor needs. */
export type MediaProcessingRepository = {
  /** No row means this at-least-once delivery was already finalized or failed. */
  forInspection(intentId: string): Promise<MediaForInspection | null>
  finalize(intent: MediaForInspection, processed: ProcessedMediaMetadata): Promise<void>
  fail(intent: MediaForInspection, failureCode: string): Promise<void>
}

export class MediaValidationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code} — ${message}`)
    this.code = code
    this.name = 'MediaValidationError'
  }
}

type InputFormat = 'jpeg' | 'png' | 'webp'

const MIME_FOR_FORMAT: Record<InputFormat, ProcessedMediaObject['mimeType']> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const EXT_FOR_FORMAT: Record<InputFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

/** Signature sniffing happens before libvips sees the input, especially SVG. */
export function sniffImageFormat(bytes: Uint8Array): InputFormat | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'png'
  if (
    bytes.byteLength >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'webp'
  return null
}

function sharpInput(bytes: Uint8Array, limits: MediaProcessingLimits) {
  return sharp(bytes, {
    failOn: 'error',
    limitInputPixels: limits.maxInputPixels,
    sequentialRead: true,
    animated: false,
  })
}

async function normalizeOriginal(
  bytes: Uint8Array,
  format: InputFormat,
  limits: MediaProcessingLimits,
): Promise<{ data: Uint8Array; info: { width: number; height: number; size: number } }> {
  let pipeline = sharpInput(bytes, limits).rotate()
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
  else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
  else pipeline = pipeline.webp({ quality: 95, alphaQuality: 100 })
  const output = await pipeline.toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(output.data), info: output.info }
}

async function encodeWebpVariant(
  original: Uint8Array,
  kind: keyof typeof MEDIA_VARIANTS,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const spec = MEDIA_VARIANTS[kind]
  let targetWidth: number = spec.width
  // Quality reduction keeps ordinary card images at their intended responsive
  // width. A final width reduction handles high-entropy photographs without
  // ever lying about the dimensions that were actually stored.
  for (;;) {
    for (const quality of [82, 74, 66, 58, 50, 42, 35, 28, 22]) {
      const output = await sharp(original, { failOn: 'error' })
        .resize({ width: targetWidth, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, alphaQuality: quality })
        .toBuffer({ resolveWithObject: true })
      if (output.info.size <= spec.maxBytes) {
        return { data: new Uint8Array(output.data), width: output.info.width, height: output.info.height }
      }
    }
    if (targetWidth <= 64) {
      throw new MediaValidationError(
        'media_variant_too_large',
        `${kind} cannot be encoded within its ${spec.maxBytes}-byte bound`,
      )
    }
    targetWidth = Math.max(64, Math.floor(targetWidth * 0.8))
  }
}

export async function processMediaBytes(
  input: MediaForInspection,
  bytes: Uint8Array,
  limits: MediaProcessingLimits = DEFAULT_MEDIA_LIMITS,
): Promise<ProcessedMedia> {
  if (bytes.byteLength === 0 || bytes.byteLength !== input.declaredBytes) {
    throw new MediaValidationError(
      'media_size_mismatch',
      `received ${bytes.byteLength} bytes for an intent recorded as ${input.declaredBytes}`,
    )
  }
  if (bytes.byteLength > limits.maxInputBytes) {
    throw new MediaValidationError(
      'media_input_too_large',
      `the upload exceeds the ${limits.maxInputBytes}-byte inspection limit`,
    )
  }

  const format = sniffImageFormat(bytes)
  if (!format) {
    const head = new TextDecoder().decode(bytes.slice(0, 512)).toLowerCase()
    const code = head.includes('<svg') || head.includes('<?xml') ? 'media_svg_refused' : 'media_type_refused'
    throw new MediaValidationError(code, 'only decoded JPEG, PNG, and WebP images are accepted')
  }
  const inspectedMime = MIME_FOR_FORMAT[format]
  if (input.declaredMime !== inspectedMime) {
    throw new MediaValidationError(
      'media_mime_mismatch',
      `the bytes decode as ${inspectedMime}, not the intent's ${input.declaredMime}`,
    )
  }

  try {
    const metadata = await sharpInput(bytes, limits).metadata()
    if (metadata.format !== format) {
      throw new MediaValidationError('media_decode_mismatch', 'the decoder disagreed with the file signature')
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new MediaValidationError('media_animation_refused', 'animated and multi-page images are not accepted')
    }
    if (!metadata.width || !metadata.height) {
      throw new MediaValidationError('media_dimensions_missing', 'the image has no usable pixel dimensions')
    }
    if (metadata.width > limits.maxDimension || metadata.height > limits.maxDimension) {
      throw new MediaValidationError('media_dimension_limit', `image dimensions exceed ${limits.maxDimension}px`)
    }

    const normalized = await normalizeOriginal(bytes, format, limits)
    const originalHash = sha256Hex(normalized.data)
    const originalKey = `${input.finalKeyPrefix}${originalHash}.${EXT_FOR_FORMAT[format]}`
    if (!isSafeObjectKey(originalKey)) {
      throw new MediaValidationError('media_final_key_invalid', 'the recorded final key prefix is unusable')
    }
    const original: ProcessedMediaObject = {
      objectKey: originalKey,
      mimeType: inspectedMime,
      bytes: normalized.info.size,
      width: normalized.info.width,
      height: normalized.info.height,
      sha256: originalHash,
    }

    const variants: ProcessedMediaVariantAsset[] = []
    for (const kind of Object.keys(MEDIA_VARIANTS) as (keyof typeof MEDIA_VARIANTS)[]) {
      const encoded = await encodeWebpVariant(normalized.data, kind)
      const hash = sha256Hex(encoded.data)
      const objectKey = `${input.finalKeyPrefix}variants/${kind}/${hash}.webp`
      if (!isSafeObjectKey(objectKey)) {
        throw new MediaValidationError('media_variant_key_invalid', 'the recorded variant key prefix is unusable')
      }
      variants.push({
        kind,
        objectKey,
        mimeType: 'image/webp',
        bytes: encoded.data.byteLength,
        width: encoded.width,
        height: encoded.height,
        sha256: hash,
        data: encoded.data,
      })
    }
    return {
      original: { ...original, data: normalized.data },
      variants,
    }
  } catch (error) {
    if (error instanceof MediaValidationError) throw error
    throw new MediaValidationError('media_decode_failed', 'the image decoder refused the uploaded bytes')
  }
}

export type MediaProcessorDeps = {
  repository: MediaProcessingRepository
  media: MediaStore
  limits?: MediaProcessingLimits
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function mediaProcessingHandler(deps: MediaProcessorDeps): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event: OutboxEvent) {
      const intentId = event.payload['intent_id']
      if (typeof intentId !== 'string' || !UUID.test(intentId)) {
        throw new PermanentJobError(`media-payload-unusable — event ${event.id} has no valid upload intent`)
      }
      await processMediaUpload(intentId, deps)
    },
  }
}

/** Same guarded worker operation for queued delivery and local demo bootstrap. */
export async function processMediaUpload(intentId: string, deps: MediaProcessorDeps): Promise<void> {
  if (!UUID.test(intentId)) throw new PermanentJobError('media-payload-unusable — invalid upload intent')
  // The database function returns no row once the one-time intent has been
  // finalized or failed. That is the durable idempotency guard and it runs
  // before object-store reads or image decoding.
  const intent = await deps.repository.forInspection(intentId)
  if (!intent) return

  const bytes = await deps.media.get(intent.uploadObjectKey)
  if (!bytes) throw new Error(`media-upload-object-missing — ${intentId} is not readable yet`)

  try {
    const processed = await processMediaBytes(intent, bytes, deps.limits)
    const original = processed.original
    await deps.media.put(original.objectKey, original.data, original.mimeType)
    for (const variant of processed.variants) {
      await deps.media.put(variant.objectKey, variant.data, variant.mimeType)
    }
    const { data: _originalData, ...originalMetadata } = original
    await deps.repository.finalize(intent, {
      original: originalMetadata,
      variants: processed.variants.map(({ data: _data, ...metadata }) => metadata),
    })
    // A crash after finalize but before this cleanup is harmless: the next
    // delivery hits the database guard and the delayed cleanup can reap it.
    await deps.media.remove(intent.uploadObjectKey)
  } catch (error) {
    if (!(error instanceof MediaValidationError)) throw error
    await deps.repository.fail(intent, error.code)
    await deps.media.remove(intent.uploadObjectKey).catch(() => {})
    throw new PermanentJobError(error.message)
  }
}

export function unconfiguredMediaHandler(): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event) {
      throw new Error(`media-processor-unconfigured — event ${event.id} is left for an image worker`)
    },
  }
}

/** Ready/restore changes which stable UUID URLs resolve; invalidate all names. */
export function mediaStateChangedHandler(cache: CacheInvalidator): EventHandler {
  return {
    idempotency: 'natural',
    async handle(event) {
      const mediaId = event.payload['media_id']
      if (typeof mediaId !== 'string' || !UUID.test(mediaId)) {
        throw new PermanentJobError(`media-payload-unusable — event ${event.id} has no valid media id`)
      }
      // Shared-pool media has no public host. Admin delivery is no-store, so
      // there is no tenant cache to invalidate.
      if (!event.site_id) return
      await cache.invalidate({
        siteId: event.site_id,
        paths: ['original', 'thumbnail', 'card', 'wide'].map(variant => `/media/${mediaId}/${variant}`),
        revision: Number(event.payload['revision'] ?? 0),
      })
    },
  }
}
