// Local implementations of every port. These are not stubs that pretend: the
// media store really writes files, the invalidator really records what it was
// asked to purge, the mailer really keeps the message. That is what lets M0
// and M1 run and be tested end to end before any provider account exists
// (SPEC §3.4, §12).
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import type {
  CacheInvalidator,
  Clock,
  DnsRecord,
  DomainProvisioner,
  Mailer,
  MediaStore,
  Platform,
  Screenshot,
  Screenshotter,
  SignedUpload,
  StoredObject,
} from '../ports.ts'

export const systemClock: Clock = { now: () => new Date() }

/** A clock the tests own, so schedule and lease behaviour is deterministic. */
export function fixedClock(start: Date): Clock & { advance(ms: number): void } {
  let current = start.getTime()
  return {
    now: () => new Date(current),
    advance: ms => {
      current += ms
    },
  }
}

/**
 * Where the filesystem media store keeps its objects when nothing names a path.
 *
 * Derived from this module's own location rather than from the working
 * directory, and that is the whole point. pnpm starts each workspace package
 * with its own directory as the cwd, so a relative default meant the worker
 * wrote thumbnails into `apps/worker/.media` and the admin looked for them in
 * `apps/admin/.media` — two processes each individually correct about where
 * media lives, and a library of broken images between them. A path anchored to
 * the installed package is the same path in both, whoever started them.
 *
 * `MEDIA_ROOT` still overrides it, and a deployment that mounts a volume says
 * so there. This is only what "no configuration" should mean.
 */
export function defaultMediaRoot(): string {
  // …/packages/platform/src/local/index.ts → the repository root.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '.media')
}

export function createFilesystemMediaStore(root: string, baseUrl = '/api/media'): MediaStore {
  const normalizedRoot = resolve(root)
  const pathFor = (objectKey: string) => {
    if (!isSafeObjectKey(objectKey)) throw new Error('media-object-key-invalid')
    const path = resolve(normalizedRoot, objectKey)
    if (!path.startsWith(`${normalizedRoot}/`)) throw new Error('media-object-key-invalid')
    return path
  }
  return {
    async createSignedUpload({
      intentId,
      uploadToken,
      expiresAt,
      maxBytes,
      allowedContentTypes,
    }): Promise<SignedUpload> {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,55}$/i.test(intentId)) {
        throw new Error('media-upload-intent-invalid')
      }
      // The local "signed" capability is an authenticated application route.
      // Its opaque id names a database intent; unlike the old placeholder URL,
      // this route exists, and it exposes neither a filesystem path nor an
      // object key. The receiver re-reads every constraint from the intent.
      return {
        url: `${baseUrl.replace(/\/$/, '')}/uploads/${encodeURIComponent(intentId)}`,
        intentId,
        headers: { 'x-cms-upload-token': uploadToken },
        expiresAt,
        maxBytes,
        allowedContentTypes: [...allowedContentTypes],
      }
    },
    async put(objectKey, body, contentType): Promise<StoredObject> {
      const file = pathFor(objectKey)
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        // Write fully off-path, then create the final name as an atomic hard
        // link. A crash can leave a harmless temp file, never a partial object
        // at a URL the database is about to make ready.
        await writeFile(temporary, body, { flag: 'wx' })
        await link(temporary, file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existing = new Uint8Array(await readFile(file))
        if (!bytesEqual(existing, body)) throw new Error('media-object-key-collision')
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
      return { objectKey, bytes: body.byteLength, contentType }
    },
    async get(objectKey) {
      try {
        return new Uint8Array(await readFile(pathFor(objectKey)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return null
      }
    },
    async remove(objectKey) {
      await rm(pathFor(objectKey), { force: true })
    },
  }
}

/** Narrow enough for every current provider and, importantly, no traversal. */
export function isSafeObjectKey(objectKey: string): boolean {
  if (objectKey.length === 0 || objectKey.length > 1024 || objectKey.includes('\\')) return false
  const segments = objectKey.split('/')
  return (
    segments.length >= 2 &&
    segments.every(
      segment =>
        segment.length > 0 &&
        segment.length <= 128 &&
        segment !== '.' &&
        segment !== '..' &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment),
    )
  )
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let i = 0; i < left.byteLength; i += 1) if (left[i] !== right[i]) return false
  return true
}

export function sha256Hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

export function contentAddressedKey(prefix: string, body: Uint8Array, extension: string): string {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 32)
  return `${prefix}/${hash}${extension}`
}

/**
 * A DomainProvisioner that models the state machine without touching DNS.
 * `advance()` is how tests move a hostname through the same transitions a real
 * provider would report, so the lifecycle is exercised before M5 picks one.
 */
