import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { compileSection } from '../../renderer/src/index.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario, version: string
const channel = 'test_canvas_' + randomUUID().replaceAll('-', '')
beforeAll(async () => {
  db = await TestDatabase.create('canvas_tickets')
  s = await seedScenario(db)
  version = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          s.pageA,
          heroContent(s.heroDefId, 'Private canvas heading'),
          '{}',
        ])
      ).rows[0]!.version_id,
  )
})
afterAll(async () => {
  await db?.close()
})
const mint = (user = s.editorA, id = version, draft = false, parent = 'http://127.0.0.1:3200', lists: unknown[] = []) =>
  db.asUser(
    user,
    async c =>
      (
        await c.query('SELECT * FROM app.create_canvas_ticket($1,$2,$3,$4,false,$5)', [
          id,
          draft,
          parent,
          channel,
          JSON.stringify(lists),
        ])
      ).rows[0]!,
  )
const snapshot = (token: string, host = 'site-a.staging.example.test') =>
  db.as(
    'public',
    async c => (await c.query('SELECT public_api.canvas_snapshot($1,$2) AS data', [host, token])).rows[0]?.data,
  )
async function media(site = s.siteA) {
  const id = randomUUID()
  await db.as('owner', async c => {
    await c.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'Private.png','Private picture',10,10,100,'image/png','ready')",
      [id, site, `canvas/${id}.png`, 'a'.repeat(64)],
    )
    await c.query(
      "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,10,10,90,'image/webp')",
      [id, `canvas/${id}-wide.webp`, 'b'.repeat(64)],
    )
  })
  return id
}
async function picturePage(photo: string) {
  const slug = 'canvas-' + randomUUID().slice(0, 8),
    source = '<section><h1>{{heading}}</h1><img src="{{photo}}" alt="{{photo}}"></section>',
    slots = [
      { id: 'heading', label: 'Heading', kind: 'text' as const, constraints: {} },
      { id: 'photo', label: 'Photo', kind: 'image' as const, constraints: {} },
    ],
    compiled = compileSection({ sourceHtml: source, sourceCss: '', slots, scopeSelector: '.cms-section--' + slug })
  expect(compiled.blocking).toEqual([])
  const def = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
          slug,
          'Picture',
          'Tests',
          source,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Private canvas image',
        ])
      ).rows[0]!,
  )
  return db.asUser(s.editorA, async c => {
    const page = (await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, 'Private picture'])).rows[0]!
      .id
    return (
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([
          {
            section_def_id: def.section_def_id,
            section_def_version: def.version,
            label: 'Picture',
            hidden: false,
            hidden_at: [],
            values: {
              heading: 'Private picture',
              photo: { media_id: photo, variant: 'wide', src: `/media/${photo}/wide`, alt: 'Private picture' },
            },
          },
        ]),
        '{}',
      ])
    ).rows[0]!.version_id
  })
}
describe('isolated canvas read capabilities', () => {
  it('issues only for an authorized saved page, keeps ticket storage private and leaves ordinary public routes private', async () => {
    const ticket = await mint()
    expect(/^[a-f0-9]{64}$/.test(ticket.token)).toBe(true)
    const data = await snapshot(ticket.token)
    expect(data.snapshot.manifest.page.version_id).toBe(version)
    expect(data.snapshot.manifest.sections[0].instance.values.heading).toBe('Private canvas heading')
    expect(data.snapshot.parentOrigin).toBe('http://127.0.0.1:3200')
    expect(data.snapshot.channel).toBe(channel)
    expect(await snapshot(ticket.token, 'site-b.staging.example.test')).toBeNull()
    expect(await snapshot(ticket.token, 'unknown.example.test')).toBeNull()
    expect(await snapshot('f'.repeat(64))).toBeNull()
    await expectSqlState(mint(s.editorB), 'CMS03')
    await expectSqlState(mint(s.disabled), 'CMS02')
    await expectSqlState(
      db.as('public', c => c.query('SELECT id FROM public.canvas_preview_tickets')),
      '42501',
    )
    expect(
      (await db.as('public', c => c.query("SELECT * FROM public_api.resolve_route('site-a.staging.example.test','/')")))
        .rows,
    ).toEqual([])
  })
  it('refuses forged context, HTML/AST overrides and unsupported list fields before issuing any capability', async () => {
    for (const origin of ['https://user:password@example.test', 'https://example.test/path', 'javascript:bad()'])
      await expectSqlState(mint(s.editorA, version, false, origin), 'CMS04')
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.create_canvas_ticket($1,false,$2,$3,false,$4)', [
          version,
          'http://127.0.0.1:3200',
          'short',
          '[]',
        ]),
      ),
      'CMS04',
    )
    for (const value of [
      { html: '<script>bad()</script>' },
      { section: 0, slot: 'heading', value: { kind: 'collection', entries: [] } },
    ])
      await expectSqlState(mint(s.editorA, version, false, undefined, [value]), 'CMS04')
  })
  it('pins the page contents instead of silently following a newer draft', async () => {
    const ticket = await mint()
    await db.asUser(s.editorA, async c => {
      const head = (await c.query('SELECT revision FROM pages WHERE id=$1', [s.pageA])).rows[0]!
      await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        s.pageA,
        head.revision,
        heroContent(s.heroDefId, 'Later private draft'),
        '{}',
      ])
    })
    expect((await snapshot(ticket.token)).snapshot.manifest.sections[0].instance.values.heading).toBe(
      'Private canvas heading',
    )
  })
  it('permits only a referenced image rendition, never another private/foreign image or unused original', async () => {
    const [picture, unused, foreign] = await Promise.all([media(), media(), media(s.siteB)]),
      saved = await picturePage(picture),
      ticket = await mint(s.editorA, saved)
    const read = (id: string, variant = 'wide', host = 'site-a.staging.example.test') =>
      db.as(
        'public',
        async c =>
          (
            await c.query('SELECT media_id FROM public_api.resolve_canvas_media($1,$2,$3,$4)', [
              host,
              [ticket.token],
              id,
              variant,
            ])
          ).rows,
      )
    expect(await read(picture)).toEqual([{ media_id: picture }])
    expect(await read(picture, 'original')).toEqual([])
    expect(await read(unused)).toEqual([])
    expect(await read(foreign)).toEqual([])
    expect(await read(picture, 'wide', 'site-b.staging.example.test')).toEqual([])
  })
  it('can load a Super Admin-reviewed draft file but refuses an unreviewed upload and foreign files', async () => {
    const approved = randomUUID(),
      unreviewed = randomUUID(),
      foreign = randomUUID()
    await db.asUser(s.superAdmin, async c => {
      for (const [id, site] of [
        [approved, s.siteA],
        [unreviewed, s.siteA],
        [foreign, s.siteB],
      ])
        await c.query('SELECT app.register_site_file($1,$2,$3,$4,$5,$6,$7,$8)', [
          site,
          id,
          'script',
          id + '.js',
          'local:approved-script.js',
          'text/javascript',
          100,
          'a'.repeat(64),
        ])
      await c.query('SELECT app.save_site_file_bundle($1,0,$2)', [
        s.siteA,
        JSON.stringify({
          version: 1,
          files: [approved],
          scripts: [{ fileId: approved, position: 'body-end', loading: 'normal', pages: [] }],
          styles: [],
        }),
      ])
    })
    const ticket = await mint(s.editorA, version, true),
      read = (id: string) =>
        db.as(
          'public',
          async c =>
            (
              await c.query('SELECT id FROM public_api.resolve_canvas_file($1,$2,$3)', [
                'site-a.staging.example.test',
                [ticket.token],
                id,
              ])
            ).rows,
        )
    expect(await read(approved)).toEqual([{ id: approved }])
    expect(await read(unreviewed)).toEqual([])
    expect(await read(foreign)).toEqual([])
    expect(
      (
        await db.as('public', c =>
          c.query('SELECT id FROM public_api.resolve_site_file($1,$2)', ['site-a.staging.example.test', approved]),
        )
      ).rows,
    ).toEqual([])
  })
  it('rebuilds a list from exact current draft rows and refuses forged or foreign list content', async () => {
    const suffix = randomUUID().slice(0, 8),
      reader = 'canvas_' + suffix
    const setup = await db.asUser(s.superAdmin, async c => {
      const list = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          s.siteA,
          'canvas-list-' + suffix,
          'Canvas people',
          reader,
          JSON.stringify([{ key: 'name', label: 'Name', type: 'text', required: true }]),
          JSON.stringify({
            schemaVersion: 1,
            titleField: 'name',
            subtitleField: null,
            imageField: null,
            groupField: null,
          }),
        ])
      ).rows[0]!
      await c.query('SELECT app.publish_collection_schema($1,$2)', [list.collection_id, list.revision])
      await c.query('SELECT app.save_collection_entries($1,0,$2)', [
        list.collection_id,
        JSON.stringify([{ id: null, stableKey: 'private-speaker', values: { name: 'Private draft speaker' } }]),
      ])
      const doc = {
        schemaVersion: 3,
        fields: [{ name: 'items', label: 'People', type: 'repeat' }],
        nodes: [
          {
            type: 'repeat',
            field: 'items',
            empty: { behavior: 'message', text: 'No people yet.' },
            item: [{ type: 'element', tag: 'p', children: [{ type: 'text', field: 'name' }] }],
          },
        ],
      }
      const def = (
        await c.query(
          'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
          [
            'canvas-people-' + suffix,
            'Canvas people',
            'Tests',
            '',
            '',
            '',
            JSON.stringify({ nodes: [], policyVersion: 4, cssPolicyVersion: 6 }),
            JSON.stringify([{ id: 'items', kind: 'repeat', label: 'People', constraints: {} }]),
            'canvas-list-' + suffix,
            4,
            6,
            'Private draft list proof',
            false,
            'structured',
            JSON.stringify(doc),
            3,
          ],
        )
      ).rows[0]!
      const page = (
        await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'canvas-people-' + suffix, 'Canvas people'])
      ).rows[0]!.id
      const saved = (
        await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          page,
          JSON.stringify([
            {
              section_def_id: def.section_def_id,
              section_def_version: def.version,
              label: 'People',
              hidden: false,
              hidden_at: [],
              values: { items: { readerKey: reader, selection: { mode: 'automatic', limit: 100 } } },
            },
          ]),
          '{}',
        ])
      ).rows[0]!
      const entries = (
        await c.query(
          'SELECT e.id,e.stable_key AS "stableKey",v.schema_version_id AS "schemaVersionId",v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
          [list.collection_id],
        )
      ).rows
      return {
        version: saved.version_id,
        value: { kind: 'collection', collectionId: list.collection_id, readerKey: reader, entries },
      }
    })
    const ticket = await mint(s.editorA, setup.version, false, undefined, [
      { section: 0, slot: 'items', value: setup.value },
    ])
    expect(
      (await snapshot(ticket.token)).snapshot.manifest.sections[0].instance.values.items.entries[0].values.name,
    ).toBe('Private draft speaker')
    const changed = structuredClone(setup.value)
    changed.entries[0]!.values.name = 'Forged private row'
    await expectSqlState(
      mint(s.editorA, setup.version, false, undefined, [{ section: 0, slot: 'items', value: changed }]),
      'CMS01',
    )
    await expectSqlState(
      mint(s.editorA, setup.version, false, undefined, [
        { section: 0, slot: 'items', value: { ...setup.value, collectionId: randomUUID() } },
      ]),
      'CMS04',
    )
  })
  it('expires closed and only the original still-authorized actor can renew the same frozen page capability', async () => {
    const ticket = await mint()
    await db.as('owner', c =>
      c.query(
        "UPDATE canvas_preview_tickets SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
        [ticket.token],
      ),
    )
    expect(await snapshot(ticket.token)).toBeNull()
    await expectSqlState(
      db.as('public', c => c.query('SELECT app.renew_canvas_ticket($1,$2)', [s.pageA, ticket.token])),
      '42501',
    )
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT app.renew_canvas_ticket($1,$2)', [s.pageA, ticket.token])),
      'CMS03',
    )
    await db.asUser(s.editorA, c => c.query('SELECT app.renew_canvas_ticket($1,$2)', [s.pageA, ticket.token]))
    expect((await snapshot(ticket.token)).snapshot.manifest.page.version_id).toBe(version)
  })
  it('revokes a ticket immediately when its actor loses site access', async () => {
    const ticket = await mint()
    try {
      await db.asUser(s.superAdmin, async c => {
        const user = (await c.query('SELECT revision,display_name FROM app_users WHERE id=$1', [s.editorA])).rows[0]!
        await c.query("SELECT app.update_person($1,$2,$3,'active',$4)", [
          s.editorA,
          user.revision,
          user.display_name,
          '[]',
        ])
      })
      expect(await snapshot(ticket.token)).toBeNull()
      await expectSqlState(
        db.asUser(s.editorA, c => c.query('SELECT app.renew_canvas_ticket($1,$2)', [s.pageA, ticket.token])),
        'CMS03',
      )
    } finally {
      await db.asUser(s.superAdmin, c =>
        c.query("SELECT app.set_site_membership($1,$2,'editor')", [s.editorA, s.siteA]),
      )
    }
  })
  it('bounds retained capabilities and does not grant the worker or renderer issuance or private helpers', async () => {
    for (let count = 0; count < 20; count++) await mint()
    expect(
      Number(
        (
          await db.as('owner', c =>
            c.query('SELECT count(*) AS total FROM canvas_preview_tickets WHERE actor_id=$1', [s.editorA]),
          )
        ).rows[0]!.total,
      ),
    ).toBeLessThanOrEqual(16)
    for (const role of ['public', 'worker'] as const)
      await expectSqlState(
        db.as(role, c =>
          c.query('SELECT * FROM app.create_canvas_ticket($1,false,$2,$3,false,$4)', [
            version,
            'http://127.0.0.1:3200',
            channel,
            '[]',
          ]),
        ),
        '42501',
      )
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.canvas_tickets_for_host($1,$2)', ['site-a.staging.example.test', ['a'.repeat(64)]]),
      ),
      '42501',
    )
  })
})
