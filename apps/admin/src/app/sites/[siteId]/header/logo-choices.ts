import 'server-only'
import { asUser } from '@cms/platform'
import type { HeaderConfig } from '@cms/schema'
import { UUID } from '../../../../lib/action-result.ts'

export type HeaderLogoChoice = {
  id: string
  name: string
  altText: string
  previewUrl: string | null
  deliveryUrl: string | null
}

/** The Header screen shows the saved logos. Its picker loads the library on demand. */
export async function readHeaderLogoChoices(
  userId: string,
  siteId: string,
  header: HeaderConfig,
): Promise<HeaderLogoChoice[]> {
  const logo = header.schemaVersion === 2 ? header.component.values.logo : undefined
  const ids = (
    header.schemaVersion === 1
      ? [header.brand.logoMediaId, header.brand.compactLogoMediaId]
      : [logo && typeof logo === 'object' && 'media_id' in logo ? logo.media_id : undefined]
  ).filter((value): value is string => typeof value === 'string' && UUID.test(value))
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
