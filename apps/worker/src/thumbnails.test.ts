// The thumbnail job's own behaviour, with a fake database, a fake store and a
// fake camera (SPEC §6.5, D3).
//
// Everything asserted here is about the handler's decisions rather than about
// pictures: what it refuses, what it stores, what it records, and — the one that
// matters most under at-least-once delivery — what a second delivery does. The
// database side of the same feature is proved against a real Postgres in
// test/section-thumbnails.db.test.ts; a fake that says "allowed" proves nothing
// about a grant.
import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION, compileSection, sectionScopeSelector } from '@cms/renderer'
import type { MediaStore, Screenshot, Screenshotter } from '@cms/platform'
import { createPlaceholderScreenshotter } from '@cms/platform'
import { PermanentJobError, defaultHandlers, type OutboxEvent } from './handlers.ts'
import { SECTION_THUMBNAIL_EVENT, sectionThumbnailHandler, thumbnailKeyPrefix } from './thumbnails.ts'

const DEF_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
const RENDER_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f901122334455667788990011223344556'

function sourceRow(overrides: Record<string, unknown> = {}) {
  const slug = 'hero'
  const compiled = compileSection({
    sourceHtml: '<section class="hero"><h1>{{heading}}</h1></section>',
    sourceCss: '.hero{padding:4rem}',
    slots: [{ id: 'heading', kind: 'text', label: 'Headline', constraints: {} }],
    scopeSelector: sectionScopeSelector(slug) ?? undefined,
  })
  return {
    section_def_id: DEF_ID,
    version: 2,
    slug,
    name: 'Hero',
    compiled_ast: compiled.ast,
    compiled_css: compiled.css,
    slots: [{ id: 'heading', kind: 'text', label: 'Headline', constraints: {} }],
    render_hash: RENDER_HASH,
    sanitizer_policy_version: SANITIZER_POLICY_VERSION,
    css_policy_version: CSS_POLICY_VERSION,
    definition_kind: 'legacy',
    structured_doc: null,
    structured_schema_version: null,
    thumbnail_path: null,
    theme: null,
    ...overrides,
  }
}

type Call = { sql: string; params: readonly unknown[] }

/**
 * A pool that answers the two statements this handler issues and records every
 * statement it was asked for, so "did not touch the database" is assertable
 * rather than assumed.
 */
function fakePool(row: Record<string, unknown> | null): Pool & { calls: Call[] } {
  const calls: Call[] = []
  const client = {
    async query(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params })
      if (sql.includes('section_def_version_for_thumbnail')) return { rows: row ? [row] : [] }
      return { rows: [{}] }
    },
    release() {},
  }
  return { calls, connect: async () => client } as unknown as Pool & { calls: Call[] }
}

function fakeMedia(): MediaStore & { put: MediaStore['put']; stored: Map<string, Uint8Array> } {
  const stored = new Map<string, Uint8Array>()
  return {
    stored,
    async createSignedUpload() {
      throw new Error('not used')
    },
    async put(objectKey, body, contentType) {
      stored.set(objectKey, body)
      return { objectKey, bytes: body.byteLength, contentType }
    },
    async get(objectKey) {
      return stored.get(objectKey) ?? null
    },
    async remove(objectKey) {
      stored.delete(objectKey)
    },
  } as MediaStore & { stored: Map<string, Uint8Array> }
}

/** A camera that claims a real render, so the happy path needs no browser. */
function fakeCamera(bytes = new Uint8Array([1, 2, 3, 4])): Screenshotter & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    async capture({ html, viewport }): Promise<Screenshot> {
      seen.push(html)
      return {
        png: bytes,
        width: viewport.width,
        height: viewport.height,
        fidelity: 'rendered',
      }
    },
  }
}

function event(payload: Record<string, unknown>): OutboxEvent {
  return {
    id: '77',
    site_id: null,
    event_type: SECTION_THUMBNAIL_EVENT,
    payload,
    attempts: 1,
    lease_token: 'lease',
  }
}

const recorded = (pool: Pool & { calls: Call[] }) =>
  pool.calls.filter(c => c.sql.includes('record_section_def_thumbnail'))

