// The database half of the thumbnail job, against a real Postgres as the real
// roles (SPEC §9, §6.5 D3).
//
// Everything here is a fact only the database can settle: that the enqueue and
// the version commit together, that only the worker may record a thumbnail, that
// the key is checked rather than trusted, that a second recording of the same key
// writes no audit row. A fake that answers "allowed" proves none of them.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SITE_FONT_REGISTRY } from '@cms/schema'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { SECTION_THUMBNAIL_EVENT, thumbnailKeyPrefix } from '../src/thumbnails.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('thumbnails')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

/** Save a definition through the command the editor actually calls. */
async function saveDefinition(slug: string): Promise<{ id: string; version: number }> {
  const { rows } = await db.asUser(s.superAdmin, c =>
    c.query<{ section_def_id: string; version: number }>(
      'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        slug,
        slug,
        'Openers',
        `<section class="${slug}"><h1>{{heading}}</h1></section>`,
        `.${slug}{padding:4rem}`,
        `.cms-section--${slug} .${slug}{padding:4rem}`,
        JSON.stringify({
          nodes: [
            { kind: 'html', value: `<section class="${slug}"><h1>` },
            { kind: 'slot', slotId: 'heading', slotKind: 'text', context: 'element-text' },
            { kind: 'html', value: '</h1></section>' },
          ],
          policyVersion: 4,
          cssPolicyVersion: 6,
        }),
        JSON.stringify([{ id: 'heading', kind: 'text', label: 'Heading', constraints: {} }]),
        `hash-${slug}-1`,
        4,
        6,
        'initial',
      ],
    ),
  )
  return { id: rows[0]!.section_def_id, version: rows[0]!.version }
}

const events = (defId: string) =>
  db.as('owner', c =>
    c.query<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM outbox WHERE event_type = $1 AND payload ->> $2 = $3',
      [SECTION_THUMBNAIL_EVENT, 'section_def_id', defId],
    ),
  )

describe('a saved definition asks for its picture', () => {
  it('enqueues exactly one event naming the version that was just written', async () => {
    const def = await saveDefinition('asks-once')
    const { rows } = await events(def.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toMatchObject({
      section_def_id: def.id,
      version: def.version,
      slug: 'asks-once',
    })
  })

  it('asks again for every new version, because each version is its own picture', async () => {
    await saveDefinition('asks-twice')
    const second = await saveDefinition('asks-twice')
    const { rows } = await events(second.id)
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.payload['version']).sort()).toEqual([1, 2])
  })

  it('enqueues nothing when the save is refused, because it is the same transaction', async () => {
    // The point of putting the enqueue inside `app.upsert_section_def_version`
    // rather than after it: a refused save leaves no orphaned request for a
    // picture of a version that does not exist.
    const before = await db.as('owner', c =>
      c.query<{ n: string }>('SELECT count(*) AS n FROM outbox WHERE event_type = $1', [SECTION_THUMBNAIL_EVENT]),
    )
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
          'Not A Slug',
          'x',
          '',
          '<p>x</p>',
          '',
          '',
          JSON.stringify({ nodes: [], policyVersion: 4, cssPolicyVersion: 6 }),
          '[]',
          'h',
          4,
          6,
          '',
        ]),
      ),
      'CMS04',
    )
    const after = await db.as('owner', c =>
      c.query<{ n: string }>('SELECT count(*) AS n FROM outbox WHERE event_type = $1', [SECTION_THUMBNAIL_EVENT]),
    )
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n)
  })
})

