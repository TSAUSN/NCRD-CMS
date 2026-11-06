import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { ensureEchelonSite } from '../src/lib/echelon-site.ts'
import { randomUUID } from 'node:crypto'
let db: TestDatabase, s: Scenario, site: string, mediaId: string
vi.mock('server-only', () => ({}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import { listSectionLibrary, listPageSectionVersions } from '../src/lib/queries.ts'
beforeAll(async () => {
  db = await TestDatabase.create('image_focus')
  s = await seedScenario(db)
  site = (await db.asUser(s.superAdmin, c => ensureEchelonSite(c, randomUUID()))).siteId
  mediaId = randomUUID()
  // Database-only Media fixture; browser focus uses the normal upload/processor path.
  await db.as('owner', async c => {
    await c.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,focal,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'Focus.png','[Reference photo]',$5,10,10,100,'image/png','ready')",
      [mediaId, site, 'focus/' + mediaId + '.png', 'a'.repeat(64), JSON.stringify({ x: 0.5, y: 0.5 })],
    )
    await c.query(
      "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,10,10,90,'image/webp')",
      [mediaId, 'focus/' + mediaId + '-wide.webp', 'b'.repeat(64)],
    )
  })
  await db.asUser(s.superAdmin, async c => {
    const head = (
      await c.query(
        "SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=''",
        [site],
      )
    ).rows[0]!
    head.content[0].values.photo = {
      media_id: mediaId,
      variant: 'wide',
      src: '/media/' + mediaId + '/wide',
      alt: '[Reference photo]',
      decorative: false,
      focal: { x: 0.5, y: 0.5 },
    }
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      head.id,
      head.revision,
      JSON.stringify(head.content),
      JSON.stringify(head.meta),
    ])
  })
})
afterAll(async () => {
  await db?.close()
})
it('keeps page focus in immutable private drafts without mutating the library image or earlier versions', async () => {
  await db.asUser(s.superAdmin, async c => {
    const head = (
      await c.query(
        "SELECT p.id,p.revision,p.draft_version_id,p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug=''",
        [site],
      )
    ).rows[0]!
    const before = structuredClone(head.content),
      photo = head.content[0].values.photo,
      libraryBefore = (await c.query('SELECT focal FROM media WHERE id=$1', [mediaId])).rows[0]!
    expect(photo.src).toBeTruthy()
    photo.focal = { x: 0.72, y: 0.23 }
    const saved = (
      await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        head.id,
        head.revision,
        JSON.stringify(head.content),
        JSON.stringify(head.meta),
      ])
    ).rows[0]!
    const current = (
      await c.query(
        'SELECT p.published_version_id,v.content,v.carries_trusted_code FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [head.id],
      )
    ).rows[0]!
    expect(current.content[0].values.photo.focal).toEqual({ x: 0.72, y: 0.23 })
    expect(current.carries_trusted_code).toBe(false)
    expect(current.published_version_id).toBe(head.published_version_id)
    expect(
      (await c.query('SELECT content FROM page_versions WHERE id=$1', [head.draft_version_id])).rows[0]!.content,
    ).toEqual(before)
    head.content[0].values.photo.focal = null
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      head.id,
      saved.revision,
      JSON.stringify(head.content),
      JSON.stringify(head.meta),
    ])
    expect(
      (await c.query('SELECT content FROM page_versions WHERE id=$1', [saved.version_id])).rows[0]!.content[0].values
        .photo.focal,
    ).toEqual({ x: 0.72, y: 0.23 })
    expect((await c.query('SELECT focal FROM media WHERE id=$1', [mediaId])).rows[0]).toEqual(libraryBefore)
  })
})

it('derives focus support from the actual pinned renderer shape without sending compiled source to the inspector', async () => {
  const library = await listSectionLibrary(s.superAdmin, site),
    hero = library.find(row => row.slug === 'core-split-hero')!
  expect(hero.image_focus_supported).toBe(true)
  expect(Object.hasOwn(hero, 'compiled_ast')).toBe(false)
  const page = (
    await db.asUser(s.superAdmin, c => c.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [site]))
  ).rows[0]!.id
  const pinned = await listPageSectionVersions(s.superAdmin, page)
  expect(pinned.find(row => row.slug === 'core-split-hero')!.image_focus_supported).toBe(true)
  expect((await listSectionLibrary(s.editorB, site)).some(row => row.site_id === site)).toBe(false)
})
