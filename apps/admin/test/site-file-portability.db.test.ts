import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { registerReviewedSiteFile, type MediaStore } from '@cms/platform'
import { type SiteArchive } from '@cms/schema'
import {
  exportSiteArchiveInTransaction,
  importSiteArchiveInTransaction,
  importedId,
  prepareSiteArchive,
} from '../src/lib/site-portability.ts'
let db: TestDatabase, s: Scenario, archive: SiteArchive, archivedPage: string
const stored = new Map<string, Uint8Array>()
const media: MediaStore = {
  get: async key => stored.get(key) ?? null,
  put: async (key, body, contentType) => {
    stored.set(key, body)
    return { objectKey: key, bytes: body.length, contentType }
  },
  remove: async key => {
    stored.delete(key)
  },
  createSignedUpload: async () => {
    throw Error('unused')
  },
}
beforeAll(async () => {
  db = await TestDatabase.create('filearchive')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async client => {
    archivedPage = (await client.query("SELECT app.create_page($1,'earlier','Earlier page') AS id", [s.siteA])).rows[0]!
      .id
    const data = await registerReviewedSiteFile({
      client,
      store: media,
      siteId: s.siteA,
      kind: 'data',
      name: 'items.json',
      source: 'local:js/items.json',
      bytes: Buffer.from('{"items":["one"]}'),
    })
    for (let version = 1; version <= 2; version++) {
      const file = await registerReviewedSiteFile({
        client,
        store: media,
        siteId: s.siteA,
        kind: 'script',
        name: 'original.js',
        source: 'local:js/original-v' + version + '.js',
        bytes: Buffer.from('window.originalVersion=' + version + ';'),
      })
      await client.query('SELECT app.save_site_file_bundle($1,$2,$3)', [
        s.siteA,
        version - 1,
        JSON.stringify({
          version: 1,
          files: [file.id, data.id],
          scripts: [
            { fileId: file.id, position: 'body-end', loading: 'normal', pages: version === 1 ? [archivedPage] : [] },
          ],
          styles: [],
          paths: [
            { path: '/js/original.js', fileId: file.id },
            { path: '/js/items.json', fileId: data.id },
          ],
        }),
      ])
    }
  })
  // Existing immutable history can outlive the pages it originally enhanced.
  await db.as('owner', client =>
    client.query("UPDATE pages SET archived_at=now(),status='archived' WHERE id=$1", [archivedPage]),
  )
  archive = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, s.siteA, media))
})
afterAll(async () => {
  await db?.close()
})
it('exports every immutable file and version, including a removed choice and its archived page binding', () => {
  expect(archive.content.site_files).toHaveLength(3)
  expect(archive.content.site_file_versions).toHaveLength(2)
  expect(archive.objects).toHaveLength(3)
  expect(archive.content.site_file_versions![0]!.bundle.scripts[0]!.pages).toEqual([archivedPage])
  for (const forbidden of ['object_key', 'created_by', 'reviewed_by', 'memberships'])
    expect(JSON.stringify(archive)).not.toContain(forbidden)
})
it('requires fresh review before object writes, then imports exact bytes and private history idempotently', async () => {
  const requestId = randomUUID(),
    destination = { slug: 'file-copy', name: 'File copy' },
    before = stored.size
  await expect(
    db.asUser(s.superAdmin, client => importSiteArchiveInTransaction(client, requestId, destination, archive, media)),
  ).rejects.toThrow(/Review every site file/)
  expect(stored.size).toBe(before)
  const copied = await db.asUser(s.superAdmin, client =>
    importSiteArchiveInTransaction(client, requestId, destination, archive, media, true),
  )
  expect(copied).toBe(requestId)
  expect(
    await db.asUser(s.superAdmin, client =>
      importSiteArchiveInTransaction(client, requestId, destination, archive, media, true),
    ),
  ).toBe(copied)
  const exported = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, copied, media))
  expect(exported.objects.map(row => row.base64).sort()).toEqual(archive.objects.map(row => row.base64).sort())
  expect(exported.content.site_file_versions).toHaveLength(2)
  expect(exported.content.site_file_versions![0]!.bundle.scripts[0]!.pages).toEqual([
    importedId(requestId, archivedPage),
  ])
  const sourceFiles = new Map(archive.content.site_files!.map(file => [file.id, file]))
  for (const [index, version] of exported.content.site_file_versions!.entries())
    for (const id of archive.content.site_file_versions![index]!.bundle.files) {
      const file = sourceFiles.get(id)!
      expect(version.bundle.paths).toContainEqual({
        path: `/site-files/${id}/${file.sha256}/${file.name}`,
        fileId: importedId(requestId, id),
      })
    }
  await db.as('owner', async client => {
    expect(
      (await client.query('SELECT revision,published_version_id FROM site_file_heads WHERE site_id=$1', [copied])).rows,
    ).toEqual([{ revision: '2', published_version_id: null }])
    expect((await client.query('SELECT * FROM published_site_shells WHERE site_id=$1', [copied])).rows).toEqual([])
    expect(
      (await client.query("SELECT id FROM audit_log WHERE site_id=$1 AND action='site.files.import'", [copied])).rows,
    ).toHaveLength(1)
  })
  const changed = structuredClone(archive)
  changed.content.site_files![0]!.source = 'local:different-source.js'
  await expectSqlState(
    db.asUser(s.superAdmin, client =>
      importSiteArchiveInTransaction(client, requestId, destination, changed, media, true),
    ),
    'CMS04',
  )
})
it('independently refuses missing review, foreign file bindings and foreign history pointers in SQL, with complete rollback', async () => {
  for (const defect of ['review', 'file', 'pointer'] as const) {
    const id = randomUUID(),
      prepared = await prepareSiteArchive(id, { slug: 'bad-files-' + defect, name: 'Invalid file copy' }, archive)
    if (defect === 'file') prepared.bundle.site_file_versions![0]!.bundle.scripts[0]!.fileId = randomUUID()
    if (defect === 'pointer') prepared.bundle.site_file_heads![0]!.draft_version_id = randomUUID()
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT app.import_site_content($1,$2,$3)', [
          id,
          JSON.stringify({ ...prepared.bundle, ...(defect === 'review' ? {} : { site_file_reviewed: true }) }),
          '{}',
        ]),
      ),
      'CMS04',
    )
    expect((await db.as('owner', client => client.query('SELECT id FROM sites WHERE id=$1', [id]))).rows).toEqual([])
  }
  await expectSqlState(
    db.asUser(s.editorA, client => client.query('SELECT app.export_site_content($1)', [s.siteA])),
    'CMS02',
  )
})
