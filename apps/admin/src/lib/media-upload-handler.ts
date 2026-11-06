import { type MediaStore } from '@cms/platform'
import type { MediaAsset } from './media-library.ts'
import { isSameOriginRequest } from './request-origin.ts'

export const MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024
export const MEDIA_UPLOAD_JSON_BYTES = 16 * 1024
export const ALLOWED_MEDIA_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
type AllowedMediaMime = (typeof ALLOWED_MEDIA_MIME)[number]

export type BeginMediaUploadInput = {
  siteId: string
  originalName: string
  declaredMime: AllowedMediaMime
  declaredBytes: number
  altText: string
  decorative: boolean
  focal: { x: number; y: number } | null
  folder: string
  attribution: string
  source: string
  tags: string[]
}

export type BegunMediaUpload = {
  intentId: string
  uploadToken: string
  uploadObjectKey: string
  finalKeyPrefix: string
  expiresAt: Date
  maxBytes: number
  allowedContentType: AllowedMediaMime
}

export type MediaReceipt = {
  intentId: string
  receiptToken: string
  uploadObjectKey: string
  declaredBytes: number
  maxBytes: number
  allowedContentType: AllowedMediaMime
  expiresAt: Date
}

export type MediaUploadStatus = {
  intentId: string
  status: 'processing' | 'ready' | 'failed'
  originalName: string
  failureCode: string | null
  asset: MediaAsset | null
}

export type MediaUploadStatusRepository = {
  read(userId: string, intentId: string): Promise<MediaUploadStatus | null>
}

/** All SQL command names live behind this adapter. */
export type AdminMediaUploadRepository = {
  begin(userId: string, input: BeginMediaUploadInput): Promise<BegunMediaUpload>
  claimReceipt(intentId: string, uploadToken: string): Promise<MediaReceipt | null>
  markReceived(receipt: MediaReceipt, contentType: string, bytes: number): Promise<void>
  failReceipt(receipt: MediaReceipt, failureCode: string): Promise<void>
}

type UploadSession = { userId: string } | null

type BeginDeps = {
  currentSession(): Promise<UploadSession>
  repository: AdminMediaUploadRepository
  media: MediaStore
  maxBytes?: number
}

type ReceiveDeps = {
  repository: AdminMediaUploadRepository
  media: MediaStore
  maxBytes?: number
  now?: () => Date
}

type StatusDeps = {
  currentSession(): Promise<UploadSession>
  repository: MediaUploadStatusRepository
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    },
  )
}

function domainErrorKind(error: unknown): string | null {
  const kind = (error as { kind?: unknown })?.kind
  return typeof kind === 'string' ? kind : null
}

