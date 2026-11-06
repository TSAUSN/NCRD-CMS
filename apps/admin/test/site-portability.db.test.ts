import { installCoreLibrary } from '@cms/seeds/core-install'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { type MediaStore } from '@cms/platform'
import { type SiteArchive } from '@cms/schema'
import { createHash } from 'node:crypto'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { publishStarterFixture } from './site-fixture.ts'
import {
  exportSiteArchiveInTransaction,
  importSiteArchiveInTransaction,
  importedId,
  prepareSiteArchive,
  remapArchiveValue,
} from '../src/lib/site-portability.ts'

let db: TestDatabase, s: Scenario, sourceSite: string, archive: SiteArchive
const objects = new Map<string, Uint8Array>()
const media: MediaStore = {
  get: async key => objects.get(key) ?? null,
  put: async (key, body, contentType) => {
    objects.set(key, body)
    return { objectKey: key, bytes: body.length, contentType }
  },
  remove: async key => {
    objects.delete(key)
  },
  createSignedUpload: async () => {
    throw new Error('unused')
  },
}
beforeAll(async () => {
  db = await TestDatabase.create('portability')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, client => installCoreLibrary(client))
  const setup = { ...starterSiteSetup('event'), name: 'Source site', slug: 'source-site' }
  sourceSite = (
    await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(client, randomUUID(), setup, 'source-site.staging.example.test'),
    )
  ).siteId
  await db.asUser(s.superAdmin, async client => {
    await publishStarterFixture(client, sourceSite)
    const page = (
      await client.query(
        'SELECT p.*,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 ORDER BY p.sort_index LIMIT 1',
        [sourceSite],
      )
    ).rows[0]!
    const content = page.content
    content[0].values.heading = 'Private draft heading'
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      page.id,
      page.revision,
      JSON.stringify(content),
      JSON.stringify(page.meta),
      'checkpoint',
      'Private editorial change',
    ])
  })
  const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#2266cc' } })
    .png()
    .toBuffer()
  const webp = await sharp(png).webp().toBuffer(),
    mediaId = randomUUID()
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  objects.set('source/original.png', png)
  objects.set('source/wide.webp', webp)
  await db.as('owner', async client => {
    await client.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,'source/original.png',$3,'blue.png','Blue square',16,12,$4,'image/png','ready')",
      [mediaId, sourceSite, hash(png), png.length],
    )
    await client.query(
      "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide','source/wide.webp',$2,16,12,$3,'image/webp')",
      [mediaId, hash(webp), webp.length],
    )
  })
  await db.asUser(s.superAdmin, async client => {
    const sharingPage = (
      await client.query(
        'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 ORDER BY p.sort_index LIMIT 1',
        [sourceSite],
      )
    ).rows[0]!
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      sharingPage.id,
      sharingPage.revision,
      JSON.stringify(sharingPage.content),
      JSON.stringify({ ...sharingPage.meta, social_image: `/media/${mediaId}/wide` }),
    ])
    const collection = (
      await client.query("SELECT * FROM collections WHERE site_id=$1 AND reader_key='speakers'", [sourceSite])
    ).rows[0]
    const values = {
      name: 'Transfer speaker',
      role: 'Guest',
      bio: '<p>Preserved rich text.</p>',
      photo: { src: `/media/${mediaId}/wide`, alt: 'Blue square', decorative: false },
    }
    await client.query('SELECT app.save_collection_entries($1,$2,$3)', [
      collection.id,
      0,
      JSON.stringify([{ id: null, stableKey: 'transfer-speaker', values }]),
    ])
    await client.query('SELECT app.publish_collection_entries($1,$2)', [collection.id, 1])
    const entry = (await client.query('SELECT id FROM collection_entries WHERE collection_id=$1', [collection.id]))
      .rows[0]
    const entryRevision = (await client.query('SELECT entry_revision FROM collections WHERE id=$1', [collection.id]))
      .rows[0].entry_revision
    await client.query('SELECT app.save_collection_entries($1,$2,$3)', [
      collection.id,
      entryRevision,
      JSON.stringify([
        { id: entry.id, stableKey: 'transfer-speaker', values: { ...values, name: 'Private speaker revision' } },
      ]),
    ])
    const head = (
      await client.query(
        "SELECT g.*,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind='header'",
        [sourceSite],
      )
    ).rows[0]
    const footer = (
      await client.query(
        "SELECT g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind='footer'",
        [sourceSite],
      )
    ).rows[0]
    await client.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      sourceSite,
      head.revision,
      footer.revision,
      JSON.stringify({ ...head.content, brand: { ...head.content.brand, logoMediaId: mediaId } }),
      JSON.stringify(footer.content),
    ])
  })
  archive = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, sourceSite, media))
})
afterAll(async () => {
  await db?.close()
})