describe('recording a thumbnail is a command', () => {
  it('writes the path and an audit row in the same transaction', async () => {
    const def = await saveDefinition('records-once')
    const key = `${thumbnailKeyPrefix(def.id, def.version, 'a'.repeat(32))}/${'b'.repeat(32)}.png`

    const { rows } = await db.asWorker('w1', c =>
      c.query<{ audit_id: string | null }>('SELECT app.record_section_def_thumbnail($1,$2,$3) AS audit_id', [
        def.id,
        def.version,
        key,
      ]),
    )
    expect(rows[0]!.audit_id).not.toBeNull()

    const stored = await db.asUser(s.superAdmin, c =>
      c.query<{ thumbnail_path: string }>(
        'SELECT thumbnail_path FROM section_def_versions WHERE section_def_id = $1 AND version = $2',
        [def.id, def.version],
      ),
    )
    expect(stored.rows[0]!.thumbnail_path).toBe(key)

    const audit = await db.as('owner', c =>
      c.query<{ actor_type: string; detail: Record<string, unknown> }>(
        "SELECT actor_type, detail FROM audit_log WHERE action = 'section_def.thumbnail' AND item_id = $1",
        [def.id],
      ),
    )
    expect(audit.rows).toHaveLength(1)
    // Not 'user': a worker acts on nobody's behalf, and the shape constraint
    // refuses a non-user row that names an actor.
    expect(audit.rows[0]!.actor_type).toBe('system')
    expect(audit.rows[0]!.detail).toMatchObject({ before: null, after: key, worker: 'w1' })
  })

  it('refuses a no-op rather than recording one', async () => {
    // What makes a redelivered job provably silent. Without it, an at-least-once
    // queue fills audit_log with rows saying nothing happened.
    const def = await saveDefinition('records-twice')
    const key = `${thumbnailKeyPrefix(def.id, def.version, 'c'.repeat(32))}/${'d'.repeat(32)}.png`
    const record = () =>
      db.asWorker('w1', c =>
        c.query<{ audit_id: string | null }>('SELECT app.record_section_def_thumbnail($1,$2,$3) AS audit_id', [
          def.id,
          def.version,
          key,
        ]),
      )

    expect((await record()).rows[0]!.audit_id).not.toBeNull()
    expect((await record()).rows[0]!.audit_id).toBeNull()

    const audit = await db.as('owner', c =>
      c.query("SELECT id FROM audit_log WHERE action = 'section_def.thumbnail' AND item_id = $1", [def.id]),
    )
    expect(audit.rows).toHaveLength(1)
  })

  it('refuses a key that traverses out of its own prefix', async () => {
    const def = await saveDefinition('refuses-traversal')
    await expectSqlState(
      db.asWorker('w1', c =>
        c.query('SELECT app.record_section_def_thumbnail($1,$2,$3)', [
          def.id,
          def.version,
          'section-thumbnails/../../etc/passwd',
        ]),
      ),
      'CMS04',
    )
  })

  it('refuses a key that is not a content-addressed object key', async () => {
    const def = await saveDefinition('refuses-shape')
    await expectSqlState(
      db.asWorker('w1', c =>
        c.query('SELECT app.record_section_def_thumbnail($1,$2,$3)', [def.id, def.version, 'https://evil.test/x.png']),
      ),
      'CMS04',
    )
  })

  it('refuses a version that does not exist', async () => {
    const def = await saveDefinition('refuses-missing')
    await expectSqlState(
      db.asWorker('w1', c =>
        c.query('SELECT app.record_section_def_thumbnail($1,$2,$3)', [
          def.id,
          99,
          `section-thumbnails/${def.id}/v99/${'e'.repeat(16)}/${'f'.repeat(32)}.png`,
        ]),
      ),
      'CMS03',
    )
  })

  it('refuses a session with no worker identity', async () => {
    const def = await saveDefinition('refuses-anonymous')
    await expectSqlState(
      db.as('worker', c =>
        c.query('SELECT app.record_section_def_thumbnail($1,$2,$3)', [
          def.id,
          def.version,
          `section-thumbnails/${def.id}/v1/${'1'.repeat(16)}/${'2'.repeat(32)}.png`,
        ]),
      ),
      'CMS02',
    )
  })
})

describe('the reach these two functions give away', () => {
  it('lets no editor record a thumbnail, whatever their role', async () => {
    const def = await saveDefinition('editors-cannot')
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.record_section_def_thumbnail($1,$2,$3)', [
          def.id,
          def.version,
          `section-thumbnails/${def.id}/v1/${'3'.repeat(16)}/${'4'.repeat(32)}.png`,
        ]),
      ),
      '42501',
    )
  })

  it("lets no editor read through the worker's narrow view either", async () => {
    const def = await saveDefinition('editors-read-the-table')
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT * FROM app.section_def_version_for_thumbnail($1,$2)', [def.id, def.version]),
      ),
      '42501',
    )
  })

  it('gives the worker the artifacts a thumbnail is drawn from, which no table grant does', async () => {
    // 0002 deliberately withholds SELECT on section_defs and section_def_versions
    // from cms_worker. The function is the whole of the widening, and this is
    // both halves of that claim.
    const def = await saveDefinition('worker-reads')
    await expectSqlState(
      db.as('worker', c => c.query('SELECT * FROM section_def_versions LIMIT 1')),
      '42501',
    )

    const { rows } = await db.asWorker('w1', c =>
      c.query<{ slug: string; render_hash: string; thumbnail_path: string | null; theme: unknown }>(
        'SELECT * FROM app.section_def_version_for_thumbnail($1,$2)',
        [def.id, def.version],
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.slug).toBe('worker-reads')
    expect(rows[0]!.render_hash).toBe('hash-worker-reads-1')
    expect(rows[0]!.thumbnail_path).toBeNull()
    // A global definition belongs to no site, so there is no site theme to draw
    // it under and the caller falls back to the library's own.
    expect(rows[0]!.theme).toBeNull()
  })

  it('returns nothing for a version that is not there, rather than raising', async () => {
    const { rows } = await db.asWorker('w1', c =>
      c.query('SELECT * FROM app.section_def_version_for_thumbnail($1,$2)', [
        '00000000-0000-0000-0000-000000000000',
        1,
      ]),
    )
    expect(rows).toHaveLength(0)
  })
})

