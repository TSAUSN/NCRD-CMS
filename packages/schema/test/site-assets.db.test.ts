import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SITE_FONT_REGISTRY } from '../src/content/site-assets.ts'
import { CHECKED_CLEAN, expectSqlState, TestDatabase } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('siteassets')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
const digest = 'a'.repeat(64)
const provenance = (hash = digest) => ({
  path: 'asset/hni/public/files/report.pdf',
  sha256: hash,
  manifest_sha256: 'b'.repeat(64),
})
function add(site = s.siteA, user = s.superAdmin, font = false) {
  const id = randomUUID(),
    registered = SITE_FONT_REGISTRY['trajan-regular'],
    sha = font ? registered.sha256 : digest
  return db.asUser(user, async c => {
    await c.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
      site,
      id,
      font ? 'font' : 'document',
      `site-assets/${site}/${id}/${sha}`,
      font ? registered.mimeType : 'application/pdf',
      99,
      sha,
      font ? registered.filename : 'report.pdf',
      font ? 'trajan-regular' : null,
      JSON.stringify(provenance(sha)),
    ])
    return id
  })
}
async function save(assetId: string, explicit = false) {
  return db.asUser(s.editorA, async c => {
    const page = (
      await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, `asset-${randomUUID().slice(0, 8)}`, 'Asset'])
    ).rows[0].id
    const content = JSON.parse(heroContent(s.heroDefId))
    content[0].values.document = explicit ? { asset_id: assetId } : { url: `/assets/${assetId}`, label: 'Report' }
    const row = (
      await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [page, 0, JSON.stringify(content), '{}'])
    ).rows[0]
    return { page, version: row.version_id, revision: Number(row.revision) }
  })
}
const publicRead = (id: string, host = 'site-a.staging.example.test') =>
  db.as('public', c => c.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, id]))
describe('governed site assets', () => {
  it('requires super-admin import, exact font identities, and a bounded source receipt', async () => {
    await expectSqlState(add(s.siteA, s.editorA), 'CMS02')
    await db.asUser(s.superAdmin, async c => {
      const id = randomUUID()
      await expectSqlState(
        c.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
          s.siteA,
          id,
          'font',
          `site-assets/${s.siteA}/${id}/${digest}`,
          'font/otf',
          100,
          digest,
          'bad.otf',
          'trajan-regular',
          JSON.stringify(provenance()),
        ]),
        '23514',
      )
    })
  })
  it('keeps draft documents private, exposes only current published usage on the matching Host, and revokes after unpublish', async () => {
    const asset = await add(),
      saved = await save(asset)
    expect((await publicRead(asset)).rows).toEqual([])
    expect(
      (await db.asUser(s.editorB, c => c.query('SELECT id FROM app.resolve_site_asset($1)', [asset]))).rows,
    ).toEqual([])
    expect(
      (await db.asUser(s.editorA, c => c.query('SELECT id FROM app.resolve_site_asset($1)', [asset]))).rows,
    ).toEqual([{ id: asset }])
    await db.asUser(s.editorA, c =>
      c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [saved.page, saved.revision, ...CHECKED_CLEAN]),
    )
    expect((await publicRead(asset)).rows).toEqual([{ id: asset }])
    expect((await publicRead(asset, 'site-b.staging.example.test')).rows).toEqual([])
    expect((await publicRead(asset, 'unknown.example.test')).rows).toEqual([])
    const revision = (await db.asUser(s.editorA, c => c.query('SELECT revision FROM pages WHERE id=$1', [saved.page])))
      .rows[0].revision
    await db.asUser(s.editorA, c => c.query('SELECT * FROM app.unpublish_page($1,$2)', [saved.page, revision]))
    expect((await publicRead(asset)).rows).toEqual([])
  })
  it('indexes typed references and builds only the used registered font declarations', async () => {
    const font = await add(s.siteA, s.superAdmin, true),
      saved = await save(font, true)
    const manifest = (
      await db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1) AS manifest', [saved.version]))
    ).rows[0].manifest
    expect(manifest.fonts).toEqual([{ assetId: font, fontKey: 'trajan-regular' }])
    await expectSqlState(save(await add(s.siteB)), 'CMS04')
    await expectSqlState(save(randomUUID(), true), 'CMS04')
  })
  it('refuses direct mutation and keeps object keys outside ordinary SELECT grants', async () => {
    const asset = await add()
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('UPDATE site_assets SET original_name=$2 WHERE id=$1', [asset, 'changed.pdf']),
      ),
      '42501',
    )
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT object_key FROM site_assets WHERE id=$1', [asset])),
      '42501',
    )
  })
})
