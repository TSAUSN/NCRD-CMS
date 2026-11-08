// The screenshot job (SPEC §6.5, D3).
//
// One outbox event, `section_def.thumbnail_requested`, emitted by
// `app.upsert_section_def_version` in the same transaction that inserts the
// version (migration 0028). This handler reads that version, builds the document
// @cms/platform says is a picture of it, screenshots it through the
// `Screenshotter` port, puts the bytes in the `MediaStore` under a
// content-addressed key, and records the key through
// `app.record_section_def_thumbnail`. The library then paints from stored images
// with no live iframes at rest, which is the whole of the acceptance line.
//
// The order of those five steps is the order in which each one becomes
// recoverable. Reading first means a definition that has gone away costs nothing;
// screenshotting before storing means a refusal never leaves an orphaned object;
// storing before recording means `thumbnail_path` never names a key that is not
// there. The reverse of that last one is the interesting failure: a column
// pointing at a missing object is a broken image on every card. A retry must
// check the object as well as the marker before treating the picture as done.
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import {
  buildThumbnailDocument,
  contentAddressedKey,
  embedThumbnailFiles,
  thumbnailMediaIds,
  THUMBNAIL_VIEWPORT,
  type MediaStore,
  type Screenshotter,
  type ThumbnailFile,
} from '@cms/platform'
import type { SectionDefView, SiteShell } from '@cms/renderer'
import { PermanentJobError, withWorkerSession, type EventHandler, type OutboxEvent } from './handlers.ts'

/**
 * The event type, spelled once.
 *
 * `<entity>.<past participle>` like `page.published` beside it, and the entity is
 * the definition rather than the version because that is what `outbox.payload`
 * has to name for a human reading a dead-lettered row.
 */
export const SECTION_THUMBNAIL_EVENT = 'section_def.thumbnail_requested'

/** The image dimensions, so `deviceScaleFactor` is decided in one place. */
export { THUMBNAIL_VIEWPORT }

/** The columns `app.section_def_version_for_thumbnail` returns. */
type ThumbnailSourceRow = {
  section_def_id: string
  version: number
  slug: string
  name: string
  compiled_ast: unknown
  compiled_css: string | null
  slots: unknown
  render_hash: string | null
  sanitizer_policy_version: number | null
  css_policy_version: number | null
  definition_kind: string | null
  structured_doc: unknown
  structured_schema_version: number | null
  thumbnail_path: string | null
  theme: SiteShell['theme'] | null
}

/**
 * The stable codes this job refuses with.
 *
 * Exported because a code that only appears inside a thrown string is a code
 * nothing can branch on and no test can assert without matching prose. The
 * refusals that come from the document builder keep *its* codes instead — a
 * `thumbnail-definition-unrenderable` reaching an operator should say the same
 * thing whichever layer noticed it.
 */
const THUMBNAIL_CODES = {
  payload: 'thumbnail-payload-unusable',
  missing: 'thumbnail-definition-missing',
  unidentifiable: 'thumbnail-version-has-no-render-hash',
  notRendered: 'thumbnail-screenshotter-has-no-browser',
  empty: 'thumbnail-screenshot-is-empty',
} as const

function refuse(code: string, sentence: string): string {
  return `${code} — ${sentence}`
}

/** Lowercase, because the identifier is also a segment of an object key. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The prefix every image of one stored version shares.
 *
 * Content-addressed, and addressed by more than the content: the digest of the
 * PNG is what makes the key immutable, and the three segments in front of it are
 * what make the key *legible* and what let a second delivery recognise its own
 * earlier work without a column to remember it in. `render_hash` is in there
 * because it is the identity of what was photographed — two thumbnails of the
 * same version under two different render hashes are pictures of two different
 * sections, and migration 0018 exists precisely because a version's artifacts can
 * be rewritten underneath it.
 *
 * Digested rather than used as it stands. `render_hash` is an opaque identity
 * the compiler chose — sha256 hex today, and nothing in the schema says it has
 * to stay that — while a key has to live inside the narrow grammar
 * `app.record_section_def_thumbnail` enforces. Filtering the string down to the
 * characters that grammar allows was the first attempt and it was wrong in the
 * quiet direction: `hash-hero-1` filters down to three characters, so two
 * unrelated versions could collide on a prefix and each would think the other's
 * picture was its own. A digest is key-safe for every possible value and keeps
 * the one property that matters — different artifacts, different prefix.
 */
