import 'server-only'
import { asPublic, type GovernedMediaVariant, type ResolvedMediaObject } from '@cms/platform'
import type { PublicMediaDeliveryRepository } from './media-delivery-handler.ts'

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

export function createPostgresPublicMediaDeliveryRepository(): PublicMediaDeliveryRepository {
  return {
    native: (host, path) =>
      asPublic(
        async client =>
          (
            await client.query<{ target: unknown }>('SELECT public_api.resolve_site_native_path($1,$2) AS target', [
              host,
              path,
            ])
          ).rows[0]?.target ?? null,
      ),
    resolve(host, mediaId, variant) {
      return asPublic(async client => {
        const row = (
          await client.query<ResolvedRow>('SELECT * FROM public_api.resolve_media($1,$2,$3)', [host, mediaId, variant])
        ).rows[0]
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
