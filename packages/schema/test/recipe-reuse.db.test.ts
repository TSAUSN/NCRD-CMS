import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase
let s: Scenario
let sequence = 0
beforeAll(async () => {
  db = await TestDatabase.create('recipe_reuse')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
async function capture(content = JSON.parse(heroContent(s.heroDefId))) {
  return db.asUser(s.superAdmin, async c => {
    const page = (
      await c.query('SELECT app.create_page($1,$2,$3) id', [s.siteA, `reuse-source-${++sequence}`, 'Source'])
    ).rows[0]!.id
    const version = (
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [page, JSON.stringify(content), '{}'])
    ).rows[0]!.version_id
    const recipe = (
      await c.query('SELECT app.save_page_recipe($1,NULL,0,$2,$3,$4) id', [
        s.siteA,
        'Reusable event',
        version,
        '[{"index":0,"sample":true}]',
      ])
    ).rows[0]!.id
    return { page, version, recipe }
  })
}
async function share(recipe: string, user?: string) {
  return db.asUser(
    user ?? s.superAdmin,
    async c =>
      (await c.query('SELECT app.share_page_recipe($1,1,$2) id', [recipe, 'Shared event'])).rows[0]!.id as string,
  )
}
async function prepare(recipe: string, target = s.siteB, bindings: unknown = {}, user?: string) {
  return db.asUser(
    user ?? s.editorB,
    async c =>
      (await c.query('SELECT app.prepare_page_recipe($1,1,$2,$3) content', [recipe, target, JSON.stringify(bindings)]))
        .rows[0]!.content,
  )
}
async function use(recipe: string, target: string, bindings: unknown, user?: string) {
  return db.asUser(
    user ?? s.superAdmin,
    async c =>
      (
        await c.query('SELECT app.use_mapped_page_recipe($1,1,$2,$3,NULL,NULL,$4,$5) id', [
          recipe,
          target,
          JSON.stringify(bindings),
          'Independent event',
          `event-${++sequence}`,
        ])
      ).rows[0]!.id as string,
  )
}
async function saved(page: string) {
  return db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query(
          'SELECT p.*,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [page],
        )
      ).rows[0]!,
  )
}
async function literalDefinition(html: string, css = '') {
  const slug = `recipe-static-${++sequence}`
  const id = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query(
          'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            slug,
            'Static recipe',
            'Tests',
            html,
            css,
            css ? `.cms-section--${slug}{${css}}` : '',
            JSON.stringify({ policyVersion: 4, cssPolicyVersion: 6, nodes: [{ kind: 'html', value: html }] }),
            '[]',
            slug,
            4,
            6,
            'Asset ownership fixture',
          ],
        )
      ).rows[0]!.section_def_id,
  )
  return [
    { section_def_id: id, section_def_version: 1, values: {}, hidden: false, hidden_at: [], label: 'Static section' },
  ]
}
describe('governed shared recipes and explicit collection reuse', () => {
  it('shares a new curated head without exposing private history and keeps global management governed', async () => {
    const original = await capture()
    const global = await share(original.recipe)
    expect(global).not.toBe(original.recipe)
    await expectSqlState(share(original.recipe, s.editorA), 'CMS02')
    const visible = await db.asUser(s.editorB, c =>
      c.query(
        'SELECT r.id,v.source_version_id FROM page_recipes r JOIN page_recipe_versions v ON v.recipe_id=r.id WHERE r.id=ANY($1::uuid[])',
        [[original.recipe, global]],
      ),
    )
    expect(visible.rows.map(x => x.id)).toEqual([global])
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.manage_page_recipe($1,1,$2,true)', [global, 'Shared event'])),
      'CMS02',
    )
    expect(await prepare(global)).toHaveLength(1)
    await expectSqlState(prepare(original.recipe), 'CMS03')
    const page = await use(global, s.siteB, {}, s.editorB)
    expect((await saved(page)).published_version_id).toBeNull()
    await expectSqlState(use(global, s.siteA, {}, s.contributorA), 'CMS02')
    const bundle = await db.asUser(
      s.superAdmin,
      async c => (await c.query('SELECT app.export_site_content($1) bundle', [s.siteA])).rows[0]!.bundle,
    )
    expect(bundle.content.page_recipes.some((r: { id: string }) => r.id === global)).toBe(false)
    expect(bundle.content.page_recipes.some((r: { id: string }) => r.id === original.recipe)).toBe(true)
  })
  it('refuses stale, retired and unknown binding preparation without changing a page', async () => {
    const { recipe } = await capture()
    const global = await share(recipe)
    await expectSqlState(
      prepare(global, s.siteB, { unexpected: { readerKey: 'unknown', selection: { mode: 'automatic', limit: 10 } } }),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(s.editorB, c => c.query('SELECT app.prepare_page_recipe($1,0,$2,$3)', [global, s.siteB, '{}'])),
      'CMS01',
    )
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.manage_page_recipe($1,1,$2,true)', [global, 'Retired shared event']),
    )
    await expectSqlState(prepare(global), 'CMS04')
  })
  it('refuses to share private definitions or images and never silently copies assets across sites', async () => {
    const { recipe } = await capture()
    await db.as('owner', c =>
      c.query("UPDATE section_defs SET scope='site',site_id=$2 WHERE id=$1", [s.heroDefId, s.siteA]),
    )
    try {
      await expectSqlState(share(recipe), 'CMS04')
    } finally {
      await db.as('owner', c =>
        c.query("UPDATE section_defs SET scope='global',site_id=NULL WHERE id=$1", [s.heroDefId]),
      )
    }
    const media = await db.as(
      'owner',
      async c =>
        (
          await c.query(
            `INSERT INTO media
      (site_id,object_key,content_hash,original_name,alt_text,decorative,width,height,bytes,mime_type,status,uploaded_by)
      VALUES($1,'media/recipe-reuse/private.jpg',$2,'private.jpg','Private image',false,100,100,1000,'image/jpeg','ready',$3) RETURNING id`,
            [s.siteA, 'b'.repeat(64), s.superAdmin],
          )
        ).rows[0]!.id,
    )
    const content = JSON.parse(heroContent(s.heroDefId))
    content[0].values.heading = { media_id: media, variant: 'original' }
    const privateImage = await capture(content)
    await expectSqlState(share(privateImage.recipe), 'CMS04')
    await expectSqlState(prepare(privateImage.recipe, s.siteB, {}, s.superAdmin), 'CMS04')
    await db.as('owner', c => c.query('UPDATE media SET site_id=NULL WHERE id=$1', [media]))
    expect(await prepare(await share(privateImage.recipe))).toHaveLength(1)
  })
  it('validates literal HTML/CSS assets, retains them, and delivers a deliberately published cross-site copy', async () => {
    const images = await db.as('owner', async c => {
      const ids: string[] = []
      for (let i = 0; i < 2; i++)
        ids.push(
          (
            await c.query(
              `INSERT INTO media
        (site_id,object_key,content_hash,original_name,alt_text,decorative,width,height,bytes,mime_type,status,uploaded_by)
        VALUES($1,$2,$3,'static.jpg','Static sample',false,100,100,1000,'image/jpeg','ready',$4) RETURNING id`,
              [s.siteA, `recipe-static/${randomUUID()}.jpg`, 'c'.repeat(64), s.superAdmin],
            )
          ).rows[0]!.id,
        )
      return ids
    })
    const content = await literalDefinition(
      `<img src="/media/${images[0]}/original" alt="Static sample"><p>Inert documentation /media/${randomUUID()}/original</p>`,
      `background-image:url('/media/${images[1]}/original')`,
    )
    const original = await capture(content)
    await expectSqlState(share(original.recipe), 'CMS04')
    await expectSqlState(prepare(original.recipe, s.siteB, {}, s.superAdmin), 'CMS04')
    const pinned = await db.as('owner', c =>
      c.query('SELECT media_id FROM media_usage WHERE version_id=$1 ORDER BY media_id', [original.version]),
    )
    expect(pinned.rows.map(r => r.media_id).sort()).toEqual([...images].sort())
    await db.as('owner', c => c.query('UPDATE media SET site_id=NULL WHERE id=ANY($1::uuid[])', [images]))
    const starter = await share(original.recipe)
    const copy = await use(starter, s.siteB, {}, s.editorB)
    for (const id of images)
      expect(
        (
          await db.as('public', c =>
            c.query('SELECT media_id FROM public_api.resolve_media($1,$2,$3)', [
              'site-b.staging.example.test',
              id,
              'original',
            ]),
          )
        ).rowCount,
      ).toBe(0)
    await db.asUser(s.editorB, c => c.query('SELECT app.publish_page($1,1,$2,$3,$4)', [copy, ...CHECKED_CLEAN]))
    for (const id of images)
      expect(
        (
          await db.as('public', c =>
            c.query('SELECT media_id FROM public_api.resolve_media($1,$2,$3)', [
              'site-b.staging.example.test',
              id,
              'original',
            ]),
          )
        ).rows,
      ).toEqual([{ media_id: id }])
    const first = (await saved(copy)).published_version_id
    await db.asUser(s.editorB, c =>
      c.query('SELECT * FROM app.save_page_draft($1,2,$2,$3)', [copy, JSON.stringify(content), '{}']),
    )
    await db.as('owner', c => c.query("UPDATE media SET status='deleted',deleted_at=now() WHERE id=$1", [images[0]]))
    await expectSqlState(prepare(starter, s.siteB), 'CMS04')
    await expectSqlState(
      db.asUser(s.editorB, c => c.query('SELECT app.publish_page($1,3,$2,$3,$4)', [copy, ...CHECKED_CLEAN])),
      'CMS04',
    )
    expect((await saved(copy)).published_version_id).toBe(first)
  })
  it('refuses missing definition assets and malformed URLs without treating ordinary mentions as assets', async () => {
    await expectSqlState(capture(await literalDefinition(`<a href="/assets/${randomUUID()}">Document</a>`)), 'CMS04')
    await expectSqlState(capture(await literalDefinition('<img src="/media/not-an-id/original">')), 'CMS04')
    await expectSqlState(
      capture(await literalDefinition('<p>Background</p>', `background-image:url('/media/${randomUUID()}/wide')`)),
      'CMS04',
    )
    const inert = await capture(
      await literalDefinition(`<p>Documentation /assets/${randomUUID()} /media/${randomUUID()}/wide</p>`),
    )
    expect(await share(inert.recipe)).toBeTruthy()
  })
  it('retains same-site literal PDF links for readiness and publication without exporting them through shared recipes', async () => {
    const asset = randomUUID(),
      hash = 'd'.repeat(64)
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        s.siteA,
        asset,
        'document',
        `site-assets/${s.siteA}/${asset}/${hash}`,
        'application/pdf',
        100,
        hash,
        'guide.pdf',
        null,
        JSON.stringify({ sha256: hash, manifest_sha256: hash, path: 'guide.pdf' }),
      ]),
    )
    const content = await literalDefinition(`<a href="/assets/${asset}">Event guide</a>`)
    // A duplicate instance reference is left to the existing instance indexer;
    // the new static indexer must not collide with its immutable usage row.
    content[0]!.values = { unused: { url: `/assets/${asset}` } }
    const source = await capture(content)
    await expectSqlState(share(source.recipe), 'CMS04')
    await expectSqlState(prepare(source.recipe, s.siteB, {}, s.superAdmin), 'CMS04')
    const copy = await use(source.recipe, s.siteA, {})
    const version = (await saved(copy)).draft_version_id
    expect(
      (
        await db.asUser(s.editorA, c =>
          c.query('SELECT path FROM app.readiness_document_paths($1,$2)', [version, [asset]]),
        )
      ).rows,
    ).toEqual([{ path: `/assets/${asset}` }])
    expect(
      (
        await db.as('public', c =>
          c.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', ['site-a.staging.example.test', asset]),
        )
      ).rowCount,
    ).toBe(0)
    await db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,1,$2,$3,$4)', [copy, ...CHECKED_CLEAN]))
    expect(
      (
        await db.as('public', c =>
          c.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', ['site-a.staging.example.test', asset]),
        )
      ).rows,
    ).toEqual([{ id: asset }])
  })
  it('keeps two conferences and next year independent through explicit speaker and agenda mappings', async () => {
    const fields = [
      { name: 'heading', type: 'text', label: 'Heading' },
      { name: 'speakers', type: 'repeat', label: 'Speakers' },
      { name: 'agenda', type: 'repeat', label: 'Agenda' },
    ]
    const doc = {
      schemaVersion: 3,
      fields,
      nodes: [
        { type: 'text', field: 'heading' },
        ...['speakers', 'agenda'].map(field => ({
          type: 'repeat',
          field,
          empty: { behavior: 'hide' },
          item: [{ type: 'text', field: 'name' }],
        })),
      ],
    }
    const def = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query(
            'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
            [
              'event-recipe',
              'Event recipe',
              'Events',
              '',
              '',
              '',
              JSON.stringify({ nodes: [], policyVersion: 4, cssPolicyVersion: 6 }),
              JSON.stringify(fields.map(f => ({ id: f.name, kind: f.type, label: f.label, constraints: {} }))),
              'event-recipe',
              4,
              6,
              '',
              false,
              'structured',
              JSON.stringify(doc),
              3,
            ],
          )
        ).rows[0]!.section_def_id,
    )
    const events: Array<{
      label: string
      site: string
      collections: Record<string, { id: string; revision: number; entry: string; reader: string }>
      page?: string
    }> = []
    for (const [label, site] of [
      ['conference_a', s.siteA],
      ['conference_b', s.siteB],
      ['next_year', s.siteA],
    ] as const) {
      const collections: (typeof events)[number]['collections'] = {}
      for (const kind of ['speakers', 'agenda']) {
        const reader = `${label}_${kind}`
        collections[kind] = await db.asUser(s.superAdmin, async c => {
          const row = (
            await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
              site,
              reader.replaceAll('_', '-'),
              `${label} ${kind}`,
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
          await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [row.collection_id, row.revision])
          const save = (
            await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
              row.collection_id,
              JSON.stringify([{ id: null, stableKey: 'primary', values: { name: `${label} original ${kind}` } }]),
            ])
          ).rows[0]!
          const published = (
            await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [
              row.collection_id,
              save.entry_revision,
            ])
          ).rows[0]!
          const entry = (await c.query('SELECT id FROM collection_entries WHERE collection_id=$1', [row.collection_id]))
            .rows[0]!.id
          return { id: row.collection_id, revision: Number(published.entry_revision), entry, reader }
        })
      }
      events.push({ label, site, collections })
    }
    const a = events[0]!
    const { recipe } = await capture([
      {
        section_def_id: def,
        section_def_version: 1,
        values: {
          heading: 'Event starter',
          speakers: {
            readerKey: a.collections.speakers!.reader,
            selection: { mode: 'manual', stableKeys: ['primary'] },
          },
          agenda: { readerKey: a.collections.agenda!.reader, selection: { mode: 'automatic', limit: 10 } },
        },
        hidden: false,
        hidden_at: [],
        label: 'Event',
      },
    ])
    const global = await share(recipe)
    await expectSqlState(prepare(global, s.siteB, {}), 'CMS04')
    const mapping = (event: typeof a) =>
      Object.fromEntries(
        ['speakers', 'agenda'].map(kind => [
          a.collections[kind]!.reader,
          { readerKey: event.collections[kind]!.reader, selection: { mode: 'automatic', limit: 10 } },
        ]),
      )
    const bad = mapping(events[1]!)
    bad[a.collections.speakers!.reader]!.readerKey = a.collections.speakers!.reader
    await expectSqlState(prepare(global, s.siteB, bad), 'CMS04')
    for (const event of events)
      event.page = await use(global, event.site, mapping(event), event.site === s.siteB ? s.editorB : s.editorA)
    const before = await Promise.all(events.map(event => saved(event.page!)))
    for (const kind of ['speakers', 'agenda']) {
      const collection = events[1]!.collections[kind]!
      await db.asUser(s.editorB, async c => {
        const save = (
          await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
            collection.id,
            collection.revision,
            JSON.stringify([
              { id: collection.entry, stableKey: 'primary', values: { name: `conference_b changed ${kind}` } },
            ]),
          ])
        ).rows[0]!
        await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [collection.id, save.entry_revision])
      })
    }
    for (const [index, event] of events.entries()) {
      const after = await saved(event.page!)
      expect(after.content).toEqual(before[index]!.content)
      expect(after.published_version_id).toBeNull()
      const manifest = await db.asUser(
        s.superAdmin,
        async c =>
          (await c.query('SELECT app.build_render_manifest($1) manifest', [after.draft_version_id])).rows[0]!.manifest,
      )
      expect(JSON.stringify(manifest)).toContain(`${event.label} ${index === 1 ? 'changed' : 'original'} speakers`)
      expect(JSON.stringify(manifest)).toContain(`${event.label} ${index === 1 ? 'changed' : 'original'} agenda`)
      if (index !== 1) expect(JSON.stringify(manifest)).not.toContain('conference_b changed')
    }
  })
})