/**
 * Which way of drawing a card a picture was taken with. Part of the key, so
 * changing the recipe makes every older picture stale to the guard and the
 * next request retakes it. 2: the site's fonts and the section's own pictures
 * and sample words are embedded (migration 0106).
 */
const THUMBNAIL_RECIPE = 2

export function thumbnailKeyPrefix(sectionDefId: string, version: number, renderHash: string): string | null {
  if (renderHash.trim() === '') return null
  const identity = createHash('sha256')
    .update(`${renderHash}\u0000recipe-${THUMBNAIL_RECIPE}`)
    .digest('hex')
    .slice(0, 16)
  return `section-thumbnails/${sectionDefId}/v${version}/${identity}`
}

/** The row, as the renderer's view of a stored definition. */
function defViewFor(row: ThumbnailSourceRow): SectionDefView {
  return {
    section_def_id: row.section_def_id,
    version: row.version,
    slug: row.slug,
    compiled_ast: row.compiled_ast as SectionDefView['compiled_ast'],
    css: row.compiled_css ?? '',
    css_policy_version: row.css_policy_version,
    sanitizer_policy_version: row.sanitizer_policy_version,
    slots: (Array.isArray(row.slots) ? row.slots : []) as SectionDefView['slots'],
    definition_kind: row.definition_kind,
    structured_doc: row.structured_doc,
    structured_schema_version: row.structured_schema_version,
  }
}

export type ThumbnailDeps = {
  pool: Pool
  workerId: string
  media: MediaStore
  screenshots: Screenshotter
}

/**
 * Take one section definition version's picture.
 *
 * IDEMPOTENCY: `guarded`, and the guard is the object key prefix.
 *
 * This is not `natural` and the difference is not academic. Repeating the job
 * runs a browser again, and a browser is not a pure function of its input: a
 * font cache, a GPU path, a Chromium point release, and the same document
 * produces a PNG that differs in a handful of bytes. The key is a digest of
 * those bytes, so a second delivery of an event whose first delivery succeeded
 * would store a *second* object, move `thumbnail_path` to it, and write a second
 * audit row saying the thumbnail changed — for a version that is immutable and a
 * picture nobody can tell apart from the first. Multiply that by a redelivery
 * storm and the library's storage grows without anything having changed.
 *
 * So the durable marker is read before any work happens: `thumbnail_path` as the
 * database has it, compared against the prefix derived from this version's
 * current `render_hash`. A path already under that prefix means this exact job
 * has already been done when the stored object still exists and is nonempty;
 * the handler then returns without launching a browser. Missing or empty objects
 * are photographed again so a restored database can repair its library. A path
 * under a *different* prefix means the artifacts were rewritten since (migration 0018's revalidation does exactly that), and the
 * picture is genuinely stale and worth retaking.
 *
 * The command behind the last step refuses a no-op independently, which is the
 * belt to this brace: if two workers do race, whichever lands second finds its
 * own key already stored and records nothing.
 */