describe("taking one section definition version's picture", () => {
  it('is guarded, because a browser is not a pure function of its input', () => {
    // The declaration itself, since `drainOutbox` refuses to deliver an event
    // type whose handler has not made this claim.
    const handler = sectionThumbnailHandler({
      pool: fakePool(sourceRow()),
      workerId: 'w1',
      media: fakeMedia(),
      screenshots: fakeCamera(),
    })
    expect(handler.idempotency).toBe('guarded')
  })

  it('stores the bytes under a content-addressed key and records that key', async () => {
    const pool = fakePool(sourceRow())
    const media = fakeMedia()
    const handler = sectionThumbnailHandler({ pool, workerId: 'w1', media, screenshots: fakeCamera() })

    await handler.handle(event({ section_def_id: DEF_ID, version: 2 }))

    const [key] = [...media.stored.keys()]
    expect(key).toMatch(new RegExp(`^section-thumbnails/${DEF_ID}/v2/[0-9a-f]{16}/[0-9a-f]{32}\\.png$`))
    expect(key!.startsWith(`${thumbnailKeyPrefix(DEF_ID, 2, RENDER_HASH)}/`)).toBe(true)
    expect(recorded(pool)).toHaveLength(1)
    expect(recorded(pool)[0]!.params).toEqual([DEF_ID, 2, key])
  })

  it("photographs the published section, not the editor's view of it", async () => {
    const camera = fakeCamera()
    const handler = sectionThumbnailHandler({
      pool: fakePool(sourceRow()),
      workerId: 'w1',
      media: fakeMedia(),
      screenshots: camera,
    })
    await handler.handle(event({ section_def_id: DEF_ID, version: 2 }))
    expect(camera.seen[0]).not.toContain('data-cms-')
    expect(camera.seen[0]).not.toContain('<script')
  })

  it('keys on the render hash, so a revalidated version is photographed again', () => {
    const before = thumbnailKeyPrefix(DEF_ID, 2, RENDER_HASH)
    const after = thumbnailKeyPrefix(DEF_ID, 2, `f${RENDER_HASH.slice(1)}`)
    expect(after).not.toBe(before)
  })

  it('keys any render hash a row can hold, not only a hex one', () => {
    // `hash-hero-1` is a real value in this repository's fixtures. Filtering the
    // string down to key-safe characters left three of them, which is short
    // enough for two unrelated versions to collide on a prefix and each mistake
    // the other's picture for its own.
    const a = thumbnailKeyPrefix(DEF_ID, 1, 'hash-hero-1')
    const b = thumbnailKeyPrefix(DEF_ID, 1, 'hash-other-1')
    expect(a).toMatch(/\/[0-9a-f]{16}$/)
    expect(a).not.toBe(b)
  })
})

