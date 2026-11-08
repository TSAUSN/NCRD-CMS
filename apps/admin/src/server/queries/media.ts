import 'server-only'
import { MEDIA_ASSET_DETAILS_SQL } from '../../lib/media-library-queries.ts'
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
              usage.used_on_items, usage.used_in_versions,
              variants.has_thumbnail, variants.has_card, variants.has_wide
         FROM media m
         ${MEDIA_ASSET_DETAILS_SQL}
        WHERE m.site_id = $1 OR m.site_id IS NULL
        ORDER BY (m.status = 'deleted'), m.created_at DESC, m.original_name`,
      [siteId],
    )
    return rows.map(mediaAssetFromRow)
  })
}