export function createFakeDomainProvisioner(): DomainProvisioner & {
  advance(
    hostname: string,
    state: Parameters<DomainProvisioner['check']> extends never
      ? never
      : 'pending_dns' | 'verifying' | 'issuing_cert' | 'live' | 'error',
  ): void
} {
  const states = new Map<string, 'pending_dns' | 'verifying' | 'issuing_cert' | 'live' | 'error'>()
  return {
    async requiredRecords(hostname: string): Promise<DnsRecord[]> {
      return [{ type: 'A', name: hostname, value: '203.0.113.10' }]
    },
    async attach(hostname) {
      if (!states.has(hostname)) states.set(hostname, 'pending_dns')
      return { providerRef: `fake:${hostname}` }
    },
    async check(hostname) {
      const state = states.get(hostname) ?? 'error'
      return state === 'error'
        ? { state, errorCode: 'not_attached', errorDetail: `${hostname} was never attached` }
        : { state }
    },
    async detach(hostname) {
      states.delete(hostname)
    },
    advance(hostname, state) {
      states.set(hostname, state)
    },
  }
}

export type RecordingCacheInvalidator = CacheInvalidator & {
  readonly calls: readonly { siteId: string; paths: readonly string[]; revision: number }[]
  failNext(times: number): void
}

/**
 * Records what it was told to purge and can be made to fail, because "the
 * publish survives a failed invalidation" is a behaviour that needs a test
 * (SPEC §6.8).
 */
export function createRecordingCacheInvalidator(): RecordingCacheInvalidator {
  const calls: { siteId: string; paths: readonly string[]; revision: number }[] = []
  let failures = 0
  return {
    calls,
    failNext(times) {
      failures = times
    },
    async invalidate(input) {
      if (failures > 0) {
        failures -= 1
        throw new Error(`cache invalidation unavailable for ${input.siteId}`)
      }
      calls.push(input)
    },
  }
}

export type RecordingMailer = Mailer & { readonly sent: readonly { to: string; subject: string; text: string }[] }

export function createRecordingMailer(): RecordingMailer {
  const sent: { to: string; subject: string; text: string }[] = []
  const deliveries = new Map<string, string>()
  return {
    sent,
    async send(message) {
      const previous = message.idempotencyKey ? deliveries.get(message.idempotencyKey) : undefined
      if (previous) return { id: previous }
      sent.push(message)
      const id = randomUUID()
      if (message.idempotencyKey) deliveries.set(message.idempotencyKey, id)
      return { id }
    },
  }
}

// ---------------------------------------------------------- screenshotting

/**
 * The slice of Playwright's browser API the screenshotter below drives.
 *
 * Structural rather than imported, and that is not a stylistic preference.
 * `playwright` is not a dependency of @cms/platform and must not become one:
 * pnpm's isolated `node_modules` means even a dynamic `import('playwright')`
 * from this file resolves against this package's own dependencies and fails, and
 * a browser download is the wrong thing to attach to the package every app
 * imports for its clock. The worker owns the dependency and passes `launch` in.
 * The flow in `createChromiumScreenshotter` is still Playwright's, step for
 * step; only the import lives somewhere else.
 */
export type ScreenshotBrowserPage = {
  locator(selector: string): {
    boundingBox(): Promise<{ width: number; height: number } | null>
    screenshot(options?: {
      type?: 'png'
      animations?: 'disabled'
      caret?: 'hide'
      timeout?: number
    }): Promise<Uint8Array>
  }
  setContent(html: string, options?: { waitUntil?: 'load'; timeout?: number }): Promise<unknown>
  screenshot(options?: {
    type?: 'png'
    fullPage?: boolean
    animations?: 'disabled'
    caret?: 'hide'
    timeout?: number
  }): Promise<Uint8Array>
}

export type ScreenshotBrowserContext = {
  newPage(): Promise<ScreenshotBrowserPage>
  close(): Promise<unknown>
}

export type ScreenshotBrowser = {
  newContext(options?: {
    viewport?: { width: number; height: number }
    deviceScaleFactor?: number
    colorScheme?: 'light'
    reducedMotion?: 'reduce'
    javaScriptEnabled?: boolean
    offline?: boolean
  }): Promise<ScreenshotBrowserContext>
  close(): Promise<unknown>
}

/** A Screenshotter that owns a browser process and has to be told when to stop. */
export type ManagedScreenshotter = Screenshotter & { close(): Promise<void> }

/**
 * A Screenshotter driven by Playwright's Chromium.
 *
 * The browser is launched once and kept, because a thumbnail job is a frequent
 * small unit of work and paying a process launch for each one turns a queue into
 * a fan. Every capture still gets a fresh context: a context is the unit
 * Playwright isolates storage, permissions and viewport in, so reusing one would
 * let a document leave state behind for the next document's picture.
 *
 * The context is created offline and with scripting off. A thumbnail is a
 * picture of markup and a stylesheet, and a document that reaches the network to
 * look right would produce a picture that depends on when it was taken and what
 * answered — which is the opposite of what a content-addressed key is for. The
 * launch flags that make rasterisation reproducible belong to the caller, since
 * this file does not own the launcher.
 *
 * A capture that throws drops the cached browser rather than keeping a handle to
 * a process that may have died, so the next attempt relaunches instead of
 * failing forever on a corpse.
 */
