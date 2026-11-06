// Media is a database lifecycle, not a row-shaped promise that a processor
// exists.  These tests exercise the real application/worker/public roles over
// Postgres: capability secrecy, tenant isolation, inspection, immutable usage,
// destructive authorization and delivery resolution all meet at this boundary.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
let siteAdminA = ''

type Intent = {
  intent_id: string
  upload_token: string
  upload_object_key: string
  final_key_prefix: string
  expires_at: Date
  max_bytes: string
  allowed_content_type: string
}

type Receipt = {
  receipt_token: string
  upload_object_key: string
  declared_bytes: string
  max_bytes: string
  allowed_content_type: string
  expires_at: Date
}

type Ready = {
  intent: Intent
  mediaId: string
  finalKey: string
  variants: Array<Record<string, unknown>>
}

const ORIGINAL_HASH = 'a'.repeat(64)
const CARD_HASH = 'b'.repeat(64)
const THUMBNAIL_HASH = 'c'.repeat(64)
const WIDE_HASH = 'd'.repeat(64)

function cardVariant(prefix: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'card',
    object_key: `${prefix}variants/card/${CARD_HASH}.webp`,
    width: 1000,
    height: 750,
    bytes: 180_000,
    sha256: CARD_HASH,
    mime_type: 'image/webp',
    ...overrides,
  }
}

function completeVariants(prefix: string): Array<Record<string, unknown>> {
  return [
    {
      kind: 'thumbnail',
      object_key: `${prefix}variants/thumbnail/${THUMBNAIL_HASH}.webp`,
      width: 320,
      height: 240,
      bytes: 80_000,
      sha256: THUMBNAIL_HASH,
      mime_type: 'image/webp',
    },
    cardVariant(prefix),
    {
      kind: 'wide',
      object_key: `${prefix}variants/wide/${WIDE_HASH}.webp`,
      width: 1600,
      height: 1200,
      bytes: 480_000,
      sha256: WIDE_HASH,
      mime_type: 'image/webp',
    },
  ]
}

