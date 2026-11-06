import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, heroContent, type Scenario } from '@cms/schema/fixtures'
import { uploadSiteDocument, type MediaStore } from '@cms/platform'
import {
  exportSiteArchiveInTransaction,
  importSiteArchiveInTransaction,
  importedId,
} from '../src/lib/site-portability.ts'

let db: TestDatabase, s: Scenario
const bytes = new Map<string, Uint8Array>()
const store: MediaStore = {
  get: async key => bytes.get(key) ?? null,
  put: async (key, value, contentType) => {
    bytes.set(key, value)
    return { objectKey: key, bytes: value.length, contentType }
  },
  remove: async () => {},
  createSignedUpload: async () => {
    throw new Error('unused')
  },
}
beforeAll(async () => {
  db = await TestDatabase.create('recipedocarchive')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('round-trips recipe pins, samples, retirement and document categories without publishing or rewriting source', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
  const { document, recipe } = await db.asUser(s.superAdmin, async client => {
    const document = await uploadSiteDocument({
      client,
      store,
      siteId: s.siteA,
      bytes: pdf,
      originalName: 'Archived annual report.pdf',
    })
    await client.query('SELECT app.organize_site_document($1,$2,0,$3,true)', [s.siteA, document.id, 'Annual reports'])
    const version = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        s.pageA,
        heroContent(s.heroDefId, 'Reusable heading'),
        '{}',
      ])
    ).rows[0]!
    const source = (await client.query('SELECT draft_version_id FROM pages WHERE id=$1', [s.pageA])).rows[0]!
      .draft_version_id
    const recipe = (
      await client.query('SELECT app.save_page_recipe($1,NULL,0,$2,$3,$4) AS id', [
        s.siteA,
        'Yearly conference',
        source,
        JSON.stringify([{ index: 0, sample: true }]),
      ])
    ).rows[0]!.id
    await client.query('SELECT app.manage_page_recipe($1,1,$2,true)', [recipe, 'Yearly conference'])
    return { document, recipe, version }
  })
  const archive = await db.asUser(s.superAdmin, c => exportSiteArchiveInTransaction(c, s.siteA, store))
  expect(archive.content.document_metadata).toEqual([
    { asset_id: document.id, category: 'Annual reports', archived: true },
  ])
  expect(archive.content.page_recipes?.[0]?.retired_at).not.toBeNull()
  const request = randomUUID(),
    destination = { slug: 'recipe-document-copy', name: 'Independent copy' }
  await db.asUser(s.superAdmin, c => importSiteArchiveInTransaction(c, request, destination, archive, store))
  const copy = await db.asUser(s.superAdmin, c => exportSiteArchiveInTransaction(c, request, store))
  expect(copy.content.document_metadata).toEqual([
    { asset_id: importedId(request, document.id), category: 'Annual reports', archived: true },
  ])
  expect(copy.content.page_recipe_versions?.[0]?.content[0]?.values.heading).toBe('Reusable heading')
  expect(copy.content.page_recipe_versions?.[0]?.content[0]?.section_def_id).toBe(importedId(request, s.heroDefId))
  expect(copy.content.page_recipes?.[0]?.id).toBe(importedId(request, recipe))
  expect(copy.content.page_recipes?.[0]?.current_version_id).toBe(copy.content.page_recipe_versions?.[0]?.id)
  expect(copy.content.pages.every(row => row.published_version_id === null)).toBe(true)
  expect(copy.objects.map(row => row.base64)).toEqual(archive.objects.map(row => row.base64))
  // A retried import validates its original fingerprint but does not reset later organization.
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.organize_site_document($1,$2,0,$3,false)', [
      request,
      importedId(request, document.id),
      'Restored',
    ]),
  )
  await db.asUser(s.superAdmin, c => importSiteArchiveInTransaction(c, request, destination, archive, store))
  const metadata = await db.asUser(s.superAdmin, c =>
    c.query('SELECT category,archived FROM site_document_metadata WHERE site_id=$1', [request]),
  )
  expect(metadata.rows).toEqual([{ category: 'Restored', archived: false }])
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT category,archived FROM site_document_metadata WHERE site_id=$1', [s.siteA]),
      )
    ).rows,
  ).toEqual([{ category: 'Annual reports', archived: true }])
  for (const fn of ['export_site_content_before_recipes', 'import_site_content_before_recipes']) {
    const sql = fn.startsWith('export') ? `SELECT app.${fn}($1)` : `SELECT app.${fn}($1,'{}','{}')`
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query(sql, [s.siteA])),
      '42501',
    )
  }
})
