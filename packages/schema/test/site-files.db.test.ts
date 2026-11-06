import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { EMPTY_SITE_FILE_BUNDLE, type SiteFileBundle } from '../src/content/site-files.ts'
import { TestDatabase, expectSqlState, CHECKED_CLEAN } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario, siteAdmin: string
const hash = 'a'.repeat(64)
beforeAll(async () => {
  db = await TestDatabase.create('sitefiles')
  s = await seedScenario(db)
  siteAdmin = await db.asUser(s.superAdmin, async c => {
    const id = (await c.query("SELECT app.provision_user('site-admin@example.test','Site admin') AS id")).rows[0]!.id
    await c.query("SELECT app.set_site_membership($1,$2,'site_admin')", [id, s.siteA])
    return id
  })
  await db.asUser(s.editorA, async c => {
    const saved = (
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId), '{}'])
    ).rows[0]!
    await c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, saved.revision, ...CHECKED_CLEAN])
  })
})
afterAll(async () => {
  await db?.close()
})
async function register(
  site = s.siteA,
  user = s.superAdmin,
  id: string = randomUUID(),
  name = 'site.js',
  kind = 'script',
  mime = 'text/javascript',
) {
  return db.asUser(
    user,
    async c =>
      (
        await c.query('SELECT app.register_site_file($1,$2,$3,$4,$5,$6,$7,$8) AS id', [
          site,
          id,
          kind,
          name,
          'local:js/' + name,
          mime,
          100,
          hash,
        ])
      ).rows[0]!.id as string,
  )
}
const bundle = (id: string, pages: string[] = []): SiteFileBundle => ({
  version: 1,
  files: [id],
  scripts: [{ fileId: id, position: 'body-end', loading: 'normal', pages }],
  styles: [],
})
async function save(value: SiteFileBundle, user = s.superAdmin) {
  return db.asUser(user, async c => {
    const revision =
      (await c.query('SELECT revision FROM site_file_heads WHERE site_id=$1', [s.siteA])).rows[0]?.revision ?? 0
    return (
      await c.query('SELECT * FROM app.save_site_file_bundle($1,$2,$3)', [s.siteA, revision, JSON.stringify(value)])
    ).rows[0]!
  })
}
async function release(client: PoolClient, items?: unknown[]) {
  await client.query('SELECT app.lock_release_site($1)', [s.siteA])
  const head = (await client.query('SELECT * FROM site_file_heads WHERE site_id=$1', [s.siteA])).rows[0]!
  const snapshot = items ?? [
    {
      key: 'site_files:' + s.siteA,
      type: 'site_files',
      id: s.siteA,
      label: 'Site scripts and files',
      revision: head.revision,
      versionId: head.draft_version_id,
      requiresAdmin: true,
    },
  ]
  const fingerprint = async () =>
    (await client.query('SELECT app.release_fingerprint($1) AS hash', [s.siteA])).rows[0]!.hash
  const before = await fingerprint()
  const apply = async () => {
    const recovery = (snapshot[0] as { recoveryId?: string }).recoveryId
    if (recovery) await client.query('SELECT app.apply_release_recovery_unpublishes($1)', [recovery])
    await client.query('SELECT app.publish_site_files($1,$2)', [s.siteA, head.revision])
  }
  await client.query('SAVEPOINT preview_files')
  await apply()
  const after = await fingerprint()
  await client.query('ROLLBACK TO SAVEPOINT preview_files')
  await client.query('RELEASE SAVEPOINT preview_files')
  const id = randomUUID()
  await client.query('SELECT app.record_site_release($1,$2,$3,$4,$5,$6)', [
    id,
    s.siteA,
    JSON.stringify(snapshot),
    before,
    after,
    '[]',
  ])
  await apply()
  await client.query('SELECT app.finish_site_release($1,false,$2)', [id, '{}'])
  return id
}
const readPublic = (id: string, host = 'site-a.staging.example.test') =>
  db.as('public', c => c.query('SELECT id,sha256 FROM public_api.resolve_site_file($1,$2)', [host, id]))
