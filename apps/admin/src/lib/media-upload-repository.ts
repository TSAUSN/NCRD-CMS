import 'server-only'
import { asUser } from '@cms/platform'
import type {
  AdminMediaUploadRepository,
  BegunMediaUpload,
  BeginMediaUploadInput,
  MediaReceipt,
  MediaUploadStatus,
  MediaUploadStatusRepository,
} from './media-upload-handler.ts'
import type { MediaAsset, MediaStatus } from './media-library.ts'

type BeginRow = {
  intent_id: string
  upload_token: string
  upload_object_key: string
  final_key_prefix: string
  expires_at: Date
  max_bytes: string | number
  allowed_content_type: BegunMediaUpload['allowedContentType']
}

type ReceiptRow = {
  receipt_token: string
  upload_object_key: string
  declared_bytes: string | number
  max_bytes: string | number
  allowed_content_type: MediaReceipt['allowedContentType']
  expires_at: Date
}

type StatusRow = {
  intent_id: string
  status: MediaUploadStatus['status']
  original_name: string
  media_id: string | null
  failure_code: string | null
}

type StatusAssetRow = {
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

function statusAsset(row: StatusAssetRow): MediaAsset {
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

export function createPostgresAdminMediaUploadRepository(): AdminMediaUploadRepository {
  return {
    async begin(userId: string, input: BeginMediaUploadInput): Promise<BegunMediaUpload> {
      return asUser({ userId }, async client => {
        const { rows } = await client.query<BeginRow>(
          'SELECT * FROM app.begin_media_upload($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::text[])',
          [
            input.siteId,
            input.originalName,
            input.declaredMime,
            input.declaredBytes,
            input.altText,
            input.decorative,
            input.focal === null ? null : JSON.stringify(input.focal),
            input.folder,
            input.attribution,
            input.source,
            input.tags,
          ],
        )
        const row = rows[0]
        if (!row) throw new Error('media-upload-intent-not-created')
        return {
          intentId: row.intent_id,
          uploadToken: row.upload_token,
          uploadObjectKey: row.upload_object_key,
          finalKeyPrefix: row.final_key_prefix,
          expiresAt: new Date(row.expires_at),
          maxBytes: Number(row.max_bytes),
          allowedContentType: row.allowed_content_type,
        }
      })
    },

    // The upload token is the authority here. The browser never sends site,
    // object-key, type, or byte constraints back; this command returns the
    // server-recorded values and rotates the one-time capability atomically.
    async claimReceipt(intentId, uploadToken): Promise<MediaReceipt | null> {
      return asUser({ userId: null }, async client => {
        const { rows } = await client.query<ReceiptRow>('SELECT * FROM app.media_upload_for_receipt($1,$2)', [
          intentId,
          uploadToken,
        ])
        const row = rows[0]
        if (!row) return null
        return {
          intentId,
          receiptToken: row.receipt_token,
          uploadObjectKey: row.upload_object_key,
          declaredBytes: Number(row.declared_bytes),
          maxBytes: Number(row.max_bytes),
          allowedContentType: row.allowed_content_type,
          expiresAt: new Date(row.expires_at),
        }
      })
    },

    async markReceived(receipt, contentType, bytes): Promise<void> {
      await asUser({ userId: null }, async client => {
        await client.query('SELECT app.mark_media_upload_received($1,$2,$3,$4,$5)', [
          receipt.intentId,
          receipt.receiptToken,
          receipt.uploadObjectKey,
          contentType,
          bytes,
        ])
      })
    },

    async failReceipt(receipt, failureCode): Promise<void> {
      await asUser({ userId: null }, async client => {
        await client.query('SELECT app.fail_media_upload_receipt($1,$2,$3,$4)', [
          receipt.intentId,
          receipt.receiptToken,
          receipt.uploadObjectKey,
          failureCode,
        ])
      })
    },
  }
}

export function createPostgresMediaUploadStatusRepository(): MediaUploadStatusRepository {
  return {
    read(userId, intentId) {
      return asUser({ userId }, async client => {
        const status = (await client.query<StatusRow>('SELECT * FROM app.media_upload_status($1)', [intentId])).rows[0]
        if (!status) return null
        let asset: MediaAsset | null = null
        if (status.status === 'ready' && status.media_id) {
          const row = (
            await client.query<StatusAssetRow>(
              `SELECT m.id,m.revision,m.site_id,m.original_name,m.alt_text,m.decorative,m.focal,
                    m.width,m.height,m.bytes,m.mime_type,m.status,m.folder,m.attribution,m.source,m.tags,
                    m.created_at,m.deleted_at,
                    count(DISTINCT u.item_id)::int AS used_on_items,
                    count(DISTINCT u.version_id)::int AS used_in_versions,
                    COALESCE(bool_or(v.kind='thumbnail'),false) AS has_thumbnail,
                    COALESCE(bool_or(v.kind='card'),false) AS has_card,
                    COALESCE(bool_or(v.kind='wide'),false) AS has_wide
               FROM media m
               LEFT JOIN (SELECT media_id,item_id,version_id FROM media_usage
           UNION ALL SELECT media_id,site_id,version_id FROM site_file_media_usage) u ON u.media_id=m.id
               LEFT JOIN media_variants v ON v.media_id=m.id
              WHERE m.id=$1
              GROUP BY m.id`,
              [status.media_id],
            )
          ).rows[0]
          if (row) asset = statusAsset(row)
        }
        return {
          intentId: status.intent_id,
          status: status.status,
          originalName: status.original_name,
          failureCode: status.failure_code,
          asset,
        }
      })
    },
  }
}
