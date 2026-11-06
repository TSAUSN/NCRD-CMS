/**
 * The client-safe contract shared by the media workspace and image picker.
 *
 * The database already owns the asset record, processing state and usage facts.
 * The upload and mutation endpoints deliberately remain an adapter boundary:
 * this UI can be exercised against mocked responses now, while the eventual
 * MediaStore implementation can keep storage credentials out of the browser.
 */
export const MEDIA_STATUSES = ['ready', 'processing', 'failed', 'deleted'] as const
export type MediaStatus = (typeof MEDIA_STATUSES)[number]

export type MediaAsset = {
  id: string
  revision: number
  siteId: string | null
  scope: 'site' | 'shared'
  name: string
  altText: string
  decorative: boolean
  focal: { x: number; y: number } | null
  width: number | null
  height: number | null
  bytes: number | null
  mimeType: string
  status: MediaStatus
  folder: string
  attribution: string
  source: string
  tags: string[]
  variants: {
    original: boolean
    thumbnail: boolean
    card: boolean
    wide: boolean
  }
  /** Authenticated thumbnail for this admin only; never persist in page data. */
  previewUrl: string | null
  /** Stable visitor-facing URL supplied by the future media API. */
  deliveryUrl: string | null
  usedOnItems: number
  usedInVersions: number
  createdAt: string
  deletedAt: string | null
}

/** The image field shape the renderer already understands. */
export type ImagePlacementValue = {
  focal?: { x: number; y: number } | null
  media_id?: string
  /** The governed rendition persisted with the id and revalidated on publish. */
  variant?: 'original' | 'thumbnail' | 'card' | 'wide'
  src: string
  alt: string
  decorative: boolean
}

/** A placement may use any available governed rendition of this asset. An ID
 * alone never legitimizes a foreign URL, a query string or an absent variant. */
export function matchesMediaPlacement(asset: MediaAsset, value?: Partial<ImagePlacementValue>): boolean {
  if (!value) return false
  if (value.media_id && asset.id !== value.media_id) return false
  if (!value.src) return Boolean(value.media_id)
  if (value.src === asset.deliveryUrl) return true
  const match = /^\/media\/([0-9a-f-]{36})\/(original|thumbnail|card|wide)$/.exec(value.src)
  return Boolean(match && match[1] === asset.id && asset.variants[match[2] as keyof MediaAsset['variants']])
}

export type UploadProgress = {
  phase: 'preparing' | 'uploading' | 'processing'
  percent: number | null
}

type BeginUploadResponse = {
  intentId: string
  upload: {
    url: string
    method: 'PUT'
    headers: Record<string, string>
    expiresAt: string
    maxBytes: number
    allowedContentTypes: string[]
  }
}

type AssetResponse = { asset: MediaAsset }
export type MediaUploadReceipt = { intentId: string; status: 'processing'; originalName: string }
export type MediaUploadIntentStatus = {
  intentId: string
  status: 'processing' | 'ready' | 'failed'
  originalName: string
  failureCode: string | null
  asset: MediaAsset | null
}

export type MediaSort = 'newest' | 'oldest' | 'name-asc' | 'name-desc'
export type MediaScopeFilter = 'all' | 'site' | 'shared'
export type MediaLibraryQuery = {
  search: string
  status: 'all' | MediaStatus
  scope: MediaScopeFilter
  folder: string
  tag: string
  sort: MediaSort
  page: number
  pageSize: number
}
export type MediaLibraryFacets = {
  folders: Array<{ path: string; count: number }>
  tags: Array<{ tag: string; count: number }>
  scopes: { site: number; shared: number }
  statuses: Record<MediaStatus, number>
}
export type MediaLibraryResult = {
  assets: MediaAsset[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  facets: MediaLibraryFacets
}
export type MediaUsageRecord = {
  key: string
  kind: 'page' | 'collection' | 'global' | 'site-files'
  title: string
  versionLabel: string
  isCurrentDraft: boolean
  isCurrentLive: boolean
  href: string | null
  createdAt: string
}
export type MediaUsageResult = {
  currentLive: MediaUsageRecord[]
  currentDraft: MediaUsageRecord[]
  history: MediaUsageRecord[]
}

export type MediaMetadataInput = {
  altText: string
  decorative: boolean
  focal: { x: number; y: number } | null
  folder: string
  attribution: string
  source: string
  tags: string[]
}

export class MediaRequestError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'MediaRequestError'
    this.status = status
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'Size unavailable'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]!
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]!
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
}

