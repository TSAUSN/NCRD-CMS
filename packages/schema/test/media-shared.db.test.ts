import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { CHECKED_CLEAN, expectSqlState, TestDatabase } from './harness.ts'

let db: TestDatabase
let s: Scenario
let imageDef: string

async function readyMedia(siteId: string | null, label: string): Promise<string> {
  return db.as('owner', async client => {
    const id = (
      await client.query<{ id: string }>(
        `INSERT INTO media (
         site_id,object_key,content_hash,original_name,alt_text,decorative,
         width,height,bytes,mime_type,status,uploaded_by
       ) VALUES ($1,$2,$3,$4,$5,false,1600,900,240000,'image/jpeg','ready',$6)
       RETURNING id`,
        [
          siteId,
          `media/test/${randomUUID()}/original.jpg`,
          randomUUID().replaceAll('-', '').padEnd(64, 'a'),
          `${label}.jpg`,
          label,
          s.superAdmin,
        ],
      )
    ).rows[0]!.id
    for (const [kind, width, height, bytes, hashFill] of [
      ['thumbnail', 320, 180, 40_000, 'c'],
      ['card', 960, 540, 140_000, 'd'],
      ['wide', 1600, 900, 220_000, 'e'],
    ] as const) {
      await client.query(
        `INSERT INTO media_variants (
           media_id,kind,object_key,width,height,bytes,mime_type,content_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,'image/webp',$7)`,
        [
          id,
          kind,
          `media/test/${id}/${kind}.webp`,
          width,
          height,
          bytes,
          randomUUID().replaceAll('-', '').padEnd(64, hashFill),
        ],
      )
    }
    return id
  })
}

async function createPage(title: string): Promise<string> {
  return db.asUser(
    s.editorA,
    async client =>
      (
        await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          `media-${randomUUID().slice(0, 8)}`,
          title,
        ])
      ).rows[0]!.id,
  )
}

async function saveMediaPage(pageId: string, mediaId: string): Promise<{ versionId: string; revision: number }> {
  const content = [
    {
      section_def_id: imageDef,
      section_def_version: 1,
      values: {
        heading: 'Shared media',
        intro: 'One governed asset.',
        photo: { media_id: mediaId, variant: 'wide', src: `/media/${mediaId}/wide`, alt: 'A shared image' },
      },
      hidden: false,
      hidden_at: [],
      label: 'Hero',
    },
  ]
  return db.asUser(s.editorA, async client => {
    const row = (
      await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.save_page_draft($1,$2,$3,$4)',
        [pageId, 0, JSON.stringify(content), '{}'],
      )
    ).rows[0]!
    return { versionId: row.version_id, revision: Number(row.revision) }
  })
}

beforeAll(async () => {
  db = await TestDatabase.create('media_shared')
  s = await seedScenario(db)
  // Actual rendered image: usage metadata alone is intentionally not public.
  imageDef = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query<{ section_def_id: string }>(
          'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            'shared-image',
            'Shared image',
            'Tests',
            '<div>{{photo}}</div>',
            '',
            '',
            JSON.stringify({
              policyVersion: 4,
              cssPolicyVersion: 6,
              nodes: [
                { kind: 'html', value: '<div>' },
                { kind: 'slot', slotId: 'photo', slotKind: 'image', context: 'element-text' },
                { kind: 'html', value: '</div>' },
              ],
            }),
            JSON.stringify([{ id: 'photo', kind: 'image', label: 'Photo', constraints: {} }]),
            'shared-image-fixture',
            4,
            6,
            'Rendered image fixture',
          ],
        )
      ).rows[0]!.section_def_id,
  )
})
afterAll(async () => {
  await db?.close()
})

