import type { Pool } from 'pg'
import { withWorkerSession } from './handlers.ts'
import type { MediaCleanupRepository } from './media-cleanup.ts'

type CleanupRow = { kind: string; object_key: string }

export function createPostgresMediaCleanupRepository(pool: Pool, workerId: string): MediaCleanupRepository {
  return {
    forCleanup(eventId, leaseToken, mediaId, deletedRevision) {
      return withWorkerSession(pool, workerId, async client => {
        const { rows } = await client.query<CleanupRow>('SELECT * FROM app.media_for_cleanup($1,$2,$3,$4)', [
          eventId,
          leaseToken,
          mediaId,
          deletedRevision,
        ])
        return rows.map(row => ({ kind: row.kind, objectKey: row.object_key }))
      })
    },
    async finalize(eventId, leaseToken, mediaId, deletedRevision) {
      await withWorkerSession(pool, workerId, async client => {
        await client.query('SELECT app.finalize_media_cleanup($1,$2,$3,$4)', [
          eventId,
          leaseToken,
          mediaId,
          deletedRevision,
        ])
      })
    },
  }
}