export function sectionThumbnailHandler(deps: ThumbnailDeps): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event: OutboxEvent) {
      const sectionDefId = event.payload['section_def_id']
      const version = event.payload['version']
      // The uuid shape is checked here rather than left to the cast inside the
      // read. Postgres raises 22P02 for a malformed uuid, which is not in the
      // permanent set, so a payload that could never be a uuid would be retried
      // until `max_attempts` gave up instead of being refused on sight. It is
      // also concatenated into an object key a few lines down, and a key is a
      // path in the filesystem store.
      if (
        typeof sectionDefId !== 'string' ||
        !UUID.test(sectionDefId) ||
        typeof version !== 'number' ||
        !Number.isInteger(version) ||
        version < 1
      ) {
        throw new PermanentJobError(
          refuse(THUMBNAIL_CODES.payload, `event ${event.id} does not name a section definition version to photograph`),
        )
      }

      const row = await withWorkerSession(deps.pool, deps.workerId, async client => {
        const { rows } = await client.query<ThumbnailSourceRow>(
          'SELECT * FROM app.section_def_version_for_thumbnail($1,$2)',
          [sectionDefId, version],
        )
        return rows[0] ?? null
      })

      if (!row) {
        // Deleting a definition cascades its versions away, and an event for one
        // that is gone will never become deliverable by waiting.
        throw new PermanentJobError(
          refuse(THUMBNAIL_CODES.missing, `section definition ${sectionDefId} v${version} no longer exists`),
        )
      }

      const prefix = thumbnailKeyPrefix(sectionDefId, version, row.render_hash ?? '')
      if (prefix === null) {
        throw new PermanentJobError(
          refuse(
            THUMBNAIL_CODES.unidentifiable,
            `section definition ${row.slug} v${version} has no usable render hash, so there is no ` +
              'stable key its picture could be stored under',
          ),
        )
      }

      // A database marker alone cannot prove that a restored store has the file.
      // Let read failures retry; only a confirmed missing/empty object needs repair.
      if (row.thumbnail_path !== null && row.thumbnail_path.startsWith(`${prefix}/`)) {
        const stored = await deps.media.get(row.thumbnail_path)
        if (stored?.byteLength) return
      }

      const resources = await resourcesFor(deps, sectionDefId, version, [])
      const fonts = resources.fonts
      const built = buildThumbnailDocument({
        def: defViewFor(row),
        theme: row.theme,
        values: resources.values,
        fonts: fonts.map(font => ({ assetId: font.assetId, fontKey: font.fontKey })),
      })
      if (!built.ok) {
        // Every one of these is fixed by a person editing the definition, never
        // by the queue trying again.
        throw new PermanentJobError(refuse(built.refusal.code, built.refusal.message))
      }

      const html = await embedResources(deps, sectionDefId, version, built.html, fonts)
      const shot = await deps.screenshots.capture({ html, viewport: built.viewport })

      // The fallback screenshotter announces itself, and this is the reason it
      // has to. Storing placeholder bytes under `thumbnail_path` would put a
      // hatched rectangle on a library card and mark the job done, and nothing
      // afterwards could tell that card from one whose section genuinely looks
      // like that. Retryable rather than permanent: the machine that grows a
      // browser tomorrow should get the picture on the next attempt, and a
      // deployment that never grows one lets `max_attempts` dead-letter the row,
      // which is a queue an operator can see rather than a library nobody can
      // trust.
      if (shot.fidelity !== 'rendered') {
        throw new Error(
          refuse(
            THUMBNAIL_CODES.notRendered,
            `this worker has no browser, so ${row.slug} v${version} has no picture — the screenshotter ` +
              `returned ${shot.fidelity} bytes and those are not what a library card is`,
          ),
        )
      }
      if (shot.png.byteLength === 0) {
        throw new Error(
          refuse(THUMBNAIL_CODES.empty, `the screenshotter returned no bytes for ${row.slug} v${version}`),
        )
      }

      const objectKey = contentAddressedKey(prefix, shot.png, '.png')
      // Stored before recorded. A key in the column that names nothing in the
      // store is a broken image on every card and a row that already looks done.
      await deps.media.put(objectKey, shot.png, 'image/png')

      await withWorkerSession(deps.pool, deps.workerId, async client => {
        await client.query('SELECT app.record_section_def_thumbnail($1,$2,$3)', [sectionDefId, version, objectKey])
      })
    },
  }
}

