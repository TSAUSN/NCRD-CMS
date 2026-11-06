import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
let db: TestDatabase, s: Scenario, photo: string
beforeAll(async () => {
  db = await TestDatabase.create('collection-validator-scope')
  s = await seedScenario(db)
  photo = randomUUID()
  await db.as('owner', async c => {
    await c.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'Private.png','[Private photo]',10,10,100,'image/png','ready')",
      [photo, s.siteB, 'validator/' + photo + '.png', 'a'.repeat(64)],
    )
    await c.query(
      "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,10,10,90,'image/webp')",
      [photo, 'validator/' + photo + '-wide.webp', 'b'.repeat(64)],
    )
  })
})
afterAll(async () => {
  await db?.close()
})
it('keeps another site’s private Media outside direct collection validation', async () => {
  const fields = JSON.stringify([{ key: 'photo', label: 'Photo', type: 'image', required: true }]),
    values = JSON.stringify({ photo: { src: '/media/' + photo + '/wide', alt: '[Private photo]', decorative: false } })
  const validate = (user: string, site: string) =>
    db.asUser(
      user,
      async c =>
        (await c.query('SELECT app.collection_entry_values_defect($1,$2,$3) AS defect', [site, fields, values]))
          .rows[0]!.defect,
    )
  expect(await validate(s.editorB, s.siteB)).toBeNull()
  expect(await validate(s.superAdmin, s.siteB)).toBeNull()
  expect(await validate(s.editorA, s.siteA)).toBe('Photo names media that is unavailable to this site')
  expect(await validate(s.editorA, s.siteB)).toBe('Photo names media that is unavailable to this site')
})

it('keeps the input-only URL predicate safe and unavailable to public and worker callers', async () => {
  const check = (role: 'authenticated' | 'public' | 'worker', value: string) =>
    db.as(role, async c => (await c.query('SELECT app.collection_url_is_safe($1) AS safe', [value])).rows[0]!.safe)
  expect(await check('authenticated', '/about')).toBe(true)
  expect(await check('authenticated', 'javascript:alert(1)')).toBe(false)
  await expectSqlState(check('public', '/about'), '42501')
  await expectSqlState(check('worker', '/about'), '42501')
})