export function formatDimensions(asset: Pick<MediaAsset, 'width' | 'height'>): string {
  return asset.width !== null && asset.height !== null
    ? `${asset.width} × ${asset.height} px`
    : 'Dimensions unavailable'
}

export function mediaStatusLabel(status: MediaStatus): string {
  return { ready: 'Ready', processing: 'Processing', failed: 'Failed', deleted: 'Deleted' }[status]
}

async function jsonOrError<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as {
    error?: string | { code?: string; message?: string }
    message?: string
  } | null
  if (!response.ok) {
    throw new MediaRequestError(
      typeof body?.error === 'string'
        ? body.error
        : (body?.error?.message ?? body?.message ?? `The media service returned ${response.status}.`),
      response.status,
    )
  }
  return body as T
}

function uploadBinary(
  target: BeginUploadResponse['upload'],
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<MediaUploadReceipt> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(target.method, target.url)
    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value)
    }
    request.setRequestHeader('content-type', file.type)
    request.upload.addEventListener('progress', event => {
      onProgress({
        phase: 'uploading',
        percent: event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null,
      })
    })
    request.addEventListener('load', () => {
      let body: unknown = null
      try {
        body = JSON.parse(request.responseText)
      } catch {
        /* storage may return no JSON */
      }
      if (request.status >= 200 && request.status < 300) {
        const receipt = body as Partial<MediaUploadReceipt> | null
        if (receipt?.intentId && receipt.status === 'processing') {
          resolve({ ...(receipt as Omit<MediaUploadReceipt, 'originalName'>), originalName: file.name })
        } else reject(new MediaRequestError('The upload receiver returned an unusable receipt.', request.status))
        return
      }
      const problem = body as { error?: { message?: string } } | null
      reject(
        new MediaRequestError(
          problem?.error?.message ?? `The storage service returned ${request.status}.`,
          request.status,
        ),
      )
    })
    request.addEventListener('error', () => reject(new MediaRequestError('The upload could not reach storage.')))
    request.addEventListener('abort', () => reject(new MediaRequestError('The upload was cancelled.')))
    request.send(file)
  })
}

/**
 * Assumed signed-upload contract. No file bytes pass through a Next action:
 * the API authorizes a destination, the browser uploads there, and the API is
 * then asked to verify/process that exact object.
 */