type ResourceFont = { assetId: string; fontKey: string; objectKey: string; mimeType: string; bytes: number }
type ResourceMedia = {
  mediaId: string
  kind: string
  objectKey: string
  mimeType: string
  bytes: number
  width: number | null
}

/** The definition's site's fonts, a page of that site's values for this
 * version, and, of `media`, the ready renditions of that site's pictures
 * (`app.thumbnail_resources`, migration 0106). */
async function resourcesFor(deps: ThumbnailDeps, sectionDefId: string, version: number, media: string[]) {
  const row = await withWorkerSession(
    deps.pool,
    deps.workerId,
    async client =>
      (
        await client.query<{
          resources: { fonts: ResourceFont[]; media: ResourceMedia[]; values: Record<string, unknown> }
        }>('SELECT app.thumbnail_resources($1,$2,$3::uuid[]) AS resources', [sectionDefId, version, media])
      ).rows[0],
  )
  const values = row?.resources?.values
  return {
    fonts: row?.resources?.fonts ?? [],
    media: row?.resources?.media ?? [],
    values: values && typeof values === 'object' && !Array.isArray(values) ? values : {},
  }
}

// A card is drawn about 1200px wide, so the 960px rendition is plenty; the
// limits keep one picture's document small whatever a store holds.
const RENDITIONS = ['card', 'wide', 'thumbnail', 'original'] as const
const IMAGE_BYTES = 2 * 1024 * 1024,
  FONT_BYTES = 1024 * 1024

/**
 * Embed the site's fonts and the section's own pictures as data, read from the
 * media store, so the offline capture draws the section as it publishes. A
 * file that is missing or too large is left out, and its picture stands in.
 */
async function embedResources(
  deps: ThumbnailDeps,
  sectionDefId: string,
  version: number,
  html: string,
  fonts: ResourceFont[],
): Promise<string> {
  const read = async (key: string, limit: number, mimeType: string): Promise<ThumbnailFile | null> => {
    const bytes = await deps.media.get(key)
    return bytes && bytes.byteLength > 0 && bytes.byteLength <= limit ? { mimeType, bytes } : null
  }
  const assets = new Map<string, ThumbnailFile>()
  for (const font of fonts) {
    if (font.bytes > FONT_BYTES) continue
    const file = await read(font.objectKey, FONT_BYTES, font.mimeType)
    if (file) assets.set(font.assetId.toLowerCase(), file)
  }
  const media = new Map<string, ThumbnailFile>()
  const ids = thumbnailMediaIds(html)
  if (ids.length) {
    const renditions = (await resourcesFor(deps, sectionDefId, version, ids)).media
    for (const id of ids) {
      for (const kind of RENDITIONS) {
        const rendition = renditions.find(
          candidate => candidate.mediaId.toLowerCase() === id && candidate.kind === kind,
        )
        if (!rendition || rendition.bytes > IMAGE_BYTES) continue
        const file = await read(rendition.objectKey, IMAGE_BYTES, rendition.mimeType)
        if (file) {
          media.set(id, file)
          break
        }
      }
    }
  }
  return embedThumbnailFiles(html, { media, assets })
}

/**
 * The handler a process with no screenshotter registers in its place.
 *
 * `jobs:drain` is the one-shot role: it exists to empty a queue on a machine
 * that is not running a browser. Leaving the event type unregistered would make
 * `drainOutbox` dead-letter it immediately — "an event type nobody handles will
 * never be handled by waiting" is true of the *deployment*, not of the event —
 * and a drain run would quietly destroy the thumbnail work of every definition
 * saved since the last one. Refusing retryably leaves the row for the long-running
 * worker, which does have a browser, and still lets `max_attempts` end it if
 * nothing in the estate ever picks it up.
 */
export function unconfiguredThumbnailHandler(): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event: OutboxEvent) {
      throw new Error(
        refuse(
          THUMBNAIL_CODES.notRendered,
          `this process has no screenshotter configured, so event ${event.id} is left for one that has`,
        ),
      )
    },
  }
}
