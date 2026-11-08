import { hostname } from 'node:os'
import { resolve } from 'node:path'
import {
  createChromiumScreenshotter,
  configuredMediaStore,
  createRecordingCacheInvalidator,
  defaultMediaRoot,
  type CacheInvalidator,
  type ManagedScreenshotter,
  type MediaStore,
} from '@cms/platform'

export type WorkerConfig = {
  workerId: string
  version: string
  heartbeatMs: number
  pollMs: number
  healthSampleMs: number
  leaseSeconds: number
  batchSize: number
  healthPort: number
  /** Where the filesystem media store keeps its objects, absolute. */
  mediaRoot: string
  /** Hard compressed-byte and decoded-pixel ceilings for hostile uploads. */
  mediaMaxInputBytes: number
  mediaMaxInputPixels: number
  mediaMaxDimension: number
  screenshotTimeoutMs: number
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    // Stable per process so a restart shows as the same worker returning, and
    // two runners on one host never share a heartbeat row or a lease identity.
    workerId: env['WORKER_ID'] ?? `${hostname()}:${process.pid}`,
    version: env['APP_VERSION'] ?? 'dev',
    heartbeatMs: Number(env['WORKER_HEARTBEAT_MS'] ?? 10_000),
    pollMs: Number(env['WORKER_POLL_MS'] ?? 2_000),
    healthSampleMs: Number(env['WORKER_HEALTH_SAMPLE_MS'] ?? 15_000),
    // The lease must outlast the slowest plausible delivery, or a second worker
    // reclaims a row the first is still working on.
    leaseSeconds: Number(env['WORKER_LEASE_SECONDS'] ?? 60),
    batchSize: Number(env['WORKER_BATCH_SIZE'] ?? 50),
    healthPort: Number(env['WORKER_HEALTH_PORT'] ?? 3002),
    // `defaultMediaRoot()` rather than a path relative to this process, because
    // pnpm gives each workspace package its own working directory: `.media`
    // meant `apps/worker/.media` here and `apps/admin/.media` in the app that
    // has to serve the file back. Two processes disagreeing about where media
    // lives is a library of broken images that each of them can individually
    // prove is fine. An explicit MEDIA_ROOT is still resolved against this
    // process, which is what an operator naming a mounted volume expects.
    mediaRoot: env['MEDIA_ROOT'] ? resolve(env['MEDIA_ROOT']) : defaultMediaRoot(),
    mediaMaxInputBytes: Number(env['MEDIA_MAX_INPUT_BYTES'] ?? 10 * 1024 * 1024),
    mediaMaxInputPixels: Number(env['MEDIA_MAX_INPUT_PIXELS'] ?? 40_000_000),
    mediaMaxDimension: Number(env['MEDIA_MAX_DIMENSION'] ?? 12_000),
    // A section that takes twenty seconds to lay out is a section with something
    // wrong with it, and a job that waits forever is a lease that expires while
    // it waits and a row two workers then hold.
    screenshotTimeoutMs: Number(env['WORKER_SCREENSHOT_TIMEOUT_MS'] ?? 20_000),
  }
}

/** Record invalidation requests. This implementation does not call a CDN. */
export function createCacheInvalidator(): CacheInvalidator {
  return createRecordingCacheInvalidator()
}

/** Use the configured media store for thumbnails. */
export function createMediaStore(config: WorkerConfig): MediaStore {
  return configuredMediaStore({
    ...process.env,
    MEDIA_ROOT: process.env['MEDIA_ROOT'] || (process.env['NODE_ENV'] !== 'production' ? config.mediaRoot : undefined),
  })
}

/**
 * A real browser, launched by the worker because the worker is the package that
 * declares the dependency.
 *
 * @cms/platform implements the screenshot flow and deliberately does not import
 * `playwright`: pnpm's isolated `node_modules` would not resolve it from there,
 * and a browser download has no business attaching itself to the package every
 * app imports for its clock. So the launcher is passed in, and it is dynamic —
 * `import('playwright')` inside the closure — so a worker that never receives a
 * thumbnail event never pays to load it.
 *
 * The two flags are about reproducibility, not speed. Subpixel antialiasing and
 * font hinting are decided by the host's display configuration, so leaving them
 * on means the same definition photographed on two machines produces two PNGs,
 * two digests, and therefore two content-addressed objects for one picture.
 */
export function createScreenshotter(config: WorkerConfig): ManagedScreenshotter {
  return createChromiumScreenshotter({
    timeoutMs: config.screenshotTimeoutMs,
    launch: async () => {
      const { chromium } = await import('playwright')
      return chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] })
    },
  })
}
