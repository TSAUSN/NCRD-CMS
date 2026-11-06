import { poolFor } from '@cms/platform'
import { createCacheInvalidator, createMediaStore, createScreenshotter, type WorkerConfig } from './config.ts'
import { defaultHandlers } from './handlers.ts'
import { sectionThumbnailHandler } from './thumbnails.ts'
import { mediaProcessingHandler } from './media.ts'
import { createPostgresMediaProcessingRepository } from './media-repository.ts'
import { mediaCleanupHandler } from './media-cleanup.ts'
import { createPostgresMediaCleanupRepository } from './media-cleanup-repository.ts'
import { createInvitationHandler } from './invitations.ts'
import { createDomainHandler } from './domains.ts'
import { createSiteHostingHandler } from './site-hosting.ts'

/** One handler set for continuous and request-driven browser workers. Chromium
 * launches lazily, so an empty queue never pays for a browser startup. */
export function createWorkerRuntime(config: WorkerConfig) {
  const pool = poolFor('worker')
  const media = createMediaStore(config)
  const screenshots = createScreenshotter(config)
  const handlers = defaultHandlers(
    createCacheInvalidator(),
    sectionThumbnailHandler({
      pool,
      workerId: config.workerId,
      media,
      screenshots,
    }),
    mediaProcessingHandler({
      repository: createPostgresMediaProcessingRepository(pool, config.workerId),
      media,
      limits: {
        maxInputBytes: config.mediaMaxInputBytes,
        maxInputPixels: config.mediaMaxInputPixels,
        maxDimension: config.mediaMaxDimension,
      },
    }),
    mediaCleanupHandler({
      repository: createPostgresMediaCleanupRepository(pool, config.workerId),
      media,
    }),
    createInvitationHandler(pool, config.workerId),
    createDomainHandler(pool, config.workerId),
    createSiteHostingHandler(pool, config.workerId),
  )
  return { pool, handlers, screenshots }
}
