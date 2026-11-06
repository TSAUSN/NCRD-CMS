import 'server-only'
import { asUser, type GovernedMediaVariant, type ResolvedMediaObject } from '@cms/platform'
import type { AdminMediaDeliveryRepository } from './media-delivery-handler.ts'

type ResolvedRow = {
  media_id: string
  variant: GovernedMediaVariant
  object_key: string
  mime_type: ResolvedMediaObject['mimeType']
  bytes: string | number
  width: number
  height: number
  content_hash: string
}

export function createPostgresAdminMediaDeliveryRepository(): AdminMediaDeliveryRepository {
  return {
    resolve(userId, mediaId, variant) {
      return asUser({ userId }, async client => {
        const row = (await client.query<ResolvedRow>('SELECT * FROM app.resolve_media($1,$2)', [mediaId, variant]))
          .rows[0]
        return row
          ? {
              mediaId: row.media_id,
              variant: row.variant,
              objectKey: row.object_key,
              mimeType: row.mime_type,
              bytes: Number(row.bytes),
              width: row.width,
              height: row.height,
              contentHash: row.content_hash,
            }
          : null
      })
    },
  }
}