describe('the files a card is drawn with (migration 0106)', () => {
  // A card shows the section's own pictures in its site's fonts; the worker
  // embeds them. The database names only the definition's own site's fonts and
  // its ready, undeleted pictures, and only to the worker.
  async function siteDefinition(site: string, slug: string) {
    return db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query<{ section_def_id: string }>(
            'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
            [
              slug,
              slug,
              'Openers',
              `<section class="${slug}"><h1>{{heading}}</h1></section>`,
              `.${slug}{padding:4rem}`,
              `.cms-section--${slug} .${slug}{padding:4rem}`,
              JSON.stringify({
                nodes: [
                  { kind: 'html', value: `<section class="${slug}"><h1>` },
                  { kind: 'slot', slotId: 'heading', slotKind: 'text', context: 'element-text' },
                  { kind: 'html', value: '</h1></section>' },
                ],
                policyVersion: 4,
                cssPolicyVersion: 6,
              }),
              JSON.stringify([{ id: 'heading', kind: 'text', label: 'Heading', constraints: {} }]),
              `hash-${slug}-1`,
              4,
              6,
              'initial',
              false,
              'legacy',
              null,
              null,
              'site',
              site,
              0,
              null,
            ],
          )
        ).rows[0]!.section_def_id,
    )
  }
  async function font(site: string) {
    const id = randomUUID(),
      registered = SITE_FONT_REGISTRY['trajan-regular']
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        site,
        id,
        'font',
        `site-assets/${site}/${id}/${registered.sha256}`,
        registered.mimeType,
        99,
        registered.sha256,
        registered.filename,
        'trajan-regular',
        JSON.stringify({ path: 'font/registered.otf', sha256: registered.sha256, manifest_sha256: 'b'.repeat(64) }),
      ]),
    )
    return id
  }
  async function picture(site: string, status = 'ready') {
    const id = randomUUID()
    await db.as('owner', async c => {
      await c.query(
        `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status,deleted_at)
        VALUES($1,$2,$3,$4,'hall.jpg','Hall',10,10,100,'image/jpeg',$5,$6)`,
        [id, site, `media/${id}.jpg`, 'a'.repeat(64), status, status === 'deleted' ? new Date() : null],
      )
      await c.query(
        `INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type)
        VALUES($1,'card',$2,$3,960,540,80,'image/webp')`,
        [id, `media/${id}-card.webp`, 'b'.repeat(64)],
      )
    })
    return id
  }
  const resources = (def: string, media: string[], version = 1) =>
    db.asWorker(
      'w1',
      async c =>
        (
          await c.query<{
            r: {
              fonts: { assetId: string }[]
              media: { mediaId: string; kind: string; objectKey: string }[]
              values: Record<string, unknown>
            }
          }>('SELECT app.thumbnail_resources($1,$2,$3::uuid[]) AS r', [def, version, media])
        ).rows[0]!.r,
    )

  it('names the definition’s own site’s fonts and ready pictures, and nothing of another site', async () => {
    const def = await siteDefinition(s.siteA, `files-${randomUUID().slice(0, 8)}`)
    const ownFont = await font(s.siteA),
      otherFont = await font(s.siteB)
    const own = await picture(s.siteA),
      foreign = await picture(s.siteB),
      processing = await picture(s.siteA, 'processing'),
      deleted = await picture(s.siteA, 'deleted')
    const found = await resources(def, [own, foreign, processing, deleted])
    expect(found.fonts.map(f => f.assetId)).toContain(ownFont)
    expect(found.fonts.map(f => f.assetId)).not.toContain(otherFont)
    expect(found.media).toEqual([
      expect.objectContaining({ mediaId: own, kind: 'card', objectKey: `media/${own}-card.webp` }),
    ])
  })

  it('answers only the worker', async () => {
    const def = await siteDefinition(s.siteA, `files-${randomUUID().slice(0, 8)}`)
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT app.thumbnail_resources($1,$2,$3::uuid[])', [def, 1, []])),
      '42501',
    )
  })

  it('gives a site layout the words a page of its site gives it, newest draft when nothing is published', async () => {
    const def = await siteDefinition(s.siteA, `files-${randomUUID().slice(0, 8)}`)
    expect((await resources(def, [])).values).toEqual({})
    const page = (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, `files-${randomUUID().slice(0, 8)}`, 'Files']),
      )
    ).rows[0]!.id
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([
          {
            section_def_id: def,
            section_def_version: 1,
            values: { heading: 'Echelon Symposium' },
            hidden: false,
            hidden_at: [],
            label: '',
          },
        ]),
        '{}',
      ]),
    )
    expect((await resources(def, [])).values).toEqual({ heading: 'Echelon Symposium' })
    // Another version of the same layout has no page yet.
    expect((await resources(def, [], 2)).values).toEqual({})
  })

  it('never gives a shared layout one site’s page words', async () => {
    const shared = await saveDefinition(`files-shared-${randomUUID().slice(0, 8)}`)
    const page = (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, `files-${randomUUID().slice(0, 8)}`, 'Files']),
      )
    ).rows[0]!.id
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([
          {
            section_def_id: shared.id,
            section_def_version: shared.version,
            values: { heading: 'Site A only' },
            hidden: false,
            hidden_at: [],
            label: '',
          },
        ]),
        '{}',
      ]),
    )
    expect((await resources(shared.id, [], shared.version)).values).toEqual({})
  })
})