describe('a second delivery', () => {
  it('does nothing at all when the stored picture is already of these artifacts', async () => {
    // At-least-once means this event WILL arrive twice. The first delivery's key
    // is under the prefix derived from this version's render hash, so the second
    // recognises its own earlier work before launching anything.
    const path = `${thumbnailKeyPrefix(DEF_ID, 2, RENDER_HASH)}/${'a'.repeat(32)}.png`
    const pool = fakePool(sourceRow({ thumbnail_path: path }))
    const media = fakeMedia()
    const stored = new Uint8Array([1, 2, 3, 4])
    media.stored.set(path, stored)
    const camera = fakeCamera()

    await sectionThumbnailHandler({ pool, workerId: 'w1', media, screenshots: camera }).handle(
      event({ section_def_id: DEF_ID, version: 2 }),
    )

    expect(camera.seen).toEqual([])
    expect([...media.stored.keys()]).toEqual([path])
    expect(media.stored.get(path)).toBe(stored)
    expect(recorded(pool)).toEqual([])
  })

  it.each([
    { name: 'missing', bytes: null },
    { name: 'empty', bytes: new Uint8Array() },
  ])('repairs a $name stored picture once, then recognizes the restored object', async ({ bytes }) => {
    const path = `${thumbnailKeyPrefix(DEF_ID, 2, RENDER_HASH)}/${'a'.repeat(32)}.png`
    const row: Record<string, unknown> = sourceRow({ thumbnail_path: path })
    const pool = fakePool(row)
    const media = fakeMedia()
    const camera = fakeCamera()
    if (bytes) media.stored.set(path, bytes)
    const handler = sectionThumbnailHandler({ pool, workerId: 'w1', media, screenshots: camera })

    await handler.handle(event({ section_def_id: DEF_ID, version: 2 }))

    expect(camera.seen).toHaveLength(1)
    expect(recorded(pool)).toHaveLength(1)
    const repairedPath = recorded(pool)[0]!.params[2] as string
    expect(media.stored.get(repairedPath)?.byteLength).toBeGreaterThan(0)
    row.thumbnail_path = repairedPath
    await handler.handle(event({ section_def_id: DEF_ID, version: 2 }))
    expect(camera.seen).toHaveLength(1)
    expect(recorded(pool)).toHaveLength(1)
  })

  it('retries a storage read failure without replacing the recorded picture', async () => {
    const path = `${thumbnailKeyPrefix(DEF_ID, 2, RENDER_HASH)}/${'a'.repeat(32)}.png`
    const pool = fakePool(sourceRow({ thumbnail_path: path }))
    const media = fakeMedia()
    media.get = async () => {
      throw new Error('Storage is temporarily unavailable')
    }
    const camera = fakeCamera()

    await expect(
      sectionThumbnailHandler({ pool, workerId: 'w1', media, screenshots: camera }).handle(
        event({ section_def_id: DEF_ID, version: 2 }),
      ),
    ).rejects.toThrow('Storage is temporarily unavailable')
    expect(camera.seen).toEqual([])
    expect(recorded(pool)).toEqual([])
  })

  it('retakes the picture when the artifacts were rewritten under it', async () => {
    // Migration 0018 rewrites a stored version's compiled artifacts in place, so
    // a path under a different render hash is a picture of a section that no
    // longer exists.
    const stale = `section-thumbnails/${DEF_ID}/v2/0000000000000000/${'b'.repeat(32)}.png`
    const pool = fakePool(sourceRow({ thumbnail_path: stale }))
    const media = fakeMedia()

    await sectionThumbnailHandler({ pool, workerId: 'w1', media, screenshots: fakeCamera() }).handle(
      event({ section_def_id: DEF_ID, version: 2 }),
    )

    expect([...media.stored.keys()]).toHaveLength(1)
    expect(recorded(pool)).toHaveLength(1)
  })

  it('converges on one object when the picture comes out identical', async () => {
    // Two deliveries whose captures agree byte for byte produce one key, which is
    // the property the content-addressed prefix buys and the reason the command
    // behind the last step refuses a no-op.
    const media = fakeMedia()
    const run = () =>
      sectionThumbnailHandler({
        pool: fakePool(sourceRow()),
        workerId: 'w1',
        media,
        screenshots: fakeCamera(),
      }).handle(event({ section_def_id: DEF_ID, version: 2 }))
    await run()
    await run()
    expect([...media.stored.keys()]).toHaveLength(1)
  })
})

