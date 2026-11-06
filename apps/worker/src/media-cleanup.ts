import type { MediaStore } from '@cms/platform'
import { PermanentJobError, type EventHandler } from './handlers.ts'

export const MEDIA_CLEANUP_EVENT = 'media.cleanup_requested'

export type MediaCleanupObject = { kind: string; objectKey: string }

export type MediaCleanupRepository = {
  /** Empty means restored, re-deleted at another revision, or already purged. */
  forCleanup(
    eventId: string,
    outboxLeaseToken: string,
    mediaId: string,
    deletedRevision: number,
  ): Promise<MediaCleanupObject[]>
  finalize(eventId: string, outboxLeaseToken: string, mediaId: string, deletedRevision: number): Promise<void>
}

type Deps = { repository: MediaCleanupRepository; media: MediaStore }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function mediaCleanupHandler(deps: Deps): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event) {
      const mediaId = event.payload['media_id']
      const deletedRevision = event.payload['deleted_revision']
      if (
        typeof mediaId !== 'string' ||
        !UUID.test(mediaId) ||
        typeof deletedRevision !== 'number' ||
        !Number.isSafeInteger(deletedRevision) ||
        deletedRevision < 1
      ) {
        throw new PermanentJobError(
          `media-cleanup-payload-unusable — event ${event.id} has no valid media delete revision`,
        )
      }

      // Paths are intentionally absent from the event. The command re-checks
      // status, exact revision, retention, and restore before returning them.
      const objects = await deps.repository.forCleanup(event.id, event.lease_token, mediaId, deletedRevision)
      if (objects.length === 0) return
      for (const object of objects) await deps.media.remove(object.objectKey)
      await deps.repository.finalize(event.id, event.lease_token, mediaId, deletedRevision)
    },
  }
}

export function unconfiguredMediaCleanupHandler(): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event) {
      throw new Error(`media-cleanup-unconfigured — event ${event.id} is left for a storage worker`)
    },
  }
}