describe('reviewed site-file command boundary', () => {
  it('permits only Super Admins to add, review, replace, remove or publish scripts', async () => {
    for (const actor of [s.editorA, siteAdmin, s.contributorA, s.editorB]) {
      await expectSqlState(register(s.siteA, actor), 'CMS02')
      await expectSqlState(save(EMPTY_SITE_FILE_BUNDLE, actor), 'CMS02')
      await expectSqlState(
        db.asUser(actor, c => c.query('SELECT app.publish_site_files($1,0)', [s.siteA])),
        'CMS02',
      )
    }
    await expectSqlState(register(s.siteA, s.disabled), 'CMS02')
  })
  it('keeps immutable, idempotent receipts, hides foreign metadata and refuses direct writes/private keys', async () => {
    const id = await register()
    expect(await register(s.siteA, s.superAdmin, id)).toBe(id)
    await expectSqlState(register(s.siteA, s.superAdmin, id, 'changed.js'), 'CMS04')
    expect((await db.asUser(s.editorB, c => c.query('SELECT id FROM site_files WHERE id=$1', [id]))).rows).toEqual([])
    expect((await db.asUser(s.editorB, c => c.query('SELECT id FROM app.resolve_site_file($1)', [id]))).rows).toEqual(
      [],
    )
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('UPDATE site_files SET name=$2 WHERE id=$1', [id, 'changed.js'])),
      '42501',
    )
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT object_key FROM site_files WHERE id=$1', [id])),
      '42501',
    )
    await expectSqlState(
      db.as('public', c => c.query('SELECT id FROM public.site_files')),
      '42501',
    )
  })
  it('refuses missing/foreign/mistyped files, foreign pages, inline code and duplicate references', async () => {
    const id = await register(),
      foreign = await register(s.siteB),
      style = await register(s.siteA, s.superAdmin, randomUUID(), 'site.css', 'stylesheet', 'text/css')
    for (const value of [
      bundle(randomUUID()),
      bundle(foreign),
      bundle(style),
      bundle(id, [randomUUID()]),
      { ...bundle(id), files: [id, id] },
      { ...bundle(id), inline: 'bad()' },
      { ...bundle(id), scripts: [{ fileId: id, position: 'head', loading: 'normal', pages: [s.pageA, s.pageA] }] },
    ])
      await expectSqlState(save(value as SiteFileBundle), 'CMS04')
    await save(bundle(id, [s.pageA]))
    expect((await readPublic(id)).rows).toEqual([])
  })
  it('requires the loaded revision and keeps every approved replacement/removal version', async () => {
    const id = await register(),
      saved = await save(bundle(id))
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.save_site_file_bundle($1,$2,$3)', [
          s.siteA,
          Number(saved.revision) - 1,
          JSON.stringify(EMPTY_SITE_FILE_BUNDLE),
        ]),
      ),
      'CMS01',
    )
    const removed = await save(EMPTY_SITE_FILE_BUNDLE)
    expect(
      (
        await db.asUser(s.superAdmin, c =>
          c.query('SELECT bundle FROM site_file_versions WHERE id=$1', [saved.version_id]),
        )
      ).rows[0]!.bundle,
    ).toEqual(bundle(id))
    expect(removed.version_id).not.toBe(saved.version_id)
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('DELETE FROM site_file_versions WHERE id=$1', [saved.version_id])),
      '42501',
    )
  })
  it('refuses a standalone publish at commit and exposes only a completed release on its own host', async () => {
    const id = await register(),
      saved = await save(bundle(id))
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT app.publish_site_files($1,$2)', [s.siteA, saved.revision])),
      'CMS04',
    )
    expect((await readPublic(id)).rows).toEqual([])
    const releaseId = await db.asUser(s.superAdmin, c => release(c))
    expect((await readPublic(id)).rows).toEqual([{ id, sha256: hash }])
    for (const host of ['site-b.staging.example.test', 'unknown.example.test'])
      expect((await readPublic(id, host)).rows).toEqual([])
    const shell = (
      await db.as('owner', c => c.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [s.siteA]))
    ).rows[0]!.payload
    expect(shell.site_files.bundle).toEqual(bundle(id))
    expect(shell.site_files.files[0].object_key).toBeUndefined()
    expect(
      (
        await db.asUser(s.superAdmin, c =>
          c.query('SELECT version_id FROM site_release_file_pins WHERE release_id=$1', [releaseId]),
        )
      ).rows,
    ).toEqual([{ version_id: saved.version_id }])
    expect(
      (
        await db.asUser(s.superAdmin, c =>
          c.query("SELECT action FROM audit_log WHERE site_id=$1 AND action LIKE 'site.file%'", [s.siteA]),
        )
      ).rows.map(row => row.action),
    ).toEqual(expect.arrayContaining(['site.file.register', 'site.files.review', 'site.files.publish']))
  })
  it('restores a previous approved version while retaining a later private draft and exact release pins', async () => {
    const first = await register()
    await save(bundle(first))
    await db.asUser(s.superAdmin, c => release(c))
    const second = await register()
    await save(bundle(second))
    const releaseId = await db.asUser(s.superAdmin, c => release(c))
    const later = await save(EMPTY_SITE_FILE_BUNDLE)
    const review = (
      await db.asUser(s.superAdmin, c => c.query('SELECT app.review_site_release_recovery($1) AS review', [releaseId]))
    ).rows[0]!.review
    await expectSqlState(
      db.asUser(siteAdmin, c =>
        c.query('SELECT app.prepare_site_release_recovery($1,$2,$3)', [
          randomUUID(),
          releaseId,
          JSON.stringify(review.expectedState),
        ]),
      ),
      'CMS02',
    )
    const prepared = (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT app.prepare_site_release_recovery($1,$2,$3) AS prepared', [
          randomUUID(),
          releaseId,
          JSON.stringify(review.expectedState),
        ]),
      )
    ).rows[0]!.prepared
    expect(prepared.preservedDrafts[0].versionId).toBe(later.version_id)
    const draft = (
      await db.asUser(s.superAdmin, c =>
        c.query(
          'SELECT v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
          [s.siteA],
        ),
      )
    ).rows[0]!.bundle
    expect(draft).toEqual(bundle(first))
    expect((await readPublic(second)).rows).toHaveLength(1)
    await db.asUser(s.superAdmin, c => release(c, prepared.items))
    expect((await readPublic(first)).rows).toHaveLength(1)
    expect((await readPublic(second)).rows).toEqual([])
  })
  it('keeps exact original paths private until release, host-bound when live and frozen in an authorized preview', async () => {
    const id = await register(),
      foreign = await register(s.siteB),
      old = randomUUID(),
      canonical = `/site-files/${old}/${hash}/site.js`,
      paths = [
        { path: '/js/original.js', fileId: id },
        { path: canonical, fileId: id },
      ]
    const mounted = { ...bundle(id), paths }
    for (const path of [
      '/about',
      '/js/',
      'https://foreign.test/site.js',
      '//foreign.test/site.js',
      '/js/../site.js',
      '/js/%2E%2E/site.js',
      '/js/%FF.js',
      '/api/site.js',
      '/__cms/site.js',
      '/js/site.js?x=1',
      '/js/site.js#part',
    ])
      await expectSqlState(save({ ...mounted, paths: [{ path, fileId: id }] }), 'CMS04')
    for (const value of [
      { ...mounted, paths: [...paths, ...paths] },
      { ...mounted, paths: [{ path: '/js/foreign.js', fileId: foreign }] },
      { ...mounted, paths: [{ path: '/css/not-a-script.css', fileId: id }] },
      { ...mounted, paths: [{ path: `/site-files/${old}/${'b'.repeat(64)}/site.js`, fileId: id }] },
      { ...mounted, paths: [{ path: '/js/extra.js', fileId: id, objectKey: 'private/file' }] },
    ])
      await expectSqlState(save(value as SiteFileBundle), 'CMS04')
    await save(mounted)
    const read = (path: string, host = 'site-a.staging.example.test') =>
      db.as(
        'public',
        async c => (await c.query('SELECT id,sha256 FROM public_api.resolve_site_file_path($1,$2)', [host, path])).rows,
      )
    expect(await read('/js/original.js')).toEqual([])
    const ticket = await db.asUser(s.editorA, async c => {
      const page = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [s.pageA])).rows[0]!
      return (
        await c.query('SELECT * FROM app.create_canvas_ticket($1,true,$2,$3,false,$4)', [
          page.published_version_id,
          'http://127.0.0.1:3200',
          'original_path_proof_12345678',
          '[]',
        ])
      ).rows[0]!
    })
    const privateRead = (path: string, host = 'site-a.staging.example.test') =>
      db.as(
        'public',
        async c =>
          (await c.query('SELECT id FROM public_api.resolve_canvas_file_path($1,$2,$3)', [host, [ticket.token], path]))
            .rows,
      )
    expect(await privateRead('/js/original.js')).toEqual([{ id }])
    expect(await privateRead(canonical)).toEqual([{ id }])
    expect(await privateRead('/js/original.js', 'site-b.staging.example.test')).toEqual([])
    expect(await privateRead('/js/guessed.js')).toEqual([])
    await save(EMPTY_SITE_FILE_BUNDLE)
    expect(await privateRead('/js/original.js')).toEqual([{ id }])
    await save(mounted)
    await db.asUser(s.superAdmin, c => release(c))
    expect(await read('/js/original.js')).toEqual([{ id, sha256: hash }])
    expect(await read(canonical)).toEqual([{ id, sha256: hash }])
    expect(await read('/js/original.js', 'site-b.staging.example.test')).toEqual([])
    expect(await read('/js/guessed.js')).toEqual([])
    await save(EMPTY_SITE_FILE_BUNDLE)
    await db.asUser(s.superAdmin, c => release(c))
    expect(await read('/js/original.js')).toEqual([])
    expect(await privateRead('/js/original.js')).toEqual([{ id }])
  })

  it('keeps native aliases tenant-bound, private before release and limited to declared frozen image sizes', async () => {
    const image = randomUUID(),
      foreign = randomUUID(),
      asset = randomUUID(),
      source = randomUUID(),
      file = await register()
    await db.as('owner', async c => {
      for (const [id, site] of [
        [image, s.siteA],
        [foreign, s.siteB],
      ])
        await c.query(
          "INSERT INTO media(id,site_id,object_key,content_hash,mime_type,status,bytes,width,height,alt_text) VALUES($1,$2,$3,$4,'image/png','ready',100,10,10,'Native proof image')",
          [id, site, 'native-test/' + id + '.png', hash],
        )
      await c.query(
        "INSERT INTO media_variants(media_id,kind,object_key,content_hash,mime_type,bytes,width,height) VALUES($1,'wide',$2,$3,'image/webp',100,10,10)",
        [image, 'native-test/' + image + '.webp', hash],
      )
    })
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        s.siteA,
        asset,
        'document',
        `site-assets/${s.siteA}/${asset}/${hash}`,
        'application/pdf',
        100,
        hash,
        'original.pdf',
        null,
        JSON.stringify({ path: 'local:original.pdf', sha256: hash, manifest_sha256: hash }),
      ]),
    )
    const native: NonNullable<SiteFileBundle['native']> = [
        { kind: 'media', sourceId: source, mediaId: image, variants: ['original'] },
        { kind: 'asset', sourceId: source, assetId: asset },
      ],
      selected = { ...bundle(file), native }
    for (const bad of [
      [{ ...native[0], mediaId: foreign }],
      [{ ...native[1], assetId: foreign }],
      [{ ...native[0], variants: ['wide', 'wide'] }],
      [{ ...native[0], variants: ['card'] }],
      [{ ...native[1], objectKey: 'private/key' }],
      [native[0], native[0]],
    ])
      await expectSqlState(save({ ...selected, native: bad as typeof native }), 'CMS04')
    await save(selected)
    const read = (path: string, host = 'site-a.staging.example.test') =>
      db.as(
        'public',
        async c =>
          (await c.query('SELECT public_api.resolve_site_native_path($1,$2) AS target', [host, path])).rows[0]!.target,
      )
    const imagePath = `/media/${source}/original`,
      assetPath = `/assets/${source}`
    expect(await read(imagePath)).toBeNull()
    expect(await read(assetPath)).toBeNull()
    const canonicalMedia = (variant = 'original', host = 'site-a.staging.example.test') =>
      db.as(
        'public',
        async c =>
          (await c.query('SELECT media_id FROM public_api.resolve_media($1,$2,$3)', [host, image, variant])).rows,
      )
    const canonicalAsset = (host = 'site-a.staging.example.test') =>
      db.as(
        'public',
        async c => (await c.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, asset])).rows,
      )
    expect(await canonicalMedia()).toEqual([])
    expect(await canonicalAsset()).toEqual([])
    const ticket = await db.asUser(s.editorA, async c => {
      const page = (await c.query('SELECT published_version_id FROM pages WHERE id=$1', [s.pageA])).rows[0]!
      return (
        await c.query('SELECT * FROM app.create_canvas_ticket($1,true,$2,$3,false,$4)', [
          page.published_version_id,
          'http://127.0.0.1:3200',
          'native_resource_proof_12345678',
          '[]',
        ])
      ).rows[0]!
    })
    const privateRead = (path: string, host = 'site-a.staging.example.test') =>
      db.as(
        'public',
        async c =>
          (
            await c.query('SELECT public_api.resolve_canvas_native_path($1,$2,$3) AS target', [
              host,
              [ticket.token],
              path,
            ])
          ).rows[0]!.target,
      )
    expect(await privateRead(imagePath)).toEqual({ kind: 'media', mediaId: image, variant: 'original' })
    expect(await privateRead(assetPath)).toEqual({ kind: 'asset', assetId: asset })
    expect(await privateRead(`/media/${source}/wide`)).toBeNull()
    expect(await privateRead(imagePath, 'site-b.staging.example.test')).toBeNull()
    expect(
      (
        await db.as('public', c =>
          c.query("SELECT media_id FROM public_api.resolve_canvas_media($1,$2,$3,'original')", [
            'site-a.staging.example.test',
            [ticket.token],
            image,
          ]),
        )
      ).rows,
    ).toEqual([{ media_id: image }])
    expect(
      (
        await db.as('public', c =>
          c.query("SELECT media_id FROM public_api.resolve_canvas_media($1,$2,$3,'wide')", [
            'site-a.staging.example.test',
            [ticket.token],
            image,
          ]),
        )
      ).rows,
    ).toEqual([])
    await db.asUser(s.superAdmin, c => release(c))
    expect(await read(imagePath)).toEqual({ kind: 'media', mediaId: image, variant: 'original' })
    expect(await read(assetPath)).toEqual({ kind: 'asset', assetId: asset })
    expect(await read(`/media/${source}/wide`)).toBeNull()
    expect(await read(imagePath, 'site-b.staging.example.test')).toBeNull()
    expect(await read('/assets/' + randomUUID())).toBeNull()
    const publication = (
      await db.as('owner', c =>
        c.query(
          "SELECT payload FROM outbox WHERE site_id=$1 AND event_type='site.files.published' ORDER BY id DESC LIMIT 1",
          [s.siteA],
        ),
      )
    ).rows[0]!.payload
    expect(publication.paths).toContain('/')
    expect(publication.revision).toBe(
      Number(
        (await db.as('owner', c => c.query('SELECT revision FROM site_file_heads WHERE site_id=$1', [s.siteA])))
          .rows[0]!.revision,
      ),
    )
    expect(await canonicalMedia()).toEqual([{ media_id: image }])
    expect(await canonicalMedia('wide')).toEqual([])
    expect(await canonicalMedia('original', 'site-b.staging.example.test')).toEqual([])
    expect(await canonicalAsset()).toEqual([{ id: asset }])
    expect(await canonicalAsset('site-b.staging.example.test')).toEqual([])
    const usages = () =>
      db.asUser(
        s.editorA,
        async c =>
          (await c.query('SELECT media_id,site_id FROM site_file_media_usage WHERE media_id=$1', [image])).rows,
      )
    expect(await usages()).toEqual([{ media_id: image, site_id: s.siteA }])
    expect(
      (await db.asUser(s.editorB, c => c.query('SELECT * FROM site_file_media_usage WHERE media_id=$1', [image]))).rows,
    ).toEqual([])
    await expectSqlState(
      db.asUser(siteAdmin, c => c.query('SELECT app.soft_delete_media($1,1,false,NULL)', [image])),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(siteAdmin, c => c.query("SELECT app.soft_delete_media($1,1,true,'short')", [image])),
      'CMS04',
    )
    await save(EMPTY_SITE_FILE_BUNDLE)
    await db.asUser(s.superAdmin, c => release(c))
    expect(await read(imagePath)).toBeNull()
    expect(await privateRead(imagePath)).toEqual({ kind: 'media', mediaId: image, variant: 'original' })
    expect(await canonicalMedia()).toEqual([])
    expect(await canonicalAsset()).toEqual([])
    expect(await usages()).toEqual([{ media_id: image, site_id: s.siteA }])
    await db.asUser(siteAdmin, c =>
      c.query("SELECT app.soft_delete_media($1,1,true,'Retire the original approved site image')", [image]),
    )
    await save(selected)
    await expectSqlState(
      db.asUser(s.superAdmin, c => release(c)),
      'CMS04',
    )
    expect(
      (
        await db.as('public', c =>
          c.query("SELECT media_id FROM public_api.resolve_canvas_media($1,$2,$3,'original')", [
            'site-a.staging.example.test',
            [ticket.token],
            image,
          ]),
        )
      ).rows,
    ).toEqual([])
    await save(EMPTY_SITE_FILE_BUNDLE)
    await db.as('owner', c =>
      c.query(
        "UPDATE canvas_preview_tickets SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
        [ticket.token],
      ),
    )
    expect(await privateRead(imagePath)).toBeNull()
  })
})
