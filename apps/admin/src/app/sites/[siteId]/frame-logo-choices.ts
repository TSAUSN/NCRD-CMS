import 'server-only'
import { asUser } from '@cms/platform'
import { UUID } from '../../../lib/action-result.ts'

export type FrameLogoChoice = {
  id: string
  name: string
  altText: string
  previewUrl: string | null
  deliveryUrl: string | null
}

/** Site frames need only their saved logos. Their pickers read the library when opened. */
export async function readFrameLogoChoices(
  userId: string,
  siteId: string,
  mediaIds: readonly unknown[],
): Promise<FrameLogoChoice[]> {
  const ids = [...new Set(mediaIds.filter((value): value is string => typeof value === 'string' && UUID.test(value)))]
  if (!ids.length) return []
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{
      id: string
      original_name: string | null
      alt_text: string
      has_thumbnail: boolean
      has_wide: boolean
    }>(
      `SELECT m.id,m.original_name,m.alt_text,
              EXISTS(SELECT 1 FROM media_variants WHERE media_id=m.id AND kind='thumbnail') AS has_thumbnail,
              EXISTS(SELECT 1 FROM media_variants WHERE media_id=m.id AND kind='wide') AS has_wide
         FROM media m
        WHERE m.id=ANY($2::uuid[]) AND (m.site_id=$1 OR m.site_id IS NULL)
          AND m.status='ready' AND m.deleted_at IS NULL`,
      [siteId, ids],
    )
    return rows.map(row => ({
      id: row.id,
      name: row.original_name || 'Untitled image',
      altText: row.alt_text,
      previewUrl: row.has_thumbnail ? '/media/' + row.id + '/thumbnail' : null,
      deliveryUrl: row.has_wide ? '/media/' + row.id + '/wide' : null,
    }))
  })
}