describe('shared media is host-bound by live usage', () => {
  it('accepts a shared page asset, indexes the tenant usage, and serves it only on the live host', async () => {
    const shared = await readyMedia(null, 'Shared campaign photograph')
    const pageId = await createPage('Shared image page')
    const saved = await saveMediaPage(pageId, shared)
    expect(
      (
        await db.as('public', client =>
          client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'wide')", [
            'site-a.staging.example.test',
            shared,
          ]),
        )
      ).rows,
    ).toEqual([])
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [pageId, saved.revision, ...CHECKED_CLEAN]),
    )

    const usage = await db.asUser(s.editorA, client =>
      client.query('SELECT site_id,item_id,version_id FROM media_usage WHERE media_id = $1', [shared]),
    )
    expect(usage.rows).toEqual([{ site_id: s.siteA, item_id: pageId, version_id: saved.versionId }])
    expect(
      (
        await db.as('public', client =>
          client.query("SELECT media_id,variant FROM public_api.resolve_media($1,$2,'wide')", [
            'site-a.staging.example.test',
            shared,
          ]),
        )
      ).rows,
    ).toEqual([{ media_id: shared, variant: 'wide' }])
    expect(
      (
        await db.as('public', client =>
          client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'wide')", [
            'site-b.staging.example.test',
            shared,
          ]),
        )
      ).rows,
    ).toEqual([])
  })

  it("still rejects another tenant's owned media during the save transaction", async () => {
    const otherSite = await readyMedia(s.siteB, 'Site B photograph')
    const pageId = await createPage('Wrong tenant image')
    await expectSqlState(saveMediaPage(pageId, otherSite), 'CMS04')
  })

  it('serves a shared logo only after the exact site publishes it', async () => {
    const shared = await readyMedia(null, 'Shared foundation logo')
    const current = await db.asUser(
      s.editorA,
      async client =>
        (
          await client.query<{
            header_revision: string
            footer_revision: string
            header: unknown
            footer: unknown
          }>(
            `SELECT h.revision AS header_revision, f.revision AS footer_revision,
              hd.content AS header, fd.content AS footer
         FROM global_elements h
         JOIN global_element_versions hd ON hd.id = h.draft_version_id
         JOIN global_elements f ON f.site_id = h.site_id AND f.kind = 'footer'
         JOIN global_element_versions fd ON fd.id = f.draft_version_id
        WHERE h.site_id = $1 AND h.kind = 'header'`,
            [s.siteA],
          )
        ).rows[0]!,
    )
    const header = current.header as Record<string, unknown>
    const brand = header['brand'] as Record<string, unknown>
    const nextHeader = { ...header, brand: { ...brand, logoMediaId: shared } }
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        s.siteA,
        Number(current.header_revision),
        Number(current.footer_revision),
        JSON.stringify(nextHeader),
        JSON.stringify(current.footer),
      ]),
    )
    const revisions = await db.asUser(
      s.editorA,
      async client =>
        (
          await client.query<{
            header_revision: string
            footer_revision: string
          }>(
            `SELECT h.revision AS header_revision, f.revision AS footer_revision
         FROM global_elements h JOIN global_elements f ON f.site_id=h.site_id AND f.kind='footer'
        WHERE h.site_id=$1 AND h.kind='header'`,
            [s.siteA],
          )
        ).rows[0]!,
    )
    await db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
        s.siteA,
        Number(revisions.header_revision),
        Number(revisions.footer_revision),
      ]),
    )
    expect(
      (
        await db.as('public', client =>
          client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'wide')", [
            'site-a.staging.example.test',
            shared,
          ]),
        )
      ).rows,
    ).toEqual([{ media_id: shared }])
    expect(
      (
        await db.as('public', client =>
          client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'wide')", [
            'site-b.staging.example.test',
            shared,
          ]),
        )
      ).rows,
    ).toEqual([])
  })

  it('reserves shared deletion and restoration for a super admin', async () => {
    const shared = await readyMedia(null, 'Shared lifecycle image')
    await expectSqlState(
      db.asUser(s.editorA, client => client.query('SELECT app.soft_delete_media($1,1,false,NULL)', [shared])),
      'CMS02',
    )
    expect(
      (
        await db.asUser(s.superAdmin, client =>
          client.query<{ revision: string }>('SELECT app.soft_delete_media($1,1,false,NULL) AS revision', [shared]),
        )
      ).rows[0]!.revision,
    ).toBe('2')
    await expectSqlState(
      db.asUser(s.editorA, client => client.query('SELECT app.restore_media($1,2)', [shared])),
      'CMS02',
    )
    expect(
      (
        await db.asUser(s.superAdmin, client =>
          client.query<{ revision: string }>('SELECT app.restore_media($1,2) AS revision', [shared]),
        )
      ).rows[0]!.revision,
    ).toBe('3')
  })
})

describe('upload intent status is narrow and tenant-safe', () => {
  it('reports processing to the owning site and nothing to another tenant', async () => {
    const intentId = await db.asUser(
      s.contributorA,
      async client =>
        (
          await client.query<{ intent_id: string }>(
            `SELECT intent_id FROM app.begin_media_upload(
         $1,'queued.jpg','image/jpeg',1234,'Queued image',false,NULL,'','','',ARRAY[]::text[])`,
            [s.siteA],
          )
        ).rows[0]!.intent_id,
    )
    const own = await db.asUser(s.editorA, client =>
      client.query('SELECT status,original_name,media_id,failure_code FROM app.media_upload_status($1)', [intentId]),
    )
    expect(own.rows).toEqual([
      {
        status: 'processing',
        original_name: 'queued.jpg',
        media_id: null,
        failure_code: null,
      },
    ])
    expect(
      (await db.asUser(s.editorB, client => client.query('SELECT * FROM app.media_upload_status($1)', [intentId])))
        .rows,
    ).toEqual([])
  })
})
