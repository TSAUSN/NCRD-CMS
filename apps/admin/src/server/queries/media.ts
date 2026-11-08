import 'server-only'
import { mediaAssetFromRow, type MediaAssetRow } from '../../lib/media-asset-row.ts'
import { asUser } from '@cms/platform'
import type { MediaAsset } from '../../lib/media-library.ts'

/**
 * The site's own media and the shared pool, with usage facts calculated from
 * rows this reader can see. Governed relative media URLs are origin-agnostic:
 * admin resolves them through the session-protected route, while the public
 * app resolves the same id and variant through host-scoped site access.
 */
export function listMediaAssets(userId: string, siteId: string): Promise<MediaAsset[]> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<MediaAssetRow>(
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
    return rows.map(mediaAssetFromRow)
  })
}