describe('portable full-site content', () => {
  it('exports all immutable content history and embedded media without account/provider data', async () => {
    expect(archive.content.page_versions.length).toBeGreaterThan(archive.content.pages.length)
    expect(archive.objects).toHaveLength(2)
    const json = JSON.stringify(archive)
    for (const forbidden of [
      'object_key',
      'author_id',
      'created_by',
      'trusted_code_approved',
      'memberships',
      'auth_subject',
      'upload_token',
      'source/original.png',
    ])
      expect(json).not.toContain(forbidden)
    expect(
      archive.content.page_versions.some(row => row.content[0]?.values['heading'] === 'Private draft heading'),
    ).toBe(true)
  })
  it('round-trips every content version and media byte into an isolated unpublished site, and retries once', async () => {
    const requestId = randomUUID(),
      destination = { slug: 'imported-site', name: 'Imported site' }
    const imported = await db.asUser(s.superAdmin, client =>
      importSiteArchiveInTransaction(client, requestId, destination, archive, media),
    )
    const again = await db.asUser(s.superAdmin, client =>
      importSiteArchiveInTransaction(client, requestId, destination, archive, media),
    )
    expect(again).toBe(imported)
    const exported = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, imported, media))
    const reverse = new Map<string, string>()
    for (const list of Object.values(archive.content))
      if (Array.isArray(list))
        for (const row of list) if ('id' in row) reverse.set(importedId(requestId, row.id), row.id)
    for (const key of [
      'page_versions',
      'theme_versions',
      'navigation_versions',
      'global_element_versions',
      'site_setting_versions',
      'collection_schema_versions',
      'collection_entry_versions',
    ] as const) {
      expect(
        (remapArchiveValue(exported.content[key], reverse) as { id: string }[]).sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      ).toEqual([...archive.content[key]].sort((a, b) => a.id.localeCompare(b.id)))
    }
    expect(exported.objects.map(row => row.base64).sort()).toEqual(archive.objects.map(row => row.base64).sort())
    await db.as('owner', async client => {
      expect(
        (
          await client.query(
            "SELECT u.media_id FROM page_versions v JOIN media_usage u ON u.version_id=v.id WHERE v.site_id=$1 AND v.meta->>'social_image' = '/media/' || u.media_id::text || '/wide'",
            [imported],
          )
        ).rows.length,
      ).toBeGreaterThan(0)
      for (const table of ['pages', 'themes', 'navigations', 'global_elements', 'site_settings', 'collection_entries'])
        expect(
          (
            await client.query(`SELECT id FROM ${table} WHERE site_id=$1 AND published_version_id IS NOT NULL`, [
              imported,
            ])
          ).rows,
        ).toEqual([])
      for (const table of [
        'published_routes',
        'published_site_shells',
        'domains',
        'scheduled_actions',
        'site_memberships',
      ])
        expect((await client.query(`SELECT * FROM ${table} WHERE site_id=$1`, [imported])).rows).toEqual([])
      expect(
        (await client.query("SELECT id FROM audit_log WHERE site_id=$1 AND action='site.import'", [imported])).rows,
      ).toHaveLength(1)
      const queued = (
        await client.query(
          "SELECT payload FROM outbox WHERE site_id=$1 AND event_type='section_def.thumbnail_requested'",
          [imported],
        )
      ).rows
      const active = new Set(archive.content.section_defs.filter(row => row.status === 'active').map(row => row.id))
      expect(queued).toHaveLength(
        archive.content.section_def_versions.filter(row => active.has(row.section_def_id)).length,
      )
      expect(new Set(queued.map(row => `${row.payload.section_def_id}:${row.payload.version}`)).size).toBe(
        queued.length,
      )
      expect(queued.every(row => row.payload.slug.startsWith('import-'))).toBe(true)
      // An imported site gets its private preview address as a wizard-made one does (0110).
      expect(
        (await client.query('SELECT staging_hostname FROM sites WHERE id=$1', [imported])).rows[0].staging_hostname,
      ).toBe('imported-site.staging.localhost')
    })
  })
  it('refuses export by an editor and by an unrelated tenant, and refuses raw SQL import by an editor', async () => {
    await expectSqlState(
      db.asUser(s.editorA, client => client.query('SELECT app.export_site_content($1)', [sourceSite])),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.editorB, client => client.query('SELECT app.export_site_content($1)', [sourceSite])),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.editorA, client => client.query("SELECT app.import_site_content($1,'{}','{}')", [randomUUID()])),
      'CMS02',
    )
  })
  it('rolls back all database rows when a content reference is invalid even around app validation', async () => {
    const requestId = randomUUID(),
      prepared = await prepareSiteArchive(requestId, { slug: 'bad-import', name: 'Bad import' }, archive)
    prepared.bundle.page_versions[0]!.content[0]!.section_def_id = s.heroDefId
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT app.import_site_content($1,$2,$3)', [requestId, JSON.stringify(prepared.bundle), '{}']),
      ),
      'CMS04',
    )
    expect(
      (await db.as('owner', client => client.query('SELECT id FROM sites WHERE id=$1', [requestId]))).rows,
    ).toEqual([])
  })
  it('refuses corrupt image bytes before writing media or a site', async () => {
    const bad = structuredClone(archive)
    bad.objects[0]!.base64 = 'YWJj'
    const before = objects.size,
      requestId = randomUUID()
    await expect(
      db.asUser(s.superAdmin, client =>
        importSiteArchiveInTransaction(client, requestId, { slug: 'corrupt-import', name: 'Corrupt' }, bad, media),
      ),
    ).rejects.toThrow(/checksum/)
    expect(objects.size).toBe(before)
    expect(
      (await db.as('owner', client => client.query('SELECT id FROM sites WHERE id=$1', [requestId]))).rows,
    ).toEqual([])
  })
  it('refuses a foreign logo even when the SQL command is called directly', async () => {
    const requestId = randomUUID(),
      prepared = await prepareSiteArchive(requestId, { slug: 'foreign-logo', name: 'Foreign logo' }, archive)
    // Pick the actual header through its owning workspace rather than assuming row order.
    const headerId = prepared.bundle.global_elements.find(row => row.kind === 'header')!.id
    const version = prepared.bundle.global_element_versions.find(row => row.global_element_id === headerId)!
    const content = version.content as { brand: { logoMediaId: string | null } }
    content.brand.logoMediaId = archive.content.media[0]!.id
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT app.import_site_content($1,$2,$3)', [requestId, JSON.stringify(prepared.bundle), '{}']),
      ),
      'CMS04',
    )
    expect(
      (await db.as('owner', client => client.query('SELECT id FROM sites WHERE id=$1', [requestId]))).rows,
    ).toEqual([])
  })
  it('preserves historical theme defaults without silently rewriting their JSON', async () => {
    const old = structuredClone(archive),
      version = old.content.theme_versions[0]!
    const tokens = version.tokens as unknown as Record<string, unknown>
    delete tokens['spacing']
    delete tokens['buttons']
    const requestId = randomUUID()
    await db.asUser(s.superAdmin, client =>
      importSiteArchiveInTransaction(client, requestId, { slug: 'older-theme', name: 'Older theme' }, old, media),
    )
    const copied = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, requestId, media))
    expect(copied.content.theme_versions.find(row => row.id === importedId(requestId, version.id))!.tokens).toEqual(
      tokens,
    )
  })
  it('backfills an older imported library once without duplicating its existing requests', async () => {
    const oldMigration = await readFile(
      new URL('../../../packages/schema/migrations/0061_site_portability.sql', import.meta.url),
      'utf8',
    )
    const nextMigration = await readFile(
      new URL('../../../packages/schema/migrations/0070_portability_followthrough.sql', import.meta.url),
      'utf8',
    )
    const start = oldMigration.indexOf('CREATE FUNCTION app.import_site_content(')
    const oldCommand = oldMigration
      .slice(start, oldMigration.indexOf('END $$;', start) + 7)
      .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
    const requestId = randomUUID()
    try {
      await db.as('owner', client => client.query(oldCommand))
      await db.asUser(s.superAdmin, client =>
        importSiteArchiveInTransaction(
          client,
          requestId,
          { slug: 'older-library', name: 'Older library' },
          archive,
          media,
        ),
      )
      expect(
        (
          await db.as('owner', client =>
            client.query("SELECT id FROM outbox WHERE site_id=$1 AND event_type='section_def.thumbnail_requested'", [
              requestId,
            ]),
          )
        ).rows,
      ).toHaveLength(0)
      await db.as('owner', client => client.query(nextMigration))
      const first = (
        await db.as('owner', client =>
          client.query(
            "SELECT id FROM outbox WHERE site_id=$1 AND event_type='section_def.thumbnail_requested' ORDER BY id",
            [requestId],
          ),
        )
      ).rows
      expect(first.length).toBeGreaterThan(0)
      await db.as('owner', client => client.query(nextMigration))
      const repeated = (
        await db.as('owner', client =>
          client.query(
            "SELECT id FROM outbox WHERE site_id=$1 AND event_type='section_def.thumbnail_requested' ORDER BY id",
            [requestId],
          ),
        )
      ).rows
      expect(repeated).toEqual(first)
    } finally {
      await db.as('owner', client => client.query(nextMigration))
    }
  })
  it('requires the ordinary readiness/publication command before making an imported page live', async () => {
    const requestId = randomUUID()
    await db.asUser(s.superAdmin, client =>
      importSiteArchiveInTransaction(client, requestId, { slug: 'review-import', name: 'Review copy' }, archive, media),
    )
    const page = (
      await db.asUser(s.superAdmin, client =>
        client.query('SELECT * FROM pages WHERE site_id=$1 ORDER BY sort_index LIMIT 1', [requestId]),
      )
    ).rows[0]
    // No shortcut publication was used during import; a later command is explicit.
    expect(page.published_version_id).toBeNull()
    expect(page.draft_version_id).not.toBeNull()
  })
})
