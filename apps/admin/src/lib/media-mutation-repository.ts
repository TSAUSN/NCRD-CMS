import 'server-only'
import { mediaAssetFromRow, type MediaAssetRow } from './media-asset-row.ts'
import { asUser } from '@cms/platform'
import type { MediaAsset } from './media-library.ts'
import type {
  BulkDeleteInput,
  BulkOrganizationInput,
  DeleteMediaInput,
  MediaMutationRepository,
} from './media-mutation-handler.ts'
import type { MediaMetadataInput } from './media-library.ts'

const MEDIA_AFTER_MUTATION = `
  SELECT m.id, m.revision, m.site_id, m.original_name, m.alt_text,
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
   WHERE m.id = $1
   GROUP BY m.id`

async function readAsset(client: { query: Function }, mediaId: string): Promise<MediaAsset | null> {
  const row = ((await client.query(MEDIA_AFTER_MUTATION, [mediaId])) as { rows: MediaAssetRow[] }).rows[0]
  return row ? mediaAssetFromRow(row) : null
}

async function readAssets(client: { query: Function }, mediaIds: string[]): Promise<MediaAsset[]> {
  const assets = await Promise.all(mediaIds.map(mediaId => readAsset(client, mediaId)))
  return assets.filter((asset): asset is MediaAsset => asset !== null)
}

export function createPostgresMediaMutationRepository(): MediaMutationRepository {
  return {
    softDelete(userId: string, mediaId: string, input: DeleteMediaInput) {
      return asUser({ userId }, async client => {
        await client.query('SELECT app.soft_delete_media($1,$2,$3,$4)', [
          mediaId,
          input.expectedRevision,
          input.breakReferences,
          input.reason,
        ])
        return readAsset(client, mediaId)
      })
    },
    restore(userId, mediaId, revision) {
      return asUser({ userId }, async client => {
        await client.query('SELECT app.restore_media($1,$2)', [mediaId, revision])
        return readAsset(client, mediaId)
      })
    },
    updateMetadata(userId: string, mediaId: string, revision: number, input: MediaMetadataInput) {
      return asUser({ userId }, async client => {
        await client.query('SELECT app.update_media_metadata($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          mediaId,
          revision,
          input.altText,
          input.decorative,
          input.focal === null ? null : JSON.stringify(input.focal),
          input.folder,
          input.attribution,
          input.source,
          input.tags,
        ])
        return readAsset(client, mediaId)
      })
    },
    bulkOrganize(userId: string, input: BulkOrganizationInput) {
      return asUser({ userId }, async client => {
        const ids = input.items.map(item => item.id)
        await client.query('SELECT * FROM app.bulk_organize_media($1,$2,$3,$4,$5)', [
          ids,
          input.items.map(item => item.revision),
          input.folder,
          input.addTags,
          input.removeTags,
        ])
        return readAssets(client, ids)
      })
    },
    bulkDelete(userId: string, input: BulkDeleteInput) {
      return asUser({ userId }, async client => {
        const ids = input.items.map(item => item.id)
        await client.query('SELECT * FROM app.bulk_soft_delete_media($1,$2,$3,$4)', [
          ids,
          input.items.map(item => item.revision),
          input.breakReferences,
          input.reason,
        ])
        return readAssets(client, ids)
      })
    },
  }
}
