// The database vocabulary for media processing is intentionally isolated in
// this file. Image decoding/storage can be tested without Postgres, and a
// provider or command-signature change does not leak into the processor.
import type { Pool } from 'pg'
import { withWorkerSession } from './handlers.ts'
import type { MediaForInspection, MediaProcessingRepository, ProcessedMediaMetadata } from './media.ts'

type InspectionRow = {
  intent_id?: string
  site_id: string | null
  upload_object_key: string
  final_key_prefix: string
  declared_mime_type: string
  declared_bytes: string | number
  status: string
}

export function createPostgresMediaProcessingRepository(pool: Pool, workerId: string): MediaProcessingRepository {
  return {
    async forInspection(intentId): Promise<MediaForInspection | null> {
      return withWorkerSession(pool, workerId, async client => {
        const { rows } = await client.query<InspectionRow>('SELECT * FROM app.media_upload_for_inspection($1)', [
          intentId,
        ])
        const row = rows[0]
        if (!row) return null
        if (row.status === 'ready' || row.status === 'failed') return null
        if (row.status !== 'uploaded') throw new Error(`media-upload-not-inspectable:${row.status}`)
        return {
          intentId: row.intent_id ?? intentId,
          siteId: row.site_id,
          uploadObjectKey: row.upload_object_key,
          finalKeyPrefix: row.final_key_prefix,
          declaredMime: row.declared_mime_type,
          declaredBytes: Number(row.declared_bytes),
        }
      })
    },

    async finalize(intent: MediaForInspection, processed: ProcessedMediaMetadata): Promise<void> {
      await withWorkerSession(pool, workerId, async client => {
        const original = processed.original
        await client.query('SELECT app.finalize_media_upload($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)', [
          intent.intentId,
          intent.uploadObjectKey,
          original.objectKey,
          original.sha256,
          original.mimeType,
          original.bytes,
          original.width,
          original.height,
          JSON.stringify(
            processed.variants.map(variant => ({
              kind: variant.kind,
              object_key: variant.objectKey,
              width: variant.width,
              height: variant.height,
              bytes: variant.bytes,
              sha256: variant.sha256,
              mime_type: variant.mimeType,
            })),
          ),
        ])
      })
    },

    async fail(intent, failureCode): Promise<void> {
      await withWorkerSession(pool, workerId, async client => {
        await client.query('SELECT app.fail_media_upload($1,$2,$3)', [
          intent.intentId,
          intent.uploadObjectKey,
          failureCode,
        ])
      })
    },
  }
}