function contentLength(request: Request): number | null {
  const raw = request.headers.get('content-length')
  if (!raw || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel('media-upload-too-large').catch(() => {})
        throw new Error('media-upload-too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean.length > 0 && clean.length <= max ? clean : null
}

function cleanOptionalString(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null
  const clean = value.trim()
  return clean.length <= max ? clean : null
}

function parseBeginInput(raw: unknown, siteId: string, hardMax: number): BeginMediaUploadInput | string {
  if (!raw || typeof raw !== 'object') return 'Upload details must be a JSON object.'
  const value = raw as Record<string, unknown>
  const originalName = cleanString(value['originalName'], 255)
  if (!originalName) return 'Choose an image with a usable file name.'
  const declaredMime = value['contentType']
  if (typeof declaredMime !== 'string' || !ALLOWED_MEDIA_MIME.includes(declaredMime as AllowedMediaMime)) {
    return 'Choose a JPEG, PNG, or WebP image.'
  }
  const declaredBytes = value['bytes']
  if (
    typeof declaredBytes !== 'number' ||
    !Number.isSafeInteger(declaredBytes) ||
    declaredBytes < 1 ||
    declaredBytes > hardMax
  ) {
    return `The image must be no larger than ${hardMax} bytes.`
  }
  const decorative = value['decorative'] === true
  const altText = typeof value['altText'] === 'string' ? value['altText'].trim() : ''
  if (!decorative && altText.length === 0) {
    return 'Describe the image for people who cannot see it, or mark it decorative.'
  }
  if (altText.length > 1_000) return 'Alternative text must be 1,000 characters or fewer.'

  let focal: BeginMediaUploadInput['focal'] = null
  if (value['focal'] !== undefined && value['focal'] !== null) {
    const point = value['focal'] as Record<string, unknown>
    if (
      !point ||
      typeof point !== 'object' ||
      typeof point['x'] !== 'number' ||
      typeof point['y'] !== 'number' ||
      point['x'] < 0 ||
      point['x'] > 1 ||
      point['y'] < 0 ||
      point['y'] > 1
    )
      return 'The focal point must be inside the image.'
    focal = { x: point['x'], y: point['y'] }
  }
  const tags = value['tags'] === undefined ? [] : value['tags']
  if (
    !Array.isArray(tags) ||
    tags.length > 20 ||
    tags.some(tag => typeof tag !== 'string' || tag.trim().length === 0 || tag.length > 64)
  ) {
    return 'Use at most 20 tags, each 64 characters or fewer.'
  }
  const folder = cleanOptionalString(value['folder'], 200)
  const attribution = cleanOptionalString(value['attribution'], 500)
  const source = cleanOptionalString(value['source'], 1_000)
  if (folder === null || attribution === null || source === null) {
    return 'Folder, attribution, or source metadata is invalid.'
  }
  return {
    siteId,
    originalName,
    declaredMime: declaredMime as AllowedMediaMime,
    declaredBytes,
    altText,
    decorative,
    focal,
    folder,
    attribution,
    source,
    tags: tags.map(tag => (tag as string).trim().toLocaleLowerCase()),
  }
}

export function createBeginMediaUploadHandler(deps: BeginDeps) {
  return async function POST(request: Request, siteId: string): Promise<Response> {
    if (!isSameOriginRequest(request))
      return jsonError(403, 'cross-origin-request', 'Upload requests must come from this site.')
    const session = await deps.currentSession()
    if (!session) return jsonError(404, 'not-found', 'The upload destination was not found.')
    if (!UUID.test(siteId)) return jsonError(404, 'not-found', 'The upload destination was not found.')
    const length = contentLength(request)
    if (length === null) return jsonError(411, 'length-required', 'Upload details need a Content-Length header.')
    if (length > MEDIA_UPLOAD_JSON_BYTES) {
      return jsonError(413, 'upload-details-too-large', 'Upload details are too large.')
    }
    let raw: unknown
    try {
      raw = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, MEDIA_UPLOAD_JSON_BYTES)))
    } catch {
      return jsonError(400, 'upload-details-invalid', 'Upload details must be valid JSON.')
    }
    const parsed = parseBeginInput(raw, siteId, deps.maxBytes ?? MAX_MEDIA_UPLOAD_BYTES)
    if (typeof parsed === 'string') return jsonError(400, 'upload-details-invalid', parsed)

    let intent: BegunMediaUpload
    try {
      intent = await deps.repository.begin(session.userId, parsed)
    } catch (error) {
      const kind = domainErrorKind(error)
      if (kind === 'not_authorized' || kind === 'not_found') {
        return jsonError(404, 'not-found', 'The upload destination was not found.')
      }
      if (kind === 'invalid_state') {
        return jsonError(400, 'upload-details-invalid', (error as Error).message)
      }
      throw error
    }
    const signed = await deps.media.createSignedUpload({
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      expiresAt: intent.expiresAt,
      maxBytes: intent.maxBytes,
      allowedContentTypes: [intent.allowedContentType],
    })
    return Response.json(
      {
        intentId: intent.intentId,
        upload: {
          url: signed.url,
          method: 'PUT',
          headers: signed.headers,
          expiresAt: signed.expiresAt.toISOString(),
          maxBytes: signed.maxBytes,
          allowedContentTypes: signed.allowedContentTypes,
        },
      },
      { status: 201, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
    )
  }
}