export function createChromiumScreenshotter(options: {
  launch: () => Promise<ScreenshotBrowser>
  timeoutMs?: number
}): ManagedScreenshotter {
  const timeout = options.timeoutMs ?? 20_000
  let browser: ScreenshotBrowser | null = null

  async function browserFor(): Promise<ScreenshotBrowser> {
    if (browser === null) browser = await options.launch()
    return browser
  }

  return {
    async capture({ html, viewport }): Promise<Screenshot> {
      const scale = viewport.deviceScaleFactor ?? 1
      let context: ScreenshotBrowserContext | null = null
      try {
        const active = await browserFor()
        context = await active.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: scale,
          colorScheme: 'light',
          reducedMotion: 'reduce',
          javaScriptEnabled: false,
          offline: true,
        })
        const page = await context.newPage()
        await page.setContent(html, { waitUntil: 'load', timeout })
        const section = viewport.cropToSection ? page.locator('#s0') : null
        const bounds = section ? await section.boundingBox() : null
        if (section && !bounds) throw new Error('thumbnail-section-has-no-bounds')
        const png = section
          ? await section.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', timeout })
          : await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled', caret: 'hide', timeout })
        return {
          png: new Uint8Array(png),
          width: Math.round((bounds?.width ?? viewport.width) * scale),
          height: Math.round((bounds?.height ?? viewport.height) * scale),
          fidelity: 'rendered',
        }
      } catch (error) {
        const dead = browser
        browser = null
        await dead?.close().catch(() => {})
        throw error
      } finally {
        await context?.close().catch(() => {})
      }
    },
    async close() {
      const active = browser
      browser = null
      await active?.close().catch(() => {})
    },
  }
}

/** PNG's CRC-32, table-free: eight shifts per byte is fast enough for a chunk. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length)
  body.set(
    [...type].map(c => c.charCodeAt(0)),
    0,
  )
  body.set(data, 4)
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(body, 4)
  view.setUint32(8 + data.length, crc32(body))
  return chunk
}

/**
 * A truecolour PNG from raw RGB rows.
 *
 * Deliberately the smallest encoder that produces a file every decoder accepts:
 * filter type 0 on every scanline, one IDAT, no ancillary chunks. Nothing here
 * needs to compress well, and a fixed filter is what makes the same pixels
 * produce the same bytes on every run.
 */
function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3))
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour
  return new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...pngChunk('IHDR', header),
    ...pngChunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    ...pngChunk('IEND', new Uint8Array(0)),
  ])
}

/**
 * A Screenshotter for a machine with no browser, which says so in every result.
 *
 * It returns a real PNG of the requested size — a caller that only knows how to
 * handle image bytes still works, and the failure mode of returning zero bytes
 * is a decoder error three layers away from the cause. What it does not do is
 * pretend: every result is `fidelity: 'placeholder'`, and the image itself is a
 * diagonal hatch that no section stylesheet would ever produce, so a placeholder
 * that reaches a screen is recognisable as one without reading any metadata.
 *
 * Deterministic in both senses that matter. The same document always produces
 * the same bytes, so a content-addressed key over the output is stable; and two
 * different documents produce different bytes, because the accent colour is
 * taken from a digest of the HTML. Without the second property a test could not
 * tell "the fallback ran twice on the same input" from "the fallback ignores its
 * input entirely".
 */
export function createPlaceholderScreenshotter(): Screenshotter {
  return {
    async capture({ html, viewport }): Promise<Screenshot> {
      const scale = viewport.deviceScaleFactor ?? 1
      const width = Math.max(1, Math.round(viewport.width * scale))
      const height = Math.max(1, Math.round(viewport.height * scale))
      const digest = createHash('sha256').update(html).digest()

      // Pushed towards mid-grey so the hatch reads as "absent" rather than as a
      // design somebody chose, while still differing per document.
      const accent = [0x60 + (digest[0]! % 0x50), 0x60 + (digest[1]! % 0x50), 0x60 + (digest[2]! % 0x50)] as const
      const base = [0xe6, 0xe6, 0xea] as const

      const rgb = new Uint8Array(width * height * 3)
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const colour = (x + y) % 32 < 8 ? accent : base
          const at = (y * width + x) * 3
          rgb[at] = colour[0]
          rgb[at + 1] = colour[1]
          rgb[at + 2] = colour[2]
        }
      }

      return { png: encodePng(width, height, rgb), width, height, fidelity: 'placeholder' }
    },
  }
}

/**
 * Every port, locally.
 *
 * The screenshotter is the placeholder one, and that is the honest default: this
 * function takes a media root and nothing else, so it has no browser to launch
 * and no way to be handed one. A caller that needs real pictures builds
 * `createChromiumScreenshotter` with its own launcher — which is what the worker
 * does — and everything else here goes on working unchanged, because the
 * fidelity field means nothing downstream has to guess which it got.
 */
export function createLocalPlatform(mediaRoot: string): Platform {
  return {
    clock: systemClock,
    media: createFilesystemMediaStore(mediaRoot),
    domains: createFakeDomainProvisioner(),
    cache: createRecordingCacheInvalidator(),
    mail: createRecordingMailer(),
    screenshots: createPlaceholderScreenshotter(),
  }
}
