import type { MediaAsset, MediaStatus } from './media-library.ts'

export type MediaAssetRow = {
  id: string
  revision: string
  site_id: string | null
  original_name: string
  alt_text: string
  decorative: boolean
  focal: unknown
  width: number | null
  height: number | null
  bytes: string | null
  mime_type: string
  status: MediaStatus
  folder: string
  attribution: string
  source: string
  tags: string[]
  created_at: Date
  deleted_at: Date | null
  used_on_items: number
  used_in_versions: number
  has_thumbnail: boolean
  has_card: boolean
  has_wide: boolean
}

function focalPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { x?: unknown; y?: unknown }
  return typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : null
}

export function mediaAssetFromRow(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    revision: Number(row.revision),
    siteId: row.site_id,
    scope: row.site_id === null ? 'shared' : 'site',
    name: row.original_name || 'Untitled image',
    altText: row.alt_text,
    decorative: row.decorative,
    focal: focalPoint(row.focal),
    width: row.width,
    height: row.height,
    bytes: row.bytes === null ? null : Number(row.bytes),
    mimeType: row.mime_type,
    status: row.status,
    folder: row.folder,
    attribution: row.attribution,
    source: row.source,
    tags: row.tags,
    variants: {
      original: true,
      thumbnail: row.has_thumbnail,
      card: row.has_card,
      wide: row.has_wide,
    },
    previewUrl: row.has_thumbnail ? `/media/${encodeURIComponent(row.id)}/thumbnail` : null,
    deliveryUrl: row.has_wide ? `/media/${encodeURIComponent(row.id)}/wide` : null,
    usedOnItems: row.used_on_items,
    usedInVersions: row.used_in_versions,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  }
}
