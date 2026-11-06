import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
import { CHECKED_CLEAN, expectSqlState, TestDatabase } from './harness.ts'
let db: TestDatabase
let s: Scenario
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

beforeAll(async () => {
  db = await TestDatabase.create('sharing_media')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
async function page() {
  return db.asUser(
    s.editorA,
    async c =>
      (
        await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          `share-${randomUUID().slice(0, 8)}`,
          'Sharing image',
        ])
      ).rows[0]!.id,
  )
}
async function save(pageId: string, address: string, content = heroContent(s.heroDefId)) {
  return db.asUser(
    s.editorA,
    async c =>
      (
        await c.query<{ version_id: string; revision: string }>('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          pageId,
          content,
          JSON.stringify({ social_image: address }),
        ])
      ).rows[0]!,
  )
}
const resolve = (host: string, mediaId: string) =>
  db.as(
    'public',
    async c => (await c.query("SELECT media_id FROM public_api.resolve_media($1,$2,'wide')", [host, mediaId])).rows,
  )

it('indexes metadata-only shared media, binds public delivery to live usage, and includes it in the archive', async () => {
  const mediaId = await readyMedia(null, 'Sharing only')
  const pageId = await page()
  const address = `/media/${mediaId}/wide`
  const saved = await save(pageId, address)
  expect(
    (
      await db.asUser(s.editorA, c =>
        c.query('SELECT media_id FROM media_usage WHERE version_id=$1', [saved.version_id]),
      )
    ).rows,
  ).toEqual([{ media_id: mediaId }])
  expect(await resolve('site-a.staging.example.test', mediaId)).toEqual([])
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, saved.revision, ...CHECKED_CLEAN]),
  )
  expect(await resolve('site-a.staging.example.test', mediaId)).toEqual([{ media_id: mediaId }])
  expect(await resolve('site-b.staging.example.test', mediaId)).toEqual([])
  const bundle = (
    await db.asUser(s.superAdmin, c => c.query('SELECT app.export_site_content($1) AS bundle', [s.siteA]))
  ).rows[0]!.bundle
  expect(bundle.content.media.some((m: { id: string }) => m.id === mediaId)).toBe(true)
  expect(bundle.content.page_versions.find((v: { id: string }) => v.id === saved.version_id).meta.social_image).toBe(
    address,
  )
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('SELECT app.soft_delete_media($1,1,false,NULL)', [mediaId])),
    'CMS04',
  )
})

it('refuses cross-site and missing rendition references atomically on save', async () => {
  const foreign = await readyMedia(s.siteB, 'Foreign sharing image')
  const pageId = await page()
  await expectSqlState(save(pageId, `/media/${foreign}/wide`), 'CMS04')
  const owned = await readyMedia(s.siteA, 'Missing rendition')
  await db.as('owner', c => c.query("DELETE FROM media_variants WHERE media_id=$1 AND kind='wide'", [owned]))
  await expectSqlState(save(pageId, `/media/${owned}/wide`), 'CMS04')
  expect(
    (await db.asUser(s.editorA, c => c.query('SELECT revision FROM pages WHERE id=$1', [pageId]))).rows[0]!.revision,
  ).toBe('0')
})

it('rechecks metadata-only media at publication after an explicit deletion', async () => {
  const mediaId = await readyMedia(s.siteA, 'Deleted before publish')
  const pageId = await page()
  const saved = await save(pageId, `/media/${mediaId}/wide`)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.soft_delete_media($1,1,true,$2)', [
      mediaId,
      'Intentionally testing a broken sharing image reference',
    ]),
  )
  await expectSqlState(
    db.asUser(s.editorA, c =>
      c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, saved.revision, ...CHECKED_CLEAN]),
    ),
    'CMS04',
  )
})

it('rejects malformed governed URLs but permits a genuine external HTTPS image without inventing a media UUID', async () => {
  const pageId = await page()
  await expectSqlState(save(pageId, '/media/not-an-id/wide'), 'CMS04')
  await expectSqlState(save(pageId, `/media/${randomUUID()}/WIDE`), 'CMS04')
  const saved = await save(pageId, 'https://images.example.org/share.jpg')
  expect(
    (
      await db.asUser(s.editorA, c =>
        c.query('SELECT media_id FROM media_usage WHERE version_id=$1', [saved.version_id]),
      )
    ).rows,
  ).toEqual([])
})

it('deduplicates a picture used in both body content and sharing metadata', async () => {
  const mediaId = await readyMedia(s.siteA, 'One picture')
  const content = JSON.parse(heroContent(s.heroDefId))
  content[0].values.photo = { media_id: mediaId, variant: 'wide', alt: 'One picture' }
  const saved = await save(await page(), `/media/${mediaId}/wide`, JSON.stringify(content))
  expect(
    (
      await db.asUser(s.editorA, c =>
        c.query('SELECT media_id FROM media_usage WHERE version_id=$1', [saved.version_id]),
      )
    ).rows,
  ).toEqual([{ media_id: mediaId }])
})