async function begin(
  userId: string | null,
  siteId: string,
  overrides: {
    name?: string
    mime?: string
    bytes?: number
    alt?: string
    decorative?: boolean
    focal?: unknown
    folder?: string
    attribution?: string
    source?: string
    tags?: string[]
  } = {},
): Promise<Intent> {
  const input = {
    name: 'appeal.jpg',
    mime: 'image/jpeg',
    bytes: 4_000_000,
    alt: 'A volunteer serving dinner',
    decorative: false,
    focal: { x: 0.5, y: 0.4 },
    folder: 'Campaigns/Appeal',
    attribution: 'Staff photographer',
    source: '2026 appeal shoot',
    tags: ['appeal', 'volunteers'],
    ...overrides,
  }
  const result = await db.asUser(userId, c =>
    c.query<Intent>(
      `SELECT * FROM app.begin_media_upload(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        siteId,
        input.name,
        input.mime,
        input.bytes,
        input.alt,
        input.decorative,
        JSON.stringify(input.focal),
        input.folder,
        input.attribution,
        input.source,
        input.tags,
      ],
    ),
  )
  return result.rows[0]!
}

async function claim(intent: Intent): Promise<Receipt> {
  const result = await db.as('authenticated', c =>
    c.query<Receipt>('SELECT * FROM app.media_upload_for_receipt($1,$2)', [intent.intent_id, intent.upload_token]),
  )
  return result.rows[0]!
}

async function receive(intent: Intent): Promise<Receipt> {
  const receipt = await claim(intent)
  await db.as('authenticated', c =>
    c.query('SELECT app.mark_media_upload_received($1,$2,$3,$4,$5)', [
      intent.intent_id,
      receipt.receipt_token,
      intent.upload_object_key,
      intent.allowed_content_type,
      Number(intent.max_bytes),
    ]),
  )
  return receipt
}

async function finalize(
  intent: Intent,
  overrides: {
    uploadKey?: string
    finalKey?: string
    hash?: string
    mime?: string
    bytes?: number
    width?: number
    height?: number
    variants?: Array<Record<string, unknown>>
  } = {},
): Promise<{ media_id: string; object_key: string; status: string }> {
  const hash = overrides.hash ?? ORIGINAL_HASH
  const mime = overrides.mime ?? 'image/jpeg'
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const finalKey = overrides.finalKey ?? `${intent.final_key_prefix}${hash}.${extension}`
  const variants = overrides.variants ?? completeVariants(intent.final_key_prefix)
  const result = await db.asWorker('media-worker', c =>
    c.query<{
      media_id: string
      object_key: string
      status: string
    }>('SELECT * FROM app.finalize_media_upload($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      intent.intent_id,
      overrides.uploadKey ?? intent.upload_object_key,
      finalKey,
      hash,
      mime,
      overrides.bytes ?? Number(intent.max_bytes),
      overrides.width ?? 4000,
      overrides.height ?? 3000,
      JSON.stringify(variants),
    ]),
  )
  return result.rows[0]!
}

async function ready(
  userId = s.editorA,
  siteId = s.siteA,
  overrides: Parameters<typeof begin>[2] = {},
): Promise<Ready> {
  const intent = await begin(userId, siteId, overrides)
  await receive(intent)
  const finalized = await finalize(intent)
  return {
    intent,
    mediaId: finalized.media_id,
    finalKey: finalized.object_key,
    variants: completeVariants(intent.final_key_prefix),
  }
}

beforeAll(async () => {
  db = await TestDatabase.create('media')
  s = await seedScenario(db)
  siteAdminA = await db.asUser(s.superAdmin, async c => {
    const id = (
      await c.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [
        'media-admin@example.test',
        'Media Admin',
      ])
    ).rows[0]!.id
    await c.query('SELECT app.set_site_membership($1,$2,$3)', [id, s.siteA, 'site_admin'])
    return id
  })
})
afterAll(async () => {
  await db?.close()
})

describe('server-issued upload capabilities', () => {
  it('lets contributors begin an upload for their active site without storing a pretend media row', async () => {
    const intent = await begin(s.contributorA, s.siteA)
    expect(intent.upload_object_key).toBe(`media/uploads/${s.siteA}/${intent.intent_id}`)
    expect(intent.final_key_prefix).toBe(`media/objects/${s.siteA}/${intent.intent_id}/`)
    expect(Number(intent.max_bytes)).toBe(4_000_000)
    expect(intent.allowed_content_type).toBe('image/jpeg')

    const rows = await db.as('owner', c => c.query('SELECT id FROM media WHERE site_id = $1', [s.siteA]))
    expect(rows.rows).toHaveLength(0)
    const secret = await db.as('owner', c =>
      c.query<{ token: string | null; bytes: number }>(
        `SELECT encode(upload_token_hash, 'hex') AS token, octet_length(upload_token_hash) AS bytes
         FROM app.media_upload_intents WHERE id = $1`,
        [intent.intent_id],
      ),
    )
    expect(secret.rows[0]!.token).not.toContain(intent.upload_token.replaceAll('-', ''))
    expect(secret.rows[0]!.bytes).toBe(32)
  })

  it('rejects anonymous, disabled and wrong-tenant actors', async () => {
    await expectSqlState(begin(null, s.siteA), 'CMS02')
    await expectSqlState(begin(s.disabled, s.siteA), 'CMS02')
    await expectSqlState(begin(s.editorA, s.siteB), 'CMS02')
  })

  it('rejects oversized declarations, executable SVG and filename/type tricks', async () => {
    await expectSqlState(begin(s.editorA, s.siteA, { bytes: 10_485_761 }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { name: 'active.svg', mime: 'image/svg+xml' }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { name: 'active.svg', mime: 'image/jpeg' }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { name: '../photo.jpg' }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { name: '..\\photo.jpg' }), 'CMS04')
  })

  it('requires either useful alt text or an explicit decorative decision', async () => {
    await expectSqlState(begin(s.editorA, s.siteA, { alt: '', decorative: false }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { alt: 'not empty', decorative: true }), 'CMS04')
    const decorative = await begin(s.editorA, s.siteA, { alt: '', decorative: true })
    expect(decorative.intent_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('bounds focal data, folder structure and a normalized set of at most 24 tags', async () => {
    await expectSqlState(begin(s.editorA, s.siteA, { focal: { x: 2, y: 0 } }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { folder: '../Private' }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { tags: Array.from({ length: 25 }, (_, n) => `tag ${n}`) }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { tags: ['Appeal'] }), 'CMS04')
    await expectSqlState(begin(s.editorA, s.siteA, { tags: ['appeal', 'appeal'] }), 'CMS04')
  })

  it('claims before streaming, stores only receipt-token digest, and refuses reuse', async () => {
    const intent = await begin(s.editorA, s.siteA)
    const receipt = await claim(intent)
    expect(receipt.upload_object_key).toBe(intent.upload_object_key)
    expect(Number(receipt.declared_bytes)).toBe(4_000_000)

    await expectSqlState(claim(intent), 'CMS04')
    const stored = await db.as('owner', c =>
      c.query<{ upload: Buffer | null; receipt: Buffer | null }>(
        `SELECT upload_token_hash AS upload, receipt_token_hash AS receipt
         FROM app.media_upload_intents WHERE id = $1`,
        [intent.intent_id],
      ),
    )
    expect(stored.rows[0]!.upload).toBeNull()
    expect(stored.rows[0]!.receipt).toHaveLength(32)

    await db.as('authenticated', c =>
      c.query('SELECT app.mark_media_upload_received($1,$2,$3,$4,$5)', [
        intent.intent_id,
        receipt.receipt_token,
        intent.upload_object_key,
        'image/jpeg',
        4_000_000,
      ]),
    )
    await expectSqlState(
      db.as('authenticated', c =>
        c.query('SELECT app.mark_media_upload_received($1,$2,$3,$4,$5)', [
          intent.intent_id,
          receipt.receipt_token,
          intent.upload_object_key,
          'image/jpeg',
          4_000_000,
        ]),
      ),
      'CMS04',
    )
  })

  it('refuses forged receiver keys/type/length and can settle a claimed receipt failure once', async () => {
    const intent = await begin(s.editorA, s.siteA)
    const receipt = await claim(intent)
    await expectSqlState(
      db.as('authenticated', c =>
        c.query('SELECT app.mark_media_upload_received($1,$2,$3,$4,$5)', [
          intent.intent_id,
          receipt.receipt_token,
          'media/uploads/forged',
          'image/jpeg',
          4_000_000,
        ]),
      ),
      'CMS04',
    )
    await db.as('authenticated', c =>
      c.query('SELECT app.fail_media_upload_receipt($1,$2,$3,$4)', [
        intent.intent_id,
        receipt.receipt_token,
        intent.upload_object_key,
        'storage_failed',
      ]),
    )
    await expectSqlState(
      db.as('authenticated', c =>
        c.query('SELECT app.fail_media_upload_receipt($1,$2,$3,$4)', [
          intent.intent_id,
          receipt.receipt_token,
          intent.upload_object_key,
          'storage_failed',
        ]),
      ),
      'CMS04',
    )
  })

  it('refuses an expired intent before body acceptance', async () => {
    const intent = await begin(s.editorA, s.siteA)
    await db.as('owner', c =>
      c.query(
        `UPDATE app.media_upload_intents
          SET created_at = statement_timestamp() - interval '16 minutes',
              expires_at = statement_timestamp() - interval '1 minute'
        WHERE id = $1`,
        [intent.intent_id],
      ),
    )
    await expectSqlState(claim(intent), 'CMS04')
  })
})

describe('inspection creates the first honest media row', () => {
  it('refuses unreceived, forged-key, MIME-spoofed, oversized, malformed hash and invalid dimensions', async () => {
    const unreceived = await begin(s.editorA, s.siteA)
    await expectSqlState(finalize(unreceived), 'CMS04')

    const intent = await begin(s.editorA, s.siteA)
    await receive(intent)
    await expectSqlState(finalize(intent, { uploadKey: 'media/uploads/forged' }), 'CMS04')
    await expectSqlState(finalize(intent, { mime: 'image/png' }), 'CMS04')
    await expectSqlState(finalize(intent, { bytes: 26_214_401 }), 'CMS04')
    await expectSqlState(finalize(intent, { hash: 'not-a-sha256' }), 'CMS04')
    await expectSqlState(finalize(intent, { width: 0 }), 'CMS04')
    await expectSqlState(finalize(intent, { width: 20_000, height: 20_000 }), 'CMS04')
    await expectSqlState(finalize(intent, { finalKey: `${intent.final_key_prefix}${ORIGINAL_HASH}.svg` }), 'CMS04')
  })

  it('requires a content-addressed webp card variant no larger than 200 KiB', async () => {
    const intent = await begin(s.editorA, s.siteA)
    await receive(intent)
    await expectSqlState(finalize(intent, { variants: [] }), 'CMS04')
    await expectSqlState(finalize(intent, { variants: [cardVariant(intent.final_key_prefix)] }), 'CMS04')
    await expectSqlState(
      finalize(intent, {
        variants: [cardVariant(intent.final_key_prefix, { bytes: 204_801 })],
      }),
      'CMS04',
    )
    await expectSqlState(
      finalize(intent, {
        variants: [cardVariant(intent.final_key_prefix, { object_key: 'media/forged.webp' })],
      }),
      'CMS04',
    )
    await expectSqlState(
      finalize(intent, {
        variants: [cardVariant(intent.final_key_prefix, { mime_type: 'image/svg+xml' })],
      }),
      'CMS04',
    )
  })

  it('atomically finalizes metadata and variants as ready, with no processing fiction', async () => {
    const asset = await ready()
    const row = await db.as('owner', c =>
      c.query<{
        status: string
        object_key: string
        content_hash: string
        revision: string
        folder: string
        attribution: string
        source: string
        tags: string[]
      }>(
        `SELECT status, object_key, content_hash, revision, folder, attribution, source, tags
         FROM media WHERE id = $1`,
        [asset.mediaId],
      ),
    )
    expect(row.rows[0]).toEqual({
      status: 'ready',
      object_key: asset.finalKey,
      content_hash: ORIGINAL_HASH,
      revision: '1',
      folder: 'Campaigns/Appeal',
      attribution: 'Staff photographer',
      source: '2026 appeal shoot',
      tags: ['appeal', 'volunteers'],
    })
    const variants = await db.as('owner', c =>
      c.query('SELECT kind, mime_type, bytes, content_hash FROM media_variants WHERE media_id = $1', [asset.mediaId]),
    )
    expect(variants.rows).toEqual([
      { kind: 'thumbnail', mime_type: 'image/webp', bytes: '80000', content_hash: THUMBNAIL_HASH },
      { kind: 'card', mime_type: 'image/webp', bytes: '180000', content_hash: CARD_HASH },
      { kind: 'wide', mime_type: 'image/webp', bytes: '480000', content_hash: WIDE_HASH },
    ])
  })

  it('is idempotent for exact worker redelivery and refuses a stale conflicting finalize', async () => {
    const intent = await begin(s.editorA, s.siteA)
    await receive(intent)
    const [a, b] = await Promise.all([finalize(intent), finalize(intent)])
    expect(a.media_id).toBe(b.media_id)
    await expectSqlState(finalize(intent, { width: 3999 }), 'CMS04')

    const evidence = await db.as('owner', c =>
      c.query<{ count: string }>(
        `SELECT count(*) FROM audit_log
        WHERE action = 'media.upload.finalize' AND item_id = $1`,
        [a.media_id],
      ),
    )
    expect(evidence.rows[0]!.count).toBe('1')
    const events = await db.as('owner', c =>
      c.query<{ count: string }>(
        `SELECT count(*) FROM outbox
        WHERE event_type = 'media.ready' AND payload->>'media_id' = $1`,
        [a.media_id],
      ),
    )
    expect(events.rows[0]!.count).toBe('1')
  })

  it('lets the worker record an inspection failure idempotently, without inventing media', async () => {
    const intent = await begin(s.editorA, s.siteA)
    await receive(intent)
    await db.asWorker('media-worker', c =>
      c.query('SELECT app.fail_media_upload($1,$2,$3)', [intent.intent_id, intent.upload_object_key, 'mime_spoofed']),
    )
    await db.asWorker('media-worker', c =>
      c.query('SELECT app.fail_media_upload($1,$2,$3)', [intent.intent_id, intent.upload_object_key, 'mime_spoofed']),
    )
    await expectSqlState(finalize(intent), 'CMS04')

    const count = await db.as('owner', c =>
      c.query<{ count: string }>(
        `SELECT count(*) FROM audit_log
        WHERE action = 'media.upload.failed' AND item_id = $1`,
        [intent.intent_id],
      ),
    )
    expect(count.rows[0]!.count).toBe('1')
  })
})

describe('metadata, delivery and direct-write isolation', () => {
  it('allows a contributor to edit governed metadata with revision CAS', async () => {
    const asset = await ready()
    const next = await db.asUser(s.contributorA, c =>
      c.query<{ revision: string }>(
        `SELECT app.update_media_metadata(
        $1,$2,$3,$4,$5,$6,$7,$8,$9) AS revision`,
        [
          asset.mediaId,
          1,
          'People sharing a meal',
          false,
          JSON.stringify({ x: 0.2, y: 0.7 }),
          'Campaigns/Updated',
          'Photo desk',
          'Approved archive',
          ['appeal', 'meals'],
        ],
      ),
    )
    expect(next.rows[0]!.revision).toBe('2')
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query(
          `SELECT app.update_media_metadata(
          $1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [asset.mediaId, 1, 'Stale', false, null, '', '', '', []],
        ),
      ),
      'CMS01',
    )
    await expectSqlState(
      db.asUser(s.editorB, c =>
        c.query(
          `SELECT app.update_media_metadata(
          $1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [asset.mediaId, 2, 'Cross tenant', false, null, '', '', '', []],
        ),
      ),
      'CMS02',
    )
  })

  it('refuses application-role writes and object-key enumeration', async () => {
    const asset = await ready()
    await expectSqlState(
      db.asUser(s.editorA, c => c.query("UPDATE media SET status = 'deleted' WHERE id = $1", [asset.mediaId])),
      '42501',
    )
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT object_key FROM media WHERE id = $1', [asset.mediaId])),
      '42501',
    )
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query(
          `INSERT INTO media_usage (media_id,site_id,item_type,item_id,version_id)
         VALUES ($1,$2,'page',$3,$3)`,
          [asset.mediaId, s.siteA, s.pageA],
        ),
      ),
      '42501',
    )
  })

  it('resolves only a closed variant under the admin session and normalized public host', async () => {
    const asset = await ready()
    const admin = await db.asUser(s.editorA, c =>
      c.query("SELECT media_id, variant, mime_type FROM app.resolve_media($1,'card')", [asset.mediaId]),
    )
    expect(admin.rows).toEqual([{ media_id: asset.mediaId, variant: 'card', mime_type: 'image/webp' }])
    expect(
      (await db.asUser(s.editorB, c => c.query("SELECT media_id FROM app.resolve_media($1,'card')", [asset.mediaId])))
        .rows,
    ).toEqual([])
    await expectSqlState(
      db.asUser(s.editorA, c => c.query("SELECT * FROM app.resolve_media($1,'../../original')", [asset.mediaId])),
      'CMS04',
    )

    const delivered = await db.as('public', c =>
      c.query("SELECT media_id, variant, mime_type FROM public_api.resolve_media($1,$2,'card')", [
        'site-a.staging.example.test',
        asset.mediaId,
      ]),
    )
    // Upload completion alone never authorizes anonymous delivery.
    expect(delivered.rows).toEqual([])
    expect(
      (
        await db.as('public', c =>
          c.query("SELECT media_id FROM public_api.resolve_media($1,$2,'card')", [
            'site-b.staging.example.test',
            asset.mediaId,
          ]),
        )
      ).rows,
    ).toEqual([])
    expect(
      (
        await db.as('public', c =>
          c.query("SELECT media_id FROM public_api.resolve_media($1,$2,'card')", [
            'SITE-A.STAGING.EXAMPLE.TEST',
            asset.mediaId,
          ]),
        )
      ).rows,
    ).toEqual([])
  })
})

describe('immutable usage drives publication and deletion', () => {
  async function saveWithMedia(mediaId: string, expectedRevision?: number): Promise<string> {
    const content = JSON.parse(heroContent(s.heroDefId)) as Array<{ values: Record<string, unknown> }>
    content[0]!.values['photo'] = { media_id: mediaId, variant: 'card', alt: 'Meal service' }
    const result = await db.asUser(s.editorA, c =>
      c.query<{ version_id: string }>('SELECT version_id FROM app.save_page_draft($1,$2,$3,$4)', [
        s.pageA,
        expectedRevision ?? 0,
        JSON.stringify(content),
        '{}',
      ]),
    )
    return result.rows[0]!.version_id
  }

  it('indexes references from the immutable page version, not picker state', async () => {
    const asset = await ready()
    const versionId = await saveWithMedia(asset.mediaId)
    const usage = await db.asUser(s.editorA, c =>
      c.query('SELECT media_id,site_id,item_type,item_id,version_id FROM media_usage WHERE media_id = $1', [
        asset.mediaId,
      ]),
    )
    expect(usage.rows).toEqual([
      {
        media_id: asset.mediaId,
        site_id: s.siteA,
        item_type: 'page',
        item_id: s.pageA,
        version_id: versionId,
      },
    ])
  })

  it('rejects malformed, unresolved and cross-site media references in the save transaction', async () => {
    const current = await db.asUser(s.editorA, c =>
      c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [s.pageA]),
    )
    const revision = Number(current.rows[0]!.revision)
    const bad = JSON.parse(heroContent(s.heroDefId)) as Array<{ values: Record<string, unknown> }>
    bad[0]!.values['photo'] = { media_id: 'not-a-uuid', variant: 'card' }
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [s.pageA, revision, JSON.stringify(bad), '{}']),
      ),
      'CMS04',
    )

    bad[0]!.values['photo'] = { media_id: '11111111-1111-1111-1111-111111111111' }
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [s.pageA, revision, JSON.stringify(bad), '{}']),
      ),
      'CMS04',
    )

    bad[0]!.values['photo'] = { media_id: '11111111-1111-1111-1111-111111111111', variant: 'card' }
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [s.pageA, revision, JSON.stringify(bad), '{}']),
      ),
      'CMS04',
    )

    const sameSite = await ready()
    await db.as('owner', c =>
      c.query("DELETE FROM media_variants WHERE media_id=$1 AND kind='wide'", [sameSite.mediaId]),
    )
    bad[0]!.values['photo'] = { media_id: sameSite.mediaId, variant: 'wide' }
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [s.pageA, revision, JSON.stringify(bad), '{}']),
      ),
      'CMS04',
    )

    const other = await ready(s.editorB, s.siteB)
    bad[0]!.values['photo'] = { media_id: other.mediaId, variant: 'card' }
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [s.pageA, revision, JSON.stringify(bad), '{}']),
      ),
      'CMS04',
    )
  })

  it('requires site-admin authority and an explicit broken-reference decision for used media', async () => {
    const asset = await ready()
    const revisionRow = await db.asUser(s.editorA, c =>
      c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [s.pageA]),
    )
    await saveWithMedia(asset.mediaId, Number(revisionRow.rows[0]!.revision))

    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.soft_delete_media($1,$2,$3,$4)', [asset.mediaId, 1, false, ''])),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(siteAdminA, c => c.query('SELECT app.soft_delete_media($1,$2,$3,$4)', [asset.mediaId, 1, false, ''])),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(siteAdminA, c =>
        c.query('SELECT app.soft_delete_media($1,$2,$3,$4)', [asset.mediaId, 1, true, 'short']),
      ),
      'CMS04',
    )
    const deleted = await db.asUser(siteAdminA, c =>
      c.query<{ revision: string }>('SELECT app.soft_delete_media($1,$2,$3,$4) AS revision', [
        asset.mediaId,
        1,
        true,
        'The editor chose to leave this historical version broken.',
      ]),
    )
    expect(deleted.rows[0]!.revision).toBe('2')

    const page = await db.asUser(s.editorA, c =>
      c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [s.pageA]),
    )
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, Number(page.rows[0]!.revision), 2, null, '[]']),
      ),
      'CMS04',
    )
  })

  it('restores within retention under the same UUID/object for members without publishing an unused upload', async () => {
    const asset = await ready()
    await db.asUser(siteAdminA, c =>
      c.query('SELECT app.soft_delete_media($1,$2,$3,$4)', [asset.mediaId, 1, false, '']),
    )
    expect(
      (
        await db.as('public', c =>
          c.query("SELECT * FROM public_api.resolve_media($1,$2,'original')", [
            'site-a.staging.example.test',
            asset.mediaId,
          ]),
        )
      ).rows,
    ).toEqual([])

    const restored = await db.asUser(siteAdminA, c =>
      c.query<{ revision: string }>('SELECT app.restore_media($1,$2) AS revision', [asset.mediaId, 2]),
    )
    expect(restored.rows[0]!.revision).toBe('3')
    const object = await db.asUser(s.editorA, c =>
      c.query<{ object_key: string }>("SELECT object_key FROM app.resolve_media($1,'original')", [asset.mediaId]),
    )
    expect(
      (
        await db.as('public', c =>
          c.query("SELECT * FROM public_api.resolve_media($1,$2,'original')", [
            'site-a.staging.example.test',
            asset.mediaId,
          ]),
        )
      ).rows,
    ).toEqual([])
    expect(object.rows[0]!.object_key).toBe(asset.finalKey)
  })

  it('reveals cleanup keys only to the worker after retention and finalizes physical purge once', async () => {
    const asset = await ready()
    await db.asUser(siteAdminA, c =>
      c.query('SELECT app.soft_delete_media($1,$2,$3,$4)', [asset.mediaId, 1, false, '']),
    )
    const cleanupEvent = await db.as('owner', c =>
      c.query<{ id: string }>(
        `SELECT id FROM outbox WHERE event_type = 'media.cleanup_requested'
        AND payload->>'media_id' = $1`,
        [asset.mediaId],
      ),
    )
    const eventId = cleanupEvent.rows[0]!.id
    await db.as('owner', async c => {
      await c.query(
        `UPDATE media SET deleted_at = statement_timestamp() - interval '31 days'
          WHERE id = $1`,
        [asset.mediaId],
      )
      await c.query(
        `UPDATE outbox SET next_attempt_at = statement_timestamp() + interval '1 day'
          WHERE status = 'pending'`,
      )
      await c.query(
        `UPDATE outbox SET next_attempt_at = statement_timestamp()
          WHERE id = $1`,
        [eventId],
      )
    })

    const lease = await db.asWorker('media-worker', c =>
      c.query<{
        id: string
        lease_token: string
      }>('SELECT id,lease_token FROM app.claim_outbox($1)', [300]),
    )
    expect(lease.rows[0]!.id).toBe(eventId)
    const token = lease.rows[0]!.lease_token

    const keys = await db.asWorker('media-worker', c =>
      c.query<{
        kind: string
        object_key: string
      }>('SELECT * FROM app.media_for_cleanup($1,$2,$3,$4)', [eventId, token, asset.mediaId, 2]),
    )
    expect(keys.rows).toEqual([
      { kind: 'original', object_key: asset.finalKey },
      { kind: 'card', object_key: String(asset.variants.find(variant => variant['kind'] === 'card')!['object_key']) },
      {
        kind: 'thumbnail',
        object_key: String(asset.variants.find(variant => variant['kind'] === 'thumbnail')!['object_key']),
      },
      { kind: 'wide', object_key: String(asset.variants.find(variant => variant['kind'] === 'wide')!['object_key']) },
    ])
    await expectSqlState(
      db.asWorker('media-worker', c =>
        c.query('SELECT * FROM app.media_for_cleanup($1,$2,$3,$4)', [eventId, token, asset.mediaId, 999]),
      ),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(siteAdminA, c =>
        c.query('SELECT * FROM app.media_for_cleanup($1,$2,$3,$4)', [eventId, token, asset.mediaId, 2]),
      ),
      '42501',
    )

    // Losing the outbox lease loses cleanup authority. A retry claims a fresh
    // token, renews the same durable media claim, and sees the same idempotent
    // remove set; restore remains excluded throughout.
    await db.as('owner', c =>
      c.query(
        `UPDATE outbox SET leased_until = statement_timestamp() - interval '1 second',
                         next_attempt_at = statement_timestamp()
        WHERE id = $1`,
        [eventId],
      ),
    )
    const retry = await db.asWorker('media-worker-2', c =>
      c.query<{
        id: string
        lease_token: string
      }>('SELECT id,lease_token FROM app.claim_outbox($1)', [300]),
    )
    const retryToken = retry.rows[0]!.lease_token
    await expectSqlState(
      db.asWorker('media-worker', c =>
        c.query('SELECT * FROM app.media_for_cleanup($1,$2,$3,$4)', [eventId, token, asset.mediaId, 2]),
      ),
      'CMS04',
    )
    expect(
      (
        await db.asWorker('media-worker-2', c =>
          c.query('SELECT * FROM app.media_for_cleanup($1,$2,$3,$4)', [eventId, retryToken, asset.mediaId, 2]),
        )
      ).rows,
    ).toEqual(keys.rows)

    const first = await db.asWorker('media-worker', c =>
      c.query<{ purged_at: Date }>('SELECT app.finalize_media_cleanup($1,$2,$3,$4) AS purged_at', [
        eventId,
        retryToken,
        asset.mediaId,
        2,
      ]),
    )
    const second = await db.asWorker('media-worker', c =>
      c.query<{ purged_at: Date }>('SELECT app.finalize_media_cleanup($1,$2,$3,$4) AS purged_at', [
        eventId,
        retryToken,
        asset.mediaId,
        2,
      ]),
    )
    expect(second.rows[0]!.purged_at).toEqual(first.rows[0]!.purged_at)
    expect(
      (
        await db.asWorker('media-worker', c =>
          c.query('SELECT * FROM app.media_for_cleanup($1,$2,$3,$4)', [eventId, retryToken, asset.mediaId, 2]),
        )
      ).rows,
    ).toEqual([])
    await expectSqlState(
      db.asUser(siteAdminA, c => c.query('SELECT app.restore_media($1,$2)', [asset.mediaId, 2])),
      'CMS04',
    )
    const audit = await db.as('owner', c =>
      c.query<{ count: string }>(
        `SELECT count(*) FROM audit_log
        WHERE action = 'media.cleanup.finalize' AND item_id = $1`,
        [asset.mediaId],
      ),
    )
    expect(audit.rows[0]!.count).toBe('1')
  })

  it('records exact immutable audit references and schedules delayed cleanup without leaking a key', async () => {
    const asset = await ready()
    await db.asUser(siteAdminA, c =>
      c.query('SELECT app.soft_delete_media($1,$2,$3,$4)', [asset.mediaId, 1, false, '']),
    )
    await db.asUser(siteAdminA, c => c.query('SELECT app.restore_media($1,$2)', [asset.mediaId, 2]))

    const audit = await db.as('owner', c =>
      c.query(
        `SELECT action,item_type,item_id,before_ref,after_ref
         FROM audit_log
        WHERE (item_id = $1 OR item_id = $2)
          AND action IN ('media.upload.begin','media.upload.finalize','media.delete','media.restore')
        ORDER BY id`,
        [asset.mediaId, asset.intent.intent_id],
      ),
    )
    expect(audit.rows).toEqual([
      {
        action: 'media.upload.begin',
        item_type: 'media_upload_intent',
        item_id: asset.intent.intent_id,
        before_ref: null,
        after_ref: asset.intent.intent_id,
      },
      {
        action: 'media.upload.finalize',
        item_type: 'media',
        item_id: asset.mediaId,
        before_ref: asset.intent.intent_id,
        after_ref: asset.mediaId,
      },
      {
        action: 'media.delete',
        item_type: 'media',
        item_id: asset.mediaId,
        before_ref: asset.mediaId,
        after_ref: null,
      },
      {
        action: 'media.restore',
        item_type: 'media',
        item_id: asset.mediaId,
        before_ref: null,
        after_ref: asset.mediaId,
      },
    ])

    const cleanup = await db.as('owner', c =>
      c.query<{
        payload: Record<string, unknown>
        delayed: boolean
      }>(
        `SELECT payload, next_attempt_at > created_at + interval '29 days' AS delayed
         FROM outbox
        WHERE event_type = 'media.cleanup_requested'
          AND payload->>'media_id' = $1`,
        [asset.mediaId],
      ),
    )
    expect(cleanup.rows[0]!.delayed).toBe(true)
    expect(JSON.stringify(cleanup.rows[0]!.payload)).not.toContain(asset.finalKey)
    const stateEvents = await db.as('owner', c =>
      c.query(
        `SELECT event_type,payload->>'revision' AS revision
         FROM outbox
        WHERE event_type IN ('media.deleted','media.restored')
          AND payload->>'media_id' = $1 ORDER BY id`,
        [asset.mediaId],
      ),
    )
    expect(stateEvents.rows).toEqual([
      { event_type: 'media.deleted', revision: '2' },
      { event_type: 'media.restored', revision: '3' },
    ])
  })
})

describe('terminal media processing jobs', () => {
  async function delivery(intent: Intent) {
    return db.as(
      'owner',
      async client =>
        (
          await client.query(
            "SELECT id FROM outbox WHERE event_type='media.upload_received' AND payload->>'intent_id'=$1",
            [intent.intent_id],
          )
        ).rows[0]!.id,
    )
  }

  async function status(intent: Intent, user = s.editorA) {
    return db.asUser(
      user,
      async client => (await client.query('SELECT * FROM app.media_upload_status($1)', [intent.intent_id])).rows[0],
    )
  }

  for (const failure of ['ordinary', 'crash'] as const) {
    it(`reports a failed upload after ${failure} delivery exhaustion without a pretend media record`, async () => {
      const intent = await begin(s.editorA, s.siteA)
      await receive(intent)
      const id = await delivery(intent)
      await db.as('owner', client => client.query('UPDATE outbox SET max_attempts=1 WHERE id=$1', [id]))
      await db.asWorker('media-terminal-test', async client => {
        const excluded = (await db.as('owner', c => c.query('SELECT id FROM outbox WHERE id<>$1', [id]))).rows.map(
          row => row.id,
        )
        const claimed = (await client.query('SELECT * FROM app.claim_outbox(60,$1)', [excluded])).rows[0]!
        expect(String(claimed.id)).toBe(String(id))
        if (failure === 'ordinary')
          await client.query('SELECT app.settle_outbox($1,$2,false,$3,false)', [
            id,
            claimed.lease_token,
            'storage unavailable',
          ])
      })
      if (failure === 'crash') {
        await db.as('owner', client =>
          client.query("UPDATE outbox SET leased_until=now()-interval '1 second' WHERE id=$1", [id]),
        )
        await db.asWorker('media-terminal-test', client => client.query('SELECT * FROM app.claim_outbox(60)'))
      }
      expect(await status(intent)).toMatchObject({
        status: 'failed',
        failure_code: 'media_processing_interrupted',
        media_id: null,
      })
      expect(await status(intent, s.editorB)).toBeUndefined()
      const audit = await db.as('owner', client =>
        client.query("SELECT id FROM audit_log WHERE action='media.upload.failed' AND item_id=$1", [intent.intent_id]),
      )
      expect(audit.rows).toHaveLength(1)
    })
  }

  it('preserves a completed image and refuses cross-site or malformed event targets', async () => {
    const completed = await ready(s.editorA, s.siteA)
    const pending = await begin(s.editorA, s.siteA)
    await receive(pending)
    await db.as('owner', async client => {
      await client.query("UPDATE outbox SET status='dead',failed_at=now() WHERE id=$1", [
        await delivery(completed.intent),
      ])
      for (const target of [pending.intent_id, 'not-a-uuid']) {
        const result = await client.query(
          "INSERT INTO outbox(site_id,event_type,payload) VALUES($1,'media.upload_received',$2) RETURNING id",
          [s.siteB, JSON.stringify({ intent_id: target })],
        )
        await client.query("UPDATE outbox SET status='dead',failed_at=now() WHERE id=$1", [result.rows[0]!.id])
      }
    })
    expect(await status(completed.intent)).toMatchObject({ status: 'ready', media_id: completed.mediaId })
    expect(await status(pending)).toMatchObject({ status: 'processing', failure_code: null })
  })
})