describe('what it refuses, and how loudly', () => {
  it('refuses a placeholder capture rather than storing a fake picture', async () => {
    const pool = fakePool(sourceRow())
    const media = fakeMedia()
    const handler = sectionThumbnailHandler({
      pool,
      workerId: 'w1',
      media,
      screenshots: createPlaceholderScreenshotter(),
    })

    await expect(handler.handle(event({ section_def_id: DEF_ID, version: 2 }))).rejects.toThrow(
      /thumbnail-screenshotter-has-no-browser/,
    )
    // Nothing stored and nothing recorded: a hatched rectangle on a card that
    // the database calls done is worse than a card with no picture.
    expect([...media.stored.keys()]).toEqual([])
    expect(recorded(pool)).toEqual([])
  })

  it('leaves a missing browser retryable, so installing one is enough to fix it', async () => {
    const handler = sectionThumbnailHandler({
      pool: fakePool(sourceRow()),
      workerId: 'w1',
      media: fakeMedia(),
      screenshots: createPlaceholderScreenshotter(),
    })
    const error = await handler.handle(event({ section_def_id: DEF_ID, version: 2 })).catch(e => e)
    expect(error).not.toBeInstanceOf(PermanentJobError)
  })

  it('permanently refuses a payload that names no version', async () => {
    const handler = sectionThumbnailHandler({
      pool: fakePool(sourceRow()),
      workerId: 'w1',
      media: fakeMedia(),
      screenshots: fakeCamera(),
    })
    await expect(handler.handle(event({ section_def_id: DEF_ID }))).rejects.toThrow(/thumbnail-payload-unusable/)
    await expect(handler.handle(event({ section_def_id: DEF_ID }))).rejects.toBeInstanceOf(PermanentJobError)
  })

  it('permanently refuses an id that is not a uuid, rather than retrying a cast error', async () => {
    // Postgres answers a malformed uuid with 22P02, which is not in the
    // permanent set — so leaving the check to the cast would retry this until
    // max_attempts. The same value is also a segment of an object key.
    const handler = sectionThumbnailHandler({
      pool: fakePool(sourceRow()),
      workerId: 'w1',
      media: fakeMedia(),
      screenshots: fakeCamera(),
    })
    await expect(handler.handle(event({ section_def_id: '../../etc', version: 1 }))).rejects.toBeInstanceOf(
      PermanentJobError,
    )
  })

  it('permanently refuses a definition that has gone away', async () => {
    const handler = sectionThumbnailHandler({
      pool: fakePool(null),
      workerId: 'w1',
      media: fakeMedia(),
      screenshots: fakeCamera(),
    })
    await expect(handler.handle(event({ section_def_id: DEF_ID, version: 2 }))).rejects.toThrow(
      /thumbnail-definition-missing/,
    )
  })

  it('permanently refuses a version with no usable render hash', async () => {
    const handler = sectionThumbnailHandler({
      pool: fakePool(sourceRow({ render_hash: '' })),
      workerId: 'w1',
      media: fakeMedia(),
      screenshots: fakeCamera(),
    })
    await expect(handler.handle(event({ section_def_id: DEF_ID, version: 2 }))).rejects.toThrow(
      /thumbnail-version-has-no-render-hash/,
    )
    expect(thumbnailKeyPrefix(DEF_ID, 2, '')).toBeNull()
  })

  it("passes the document builder's own refusal through, code and all", async () => {
    const handler = sectionThumbnailHandler({
      pool: fakePool(sourceRow({ css_policy_version: CSS_POLICY_VERSION - 1 })),
      workerId: 'w1',
      media: fakeMedia(),
      screenshots: fakeCamera(),
    })
    // Not re-worded here. The same defect should read the same way whichever
    // layer noticed it.
    await expect(handler.handle(event({ section_def_id: DEF_ID, version: 2 }))).rejects.toThrow(
      /thumbnail-definition-unrenderable/,
    )
  })

  it("composes a key the recording command's grammar accepts", async () => {
    // `app.record_section_def_thumbnail` refuses anything outside this shape, and
    // a key it refuses is a screenshot taken, stored, and thrown away every pass.
    const pool = fakePool(sourceRow())
    const media = fakeMedia()
    await sectionThumbnailHandler({ pool, workerId: 'w1', media, screenshots: fakeCamera() }).handle(
      event({ section_def_id: DEF_ID, version: 2 }),
    )
    const key = [...media.stored.keys()][0]!
    expect(key).toMatch(/^[a-z0-9][a-z0-9._/-]{0,255}$/)
    expect(key).not.toContain('..')
  })
})

