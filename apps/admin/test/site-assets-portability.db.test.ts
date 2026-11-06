import { installCoreLibrary } from '@cms/seeds/core-install'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { importFrozenSiteAsset, type MediaStore } from '@cms/platform'
import { createHash } from 'node:crypto'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import {
  exportSiteArchiveInTransaction,
  importSiteArchiveInTransaction,
  importedId,
} from '../src/lib/site-portability.ts'
let db: TestDatabase, s: Scenario
const storage = new Map<string, Uint8Array>()
const media: MediaStore = {
  get: async key => storage.get(key) ?? null,
  put: async (key, body, contentType) => {
    storage.set(key, body)
    return { objectKey: key, bytes: body.length, contentType }
  },
  remove: async key => {
    storage.delete(key)
  },
  createSignedUpload: async () => {
    throw new Error('unused')
  },
}
beforeAll(async () => {
  db = await TestDatabase.create('assetarchive')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, client => installCoreLibrary(client))
})
afterAll(async () => {
  await db?.close()
})
it('exports verified document bytes, remaps references into a private copy, and re-exports the same bytes', async () => {
  const bytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const source = await db.asUser(s.superAdmin, async client => {
    const site = (
      await createSiteFromSetupInTransaction(
        client,
        randomUUID(),
        { ...starterSiteSetup('resource'), name: 'Documents', slug: 'asset-docs' },
        'asset-docs.staging.example.test',
      )
    ).siteId
    const asset = await importFrozenSiteAsset({
      client,
      store: media,
      siteId: site,
      bytes,
      kind: 'document',
      originalName: 'report.pdf',
      provenance: { path: 'frozen/report.pdf', sha256, manifest_sha256: 'a'.repeat(64) },
    })
    const same = await importFrozenSiteAsset({
      client,
      store: media,
      siteId: site,
      bytes,
      kind: 'document',
      originalName: 'report.pdf',
      provenance: { path: 'frozen/report.pdf', sha256, manifest_sha256: 'a'.repeat(64) },
    })
    expect(same.assetId).toBe(asset.assetId)
    const page = (
      await client.query(
        'SELECT p.*,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 LIMIT 1',
        [site],
      )
    ).rows[0]
    page.content[0].values.report = { url: asset.url, label: 'Download report' }
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      page.id,
      page.revision,
      JSON.stringify(page.content),
      JSON.stringify(page.meta),
    ])
    return { site, assetId: asset.assetId }
  })
  const archive = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, source.site, media))
  expect(archive.content.site_assets).toHaveLength(1)
  expect(archive.objects.find(object => object.kind === 'asset')?.base64).toBe(bytes.toString('base64'))
  const destination = randomUUID()
  await db.asUser(s.superAdmin, client =>
    importSiteArchiveInTransaction(
      client,
      destination,
      { name: 'Copied documents', slug: 'copied-documents' },
      archive,
      media,
    ),
  )
  const copied = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, destination, media))
  expect(copied.content.site_assets?.[0]?.id).toBe(importedId(destination, source.assetId))
  expect(copied.content.site_assets?.[0]?.provenance).toEqual(archive.content.site_assets?.[0]?.provenance)
  expect(copied.objects.find(object => object.kind === 'asset')?.base64).toBe(bytes.toString('base64'))
  expect(JSON.stringify(copied.content.page_versions)).toContain(`/assets/${importedId(destination, source.assetId)}`)
  expect(copied.content.pages.every(page => page.published_version_id === null)).toBe(true)
})
