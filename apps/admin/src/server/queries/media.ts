import 'server-only'
import { asUser } from '@cms/platform'
import type { MediaAsset, MediaStatus } from '../../lib/media-library.ts'

type MediaRow = {
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

function adminMediaUrl(mediaId: string): string {
  return `/media/${encodeURIComponent(mediaId)}/thumbnail`
}

/**
 * The site's own media and the shared pool, with usage facts calculated from
 * rows this reader can see. Governed relative media URLs are origin-agnostic:
 * admin resolves them through the session-protected route, while the public
 * app resolves the same id and variant through host-scoped site access.
 */
export function listMediaAssets(userId: string, siteId: string): Promise<MediaAsset[]> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<MediaRow>(
      `SELECT m.id, m.revision, m.site_id, m.original_name, m.alt_text,
              m.decorative, m.focal, m.width, m.height, m.bytes, m.mime_type,
              m.status, m.folder, m.attribution, m.source, m.tags, m.created_at, m.deleted_at,
              count(DISTINCT u.item_id)::int AS used_on_items,
              count(DISTINCT u.version_id)::int AS used_in_versions,
              COALESCE(bool_or(v.kind = 'thumbnail'), false) AS has_thumbnail,
              COALESCE(bool_or(v.kind = 'card'), false) AS has_card,
              COALESCE(bool_or(v.kind = 'wide'), false) AS has_wide
         FROM media m
         LEFT JOIN (SELECT media_id,item_id,version_id FROM media_usage
           UNION ALL SELECT media_id,site_id,version_id FROM site_file_media_usage) u ON u.media_id=m.id
         LEFT JOIN media_variants v ON v.media_id = m.id
        WHERE m.site_id = $1 OR m.site_id IS NULL
        GROUP BY m.id
        ORDER BY (m.status = 'deleted'), m.created_at DESC, m.original_name`,
      [siteId],
    )
    return rows.map(row => ({
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
      previewUrl: row.has_thumbnail ? adminMediaUrl(row.id) : null,
      deliveryUrl: row.has_wide ? `/media/${encodeURIComponent(row.id)}/wide` : null,
      usedOnItems: row.used_on_items,
      usedInVersions: row.used_in_versions,
      createdAt: row.created_at.toISOString(),
      deletedAt: row.deleted_at?.toISOString() ?? null,
    }))
  })
}