export async function uploadMedia(input: {
  siteId: string
  file: File
  altText: string
  decorative: boolean
  folder?: string
  onProgress: (progress: UploadProgress) => void
}): Promise<MediaUploadReceipt> {
  input.onProgress({ phase: 'preparing', percent: null })
  const begin = await jsonOrError<BeginUploadResponse>(
    await fetch(`/api/sites/${encodeURIComponent(input.siteId)}/media/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId: input.siteId,
        originalName: input.file.name,
        bytes: input.file.size,
        contentType: input.file.type,
        altText: input.decorative ? '' : input.altText.trim(),
        decorative: input.decorative,
        focal: null,
        folder: input.folder?.trim() ? input.folder.trim() : null,
        attribution: null,
        source: null,
        tags: [],
      }),
    }),
  )
  const receipt = await uploadBinary(begin.upload, input.file, input.onProgress)
  input.onProgress({ phase: 'processing', percent: null })
  return receipt
}

/**
 * Read the private intent projection rather than inventing processing/failed
 * media rows. The caller bounds its own polling cadence and lifetime.
 */
export async function mediaUploadStatus(intentId: string): Promise<MediaUploadIntentStatus> {
  return jsonOrError<MediaUploadIntentStatus>(
    await fetch(`/api/media/uploads/${encodeURIComponent(intentId)}/status`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    }),
  )
}

export function mediaUploadFailureMessage(code: string | null): string {
  switch (code) {
    case 'media_processing_interrupted':
      return 'Image processing could not finish. Choose the file again to retry.'
    case 'media_mime_mismatch':
      return 'The file contents did not match the image type.'
    case 'media_svg_refused':
      return 'SVG images are not accepted. Use a JPEG, PNG, or WebP image.'
    case 'media_dimension_limit':
    case 'media_input_too_large':
    case 'media_variant_too_large':
      return 'The image is too large to process safely.'
    case 'media_decode_failed':
    case 'media_type_refused':
      return 'The file could not be decoded as a supported image.'
    default:
      return 'The image could not be verified. Choose the file again to retry.'
  }
}

function libraryParams(query: MediaLibraryQuery): URLSearchParams {
  return new URLSearchParams({
    search: query.search,
    status: query.status,
    scope: query.scope,
    folder: query.folder,
    tag: query.tag,
    sort: query.sort,
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
}

export async function fetchMediaLibrary(siteId: string, query: MediaLibraryQuery): Promise<MediaLibraryResult> {
  return jsonOrError<MediaLibraryResult>(
    await fetch(`/api/sites/${encodeURIComponent(siteId)}/media?${libraryParams(query)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    }),
  )
}

export async function fetchMediaUsage(mediaId: string): Promise<MediaUsageResult> {
  const response = await jsonOrError<{ usage: MediaUsageResult }>(
    await fetch(`/api/media/assets/${encodeURIComponent(mediaId)}/usage`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    }),
  )
  return response.usage
}

export async function updateMediaMetadata(asset: MediaAsset, input: MediaMetadataInput): Promise<MediaAsset> {
  return mutateAsset(`/api/media/assets/${encodeURIComponent(asset.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: asset.revision, ...input }),
  })
}

export async function bulkOrganizeMedia(
  siteId: string,
  input: {
    assets: MediaAsset[]
    folder: string | null
    addTags: string[]
    removeTags: string[]
  },
): Promise<MediaAsset[]> {
  const result = await jsonOrError<{ assets: MediaAsset[] }>(
    await fetch(`/api/sites/${encodeURIComponent(siteId)}/media/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'organize',
        items: input.assets.map(asset => ({ id: asset.id, revision: asset.revision })),
        folder: input.folder,
        addTags: input.addTags,
        removeTags: input.removeTags,
      }),
    }),
  )
  return result.assets
}

export async function bulkDeleteMedia(
  siteId: string,
  input: {
    assets: MediaAsset[]
    breakReferences: boolean
    reason: string | null
  },
): Promise<MediaAsset[]> {
  const result = await jsonOrError<{ assets: MediaAsset[] }>(
    await fetch(`/api/sites/${encodeURIComponent(siteId)}/media/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'delete',
        items: input.assets.map(asset => ({ id: asset.id, revision: asset.revision })),
        breakReferences: input.breakReferences,
        reason: input.reason,
      }),
    }),
  )
  return result.assets
}

async function mutateAsset(path: string, init: RequestInit): Promise<MediaAsset> {
  const result = await jsonOrError<AssetResponse>(await fetch(path, init))
  return result.asset
}

export function deleteMedia(asset: MediaAsset, reason: string): Promise<MediaAsset> {
  return mutateAsset(`/api/media/assets/${encodeURIComponent(asset.id)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: asset.revision,
      breakReferences: asset.usedInVersions > 0,
      reason: reason.trim() || null,
    }),
  })
}

export function restoreMedia(asset: MediaAsset): Promise<MediaAsset> {
  return mutateAsset(`/api/media/assets/${encodeURIComponent(asset.id)}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: asset.revision }),
  })
}