export function createReceiveMediaUploadHandler(deps: ReceiveDeps) {
  return async function PUT(request: Request, intentId: string): Promise<Response> {
    const hardMax = deps.maxBytes ?? MAX_MEDIA_UPLOAD_BYTES
    if (!isSameOriginRequest(request))
      return jsonError(403, 'cross-origin-request', 'Uploads must come from this site.')
    if (!UUID.test(intentId)) return jsonError(404, 'not-found', 'This upload request is not available.')
    const length = contentLength(request)
    if (length === null) return jsonError(411, 'length-required', 'The image needs a Content-Length header.')
    if (length < 1 || length > hardMax) {
      return jsonError(413, 'media-upload-too-large', `The image must be no larger than ${hardMax} bytes.`)
    }
    const uploadToken = request.headers.get('x-cms-upload-token')
    if (!uploadToken || !UUID.test(uploadToken)) {
      return jsonError(404, 'not-found', 'This upload request is not available.')
    }
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (!ALLOWED_MEDIA_MIME.includes(contentType as AllowedMediaMime)) {
      return jsonError(415, 'media-type-refused', 'Only JPEG, PNG, and WebP uploads are accepted.')
    }

    let receipt: MediaReceipt | null
    try {
      receipt = await deps.repository.claimReceipt(intentId, uploadToken)
    } catch (error) {
      const kind = domainErrorKind(error)
      if (kind === 'invalid_state' || kind === 'not_found' || kind === 'not_authorized') {
        return jsonError(404, 'not-found', 'This upload request is not available.')
      }
      throw error
    }
    if (!receipt) return jsonError(404, 'not-found', 'This upload request is not available.')
    const fail = async (code: string) => Promise.resolve(deps.repository.failReceipt(receipt, code)).catch(() => {})
    if ((deps.now ?? (() => new Date()))().getTime() >= receipt.expiresAt.getTime()) {
      await fail('media_upload_expired')
      return jsonError(410, 'media-upload-expired', 'This upload request has expired. Start a new upload.')
    }
    if (length !== receipt.declaredBytes || length > receipt.maxBytes) {
      await fail('media_size_mismatch')
      return jsonError(413, 'media-size-mismatch', 'The image size does not match the upload request.')
    }
    if (contentType !== receipt.allowedContentType) {
      await fail('media_type_mismatch')
      return jsonError(415, 'media-type-mismatch', 'The image type does not match the upload request.')
    }

    let bytes: Uint8Array
    try {
      bytes = await readBoundedBody(request, Math.min(hardMax, receipt.maxBytes))
      if (bytes.byteLength !== receipt.declaredBytes) throw new Error('media-size-mismatch')
      await deps.media.put(receipt.uploadObjectKey, bytes, contentType)
    } catch (error) {
      const tooLarge = (error as Error).message === 'media-upload-too-large'
      const code = tooLarge ? 'media-upload-too-large' : 'media-upload-incomplete'
      await fail(tooLarge ? 'media_upload_too_large' : 'media_upload_incomplete')
      return jsonError(tooLarge ? 413 : 400, code, 'The upload was incomplete. Start a new upload and try again.')
    }
    try {
      await deps.repository.markReceived(receipt, contentType, bytes.byteLength)
    } catch (error) {
      const kind = domainErrorKind(error)
      if (kind === 'invalid_state' || kind === 'not_found') {
        return jsonError(
          409,
          'media-upload-not-accepted',
          'This upload request is no longer available. Start a new upload.',
        )
      }
      throw error
    }
    return Response.json(
      { intentId, status: 'processing' },
      {
        status: 202,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      },
    )
  }
}

export function createMediaUploadStatusHandler(deps: StatusDeps) {
  return async function GET(intentId: string): Promise<Response> {
    if (!UUID.test(intentId)) return jsonError(404, 'not-found', 'This upload is not available.')
    const session = await deps.currentSession()
    if (!session) return jsonError(404, 'not-found', 'This upload is not available.')
    const status = await deps.repository.read(session.userId, intentId)
    if (!status) return jsonError(404, 'not-found', 'This upload is not available.')
    return Response.json(status, {
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    })
  }
}