describe('a process with no screenshotter', () => {
  it('registers the event type anyway, so a drain run cannot dead-letter it', () => {
    // An unhandled type is dead-lettered on sight. `jobs:drain` runs where there
    // is no browser, and without this it would destroy the thumbnail work of
    // every definition saved since the last run.
    const handlers = defaultHandlers({ async invalidate() {} })
    expect(handlers.has(SECTION_THUMBNAIL_EVENT)).toBe(true)
  })

  it('refuses retryably, leaving the row for a process that has one', async () => {
    const handler = defaultHandlers({ async invalidate() {} }).get(SECTION_THUMBNAIL_EVENT)!
    const error = await handler.handle(event({ section_def_id: DEF_ID, version: 2 })).catch(e => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(PermanentJobError)
    expect((error as Error).message).toMatch(/thumbnail-screenshotter-has-no-browser/)
  })
})

describe('a card drawn the way the site publishes it', () => {
  // V1's library cards show the section's own photograph in the site's
  // typefaces (references 18/19). The capture stays offline: the handler reads
  // the files from the store and embeds them.
  const MEDIA = '9cb8478b-1790-4826-a79f-946ad9d46805',
    FONT = '58c8cac6-b0be-4e6b-ab86-7590154c2e86'
  function withResources(row: Record<string, unknown>) {
    const pool = fakePool(row)
    const connect = pool.connect.bind(pool)
    ;(pool as unknown as { connect: () => Promise<unknown> }).connect = async () => {
      const client = (await connect()) as {
        query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>
      }
      const query = client.query.bind(client)
      client.query = async (sql, params = []) => {
        if (!sql.includes('thumbnail_resources')) return query(sql, params)
        pool.calls.push({ sql, params })
        const requested = (params[2] as string[]) ?? []
        return {
          rows: [
            {
              resources: {
                fonts: [
                  {
                    assetId: FONT,
                    fontKey: 'trajan-regular',
                    objectKey: 'site-assets/font',
                    mimeType: 'font/otf',
                    bytes: 4,
                  },
                ],
                media: requested.includes(MEDIA)
                  ? [
                      {
                        mediaId: MEDIA,
                        kind: 'original',
                        objectKey: 'media/original',
                        mimeType: 'image/jpeg',
                        bytes: 5,
                        width: 4000,
                      },
                      {
                        mediaId: MEDIA,
                        kind: 'card',
                        objectKey: 'media/card',
                        mimeType: 'image/webp',
                        bytes: 3,
                        width: 960,
                      },
                    ]
                  : [],
              },
            },
          ],
        }
      }
      return client
    }
    return pool
  }

  it("embeds the site's fonts and the section's own picture, using the card-sized rendition", async () => {
    const slug = 'hero'
    const compiled = compileSection({
      sourceHtml: `<section class="hero"><img src="/media/${MEDIA}/original" alt=""><h1>{{heading}}</h1></section>`,
      sourceCss: '.hero{padding:4rem;font-family:"Trajan Pro 3",serif}',
      slots: [{ id: 'heading', kind: 'text', label: 'Headline', constraints: { sourceSample: 'Echelon Symposium' } }],
      scopeSelector: sectionScopeSelector(slug) ?? undefined,
    })
    const pool = withResources(
      sourceRow({
        compiled_ast: compiled.ast,
        compiled_css: compiled.css,
        slots: [{ id: 'heading', kind: 'text', label: 'Headline', constraints: { sourceSample: 'Echelon Symposium' } }],
      }),
    )
    const media = fakeMedia()
    media.stored.set('site-assets/font', new Uint8Array([1, 2, 3, 4]))
    media.stored.set('media/card', new Uint8Array([9, 9, 9]))
    media.stored.set('media/original', new Uint8Array([7, 7, 7, 7, 7]))
    const camera = fakeCamera()
    await sectionThumbnailHandler({ pool, workerId: 'w', media, screenshots: camera }).handle(
      event({ section_def_id: DEF_ID, version: 2 }),
    )
    const html = camera.seen[0]!
    expect(html).toContain(
      `@font-face{font-family:'Trajan Pro 3';src:url('data:font/otf;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}')`,
    )
    expect(html).toContain(`<img src="data:image/webp;base64,${Buffer.from([9, 9, 9]).toString('base64')}"`)
    expect(html).not.toMatch(/\/media\/|\/assets\//)
    // The section's own words, not its field's name.
    expect(html).toContain('Echelon Symposium')
    expect(html).not.toContain('Headline')
    // Only the pictures the card shows were asked for.
    expect(pool.calls.filter(c => c.sql.includes('thumbnail_resources')).map(c => [c.params[1], c.params[2]])).toEqual([
      [2, []],
      [2, [MEDIA]],
    ])
  })

  it('leaves a picture it cannot read as a stand-in block rather than a broken image', async () => {
    const compiled = compileSection({
      sourceHtml: `<section class="hero"><img src="/media/${MEDIA}/original" alt=""><h1>{{heading}}</h1></section>`,
      sourceCss: '.hero{padding:4rem}',
      slots: [{ id: 'heading', kind: 'text', label: 'Headline', constraints: {} }],
      scopeSelector: sectionScopeSelector('hero') ?? undefined,
    })
    const camera = fakeCamera()
    await sectionThumbnailHandler({
      pool: withResources(sourceRow({ compiled_ast: compiled.ast, compiled_css: compiled.css })),
      workerId: 'w',
      media: fakeMedia(),
      screenshots: camera,
    }).handle(event({ section_def_id: DEF_ID, version: 2 }))
    expect(camera.seen[0]).toContain(`<img src="/media/${MEDIA}/original"`)
    expect(camera.seen[0]).toContain('.cms-thumbnail img:not([src^="data:"]){content:linear-gradient')
  })

  it('names the picture recipe in the key, so older pictures are retaken', () => {
    expect(thumbnailKeyPrefix(DEF_ID, 2, RENDER_HASH)).toMatch(/^section-thumbnails\/[0-9a-f-]+\/v2\/[0-9a-f]{16}$/)
  })
})
