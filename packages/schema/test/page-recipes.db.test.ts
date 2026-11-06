import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { compileSection } from '../../renderer/src/index.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
let counter = 0
beforeAll(async () => {
  db = await TestDatabase.create('page_recipes')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

async function source(content = JSON.parse(heroContent(s.heroDefId)), site = s.siteA) {
  return db.asUser(s.superAdmin, async c => {
    const id = (
      await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
        site,
        `recipe-source-${++counter}`,
        'Original page',
      ])
    ).rows[0]!.id
    const version = (
      await c.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify(content),
        JSON.stringify({ title: 'Source SEO', description: 'Not reusable', canonical: 'https://source.test/' }),
      ])
    ).rows[0]!.version_id
    return { id, version }
  })
}
async function capture(
  version: string,
  choices = [{ index: 0, sample: true }],
  user?: string,
  recipe: string | null = null,
  revision: number | null = 0,
) {
  return db.asUser(
    user ?? s.editorA,
    async c =>
      (
        await c.query<{ id: string }>('SELECT app.save_page_recipe($1,$2,$3,$4,$5,$6) AS id', [
          s.siteA,
          recipe,
          revision,
          'Conference overview',
          version,
          JSON.stringify(choices),
        ])
      ).rows[0]!.id,
  )
}
async function recipe(id: string) {
  return db.asUser(
    s.editorA,
    async c =>
      (
        await c.query(
          `SELECT r.*,v.content,v.source_version_id FROM page_recipes r
    JOIN page_recipe_versions v ON v.id=r.current_version_id WHERE r.id=$1`,
          [id],
        )
      ).rows[0]!,
  )
}
async function page(id: string) {
  return db.asUser(
    s.editorA,
    async c =>
      (
        await c.query(
          `SELECT p.*,v.content,v.meta FROM pages p
    LEFT JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1`,
          [id],
        )
      ).rows[0]!,
  )
}
async function use(
  id: string,
  revision: number | null = 1,
  user?: string,
  pageId: string | null = null,
  pageRevision: number | null = null,
) {
  return db.asUser(
    user ?? s.editorA,
    async c =>
      (
        await c.query<{ id: string }>('SELECT app.use_page_recipe($1,$2,$3,$4,$5,$6) AS id', [
          id,
          revision,
          pageId,
          pageRevision,
          'Next conference',
          `recipe-result-${++counter}`,
        ])
      ).rows[0]!.id,
  )
}

describe('site page recipes', () => {
  it('keeps a list’s listed items with its samples, and starts it empty without them (LIB-02)', async () => {
    const slots = [
      {
        id: 'cards',
        kind: 'repeat',
        label: 'Cards',
        constraints: { item: { unit: 'Card', fields: [{ id: 'title', kind: 'text', label: 'Title' }] } },
      },
    ]
    const html = '<div>{{#cards}}<h3>{{title}}</h3>{{/cards}}</div>'
    const compiled = compileSection({
      sourceHtml: html,
      slots: slots as never,
      scopeSelector: '.cms-section--recipe-cards',
    })
    expect(compiled.blocking).toEqual([])
    const def = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
            'recipe-cards',
            'Cards',
            'Tests',
            html,
            '',
            compiled.css,
            JSON.stringify(compiled.ast),
            JSON.stringify(slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            'List fixture',
          ])
        ).rows[0]!,
    )
    const values = {
      cards: { items: ['i2', 'i1'] },
      cards__i1__title: 'One',
      cards__i2__title: 'Two',
      // Left behind by a removed item, and a field the item does not declare.
      cards__i9__title: 'Removed',
      cards__i1__private: 'Not declared',
    }
    const original = await source([
      {
        section_def_id: def.section_def_id,
        section_def_version: def.version,
        values,
        hidden: false,
        hidden_at: [],
        label: 'Cards',
      },
    ])
    const withSamples = await recipe(
      await capture(original.version, [
        { index: 0, sample: true },
        { index: 0, sample: false },
      ]),
    )
    expect(withSamples.content.map((x: { values: unknown }) => x.values)).toEqual([
      { cards: { items: ['i2', 'i1'] }, cards__i1__title: 'One', cards__i2__title: 'Two' },
      {},
    ])
  })

  it('captures explicit order, repeated instances and opted-in declared values, excluding page data', async () => {
    const content = JSON.parse(heroContent(s.heroDefId))
    content[0].values.undeclaredPrivateNote = 'Do not retain'
    content.push({ ...content[0], label: 'Closing', values: { heading: 'Closing sample' } })
    const original = await source(content)
    const id = await capture(original.version, [
      { index: 1, sample: true },
      { index: 0, sample: false },
      { index: 1, sample: false },
    ])
    const saved = await recipe(id)
    expect(saved.content).toHaveLength(3)
    expect(saved.content.map((x: { values: unknown }) => x.values)).toEqual([{ heading: 'Closing sample' }, {}, {}])
    expect(saved.content.every((x: { section_def_version: number }) => x.section_def_version === 1)).toBe(true)
    expect(JSON.stringify(saved.content)).not.toMatch(/Source SEO|Not reusable|canonical|undeclaredPrivateNote/)
    expect(saved.source_version_id).toBe(original.version)
    expect((await page(original.id)).content).toEqual(content)
  })

  it('creates independent private drafts without inherited SEO or publication', async () => {
    const original = await source()
    const id = await capture(original.version)
    const first = await use(id)
    const second = await use(id)
    expect(first).not.toBe(second)
    const before = await page(second)
    expect(before.published_version_id).toBeNull()
    expect(before.meta).toEqual({ title: 'Next conference', description: '' })
    await db.asUser(s.contributorA, c =>
      c.query('SELECT app.save_page_draft($1,1,$2,$3)', [first, heroContent(s.heroDefId, 'Changed instance'), '{}']),
    )
    expect((await page(second)).content).toEqual(before.content)
    expect((await recipe(id)).content).toEqual(before.content)
    expect((await page(original.id)).content).toEqual(before.content)
    const routes = await db.as('owner', c =>
      c.query('SELECT 1 FROM published_routes WHERE page_id=ANY($1::uuid[])', [[first, second]]),
    )
    expect(routes.rowCount).toBe(0)
  })

  it('lets Contributors append to saved drafts, preserves metadata/live output, and rejects stale writes', async () => {
    const original = await source()
    const id = await capture(original.version)
    const target = await source()
    await db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,1,$2,$3,$4)', [target.id, ...CHECKED_CLEAN]))
    const live = (await page(target.id)).published_version_id
    await use(id, 1, s.contributorA, target.id, 2)
    const after = await page(target.id)
    expect(after.content).toHaveLength(2)
    expect(after.meta.title).toBe('Source SEO')
    expect(after.published_version_id).toBe(live)
    expect(after.revision).toBe('3')
    await expectSqlState(use(id, 1, s.contributorA, target.id, 2), 'CMS01')
    await expectSqlState(use(id, 1, s.contributorA, target.id, null), 'CMS01')
    expect((await page(target.id)).content).toHaveLength(2)
  })

  it('enforces Editor+ management and creation, tenant boundaries and private recipe reads', async () => {
    const original = await source()
    const id = await capture(original.version)
    await expectSqlState(capture(original.version, undefined, s.contributorA), 'CMS02')
    await expectSqlState(capture(original.version, undefined, s.editorB), 'CMS02')
    await expectSqlState(capture(original.version, undefined, s.disabled), 'CMS02')
    await expectSqlState(use(id, 1, s.contributorA), 'CMS02')
    await expectSqlState(use(id, 1, s.editorB), 'CMS03')
    const foreign = await source(undefined, s.siteB)
    await expectSqlState(capture(foreign.version), 'CMS03')
    await expectSqlState(use(id, 1, s.superAdmin, foreign.id, 1), 'CMS03')
    expect((await db.asUser(s.editorB, c => c.query('SELECT * FROM page_recipes WHERE id=$1', [id]))).rowCount).toBe(0)
    await expectSqlState(
      db.asUser(s.contributorA, c => c.query('SELECT app.manage_page_recipe($1,1,$2,false)', [id, 'Renamed'])),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.editorA, c => c.query("UPDATE page_recipe_versions SET content='[]' WHERE recipe_id=$1", [id])),
      '42501',
    )
    await expectSqlState(
      db.as('public', c => c.query('SELECT * FROM public.page_recipes')),
      '42501',
    )
  })

  it('updates recipes immutably, rejects missing CAS, and keeps previous uses intact through rename/retirement', async () => {
    const original = await source()
    const id = await capture(original.version)
    const existing = await use(id)
    const first = await recipe(id)
    await expectSqlState(capture(original.version, undefined, undefined, id, null), 'CMS01')
    await capture(original.version, [{ index: 0, sample: false }], undefined, id, 1)
    expect((await recipe(id)).current_version_id).not.toBe(first.current_version_id)
    expect((await page(existing)).content).toEqual(first.content)
    await expectSqlState(use(id, 1), 'CMS01')
    await expectSqlState(use(id, null), 'CMS01')
    await db.asUser(s.editorA, c => c.query('SELECT app.manage_page_recipe($1,2,$2,false)', [id, 'Renamed recipe']))
    expect((await recipe(id)).name).toBe('Renamed recipe')
    await db.asUser(s.editorA, c => c.query('SELECT app.manage_page_recipe($1,3,$2,true)', [id, 'Renamed recipe']))
    await expectSqlState(use(id, 4), 'CMS04')
    const versions = await db.asUser(s.editorA, c =>
      c.query('SELECT content FROM page_recipe_versions WHERE recipe_id=$1 ORDER BY revision', [id]),
    )
    expect(versions.rows).toHaveLength(2)
    expect(versions.rows[0]!.content).toEqual(first.content)
    expect((await page(existing)).content).toEqual(first.content)
    await db.asUser(s.editorA, c => c.query('SELECT app.manage_page_recipe($1,4,$2,false)', [id, 'Restored recipe']))
    expect(await use(id, 5)).toBeTruthy()
  })

  it('pins preview versions and excludes source metadata and unchosen content', async () => {
    const original = await source()
    const id = await capture(original.version, [{ index: 0, sample: false }])
    const saved = await recipe(id)
    const preview = await db.asUser(
      s.contributorA,
      async c =>
        (await c.query('SELECT app.preview_page_recipe($1,$2) AS manifest', [id, saved.current_version_id])).rows[0]!
          .manifest,
    )
    expect(preview.sections[0].instance.values).toEqual({})
    expect(preview.sections[0].def.version).toBe(1)
    expect(preview.meta).toEqual({ title: 'Conference overview', noindex: true })
    await expectSqlState(
      db.asUser(s.editorB, c => c.query('SELECT app.preview_page_recipe($1,$2)', [id, saved.current_version_id])),
      'CMS03',
    )
  })

  it('refuses invalid selections, advanced source snippets and no-longer-available definitions', async () => {
    const original = await source()
    await expectSqlState(capture(original.version, []), 'CMS04')
    await expectSqlState(capture(original.version, [{ index: -1, sample: false }]), 'CMS04')
    await expectSqlState(capture(original.version, [{ index: 40, sample: false }]), 'CMS04')
    await expectSqlState(capture(original.version, undefined, undefined, null, null), 'CMS01')
    const trusted = JSON.parse(heroContent(s.heroDefId))
    trusted[0].raw_html = '<p>Advanced source</p>'
    await expectSqlState(capture((await source(trusted)).version), 'CMS04')
    const id = await capture(original.version)
    await db.as('owner', c => c.query("UPDATE section_defs SET status='retired' WHERE id=$1", [s.heroDefId]))
    try {
      await expectSqlState(use(id), 'CMS04')
    } finally {
      await db.as('owner', c => c.query("UPDATE section_defs SET status='active' WHERE id=$1", [s.heroDefId]))
    }
  })

  it('retains recipe sources, enforces their tenant FK and leaves unreferenced autosaves prunable', async () => {
    const original = await source()
    const id = await capture(original.version)
    const foreign = await source(undefined, s.siteB)
    await expectSqlState(
      db.as('owner', c =>
        c.query(
          `INSERT INTO page_recipe_versions(recipe_id,site_id,revision,source_version_id,content,created_by)
      VALUES($1,$2,90,$3,$4,$5)`,
          [id, s.siteA, foreign.version, heroContent(s.heroDefId), s.superAdmin],
        ),
      ),
      '23503',
    )
    await expectSqlState(
      db.as('owner', c => c.query("UPDATE page_recipe_versions SET content='[]' WHERE recipe_id=$1", [id])),
      '42501',
    )
    const unreferenced = await db.asUser(s.editorA, async c => {
      const saved = (
        await c.query('SELECT * FROM app.save_page_draft($1,1,$2,$3)', [
          original.id,
          heroContent(s.heroDefId, 'Rolling save'),
          '{}',
        ])
      ).rows[0]!.version_id
      await c.query('SELECT * FROM app.save_page_draft($1,2,$2,$3)', [
        original.id,
        heroContent(s.heroDefId, 'Current save'),
        '{}',
      ])
      return saved
    })
    // There is no autosave-pruning job yet. This asserts its required pin
    // predicate alongside the existing draft/live-head exclusions.
    const removed = await db.as('owner', c =>
      c.query(
        `DELETE FROM page_versions v WHERE v.page_id=$1 AND v.kind='autosave'
      AND NOT EXISTS(SELECT 1 FROM pages p WHERE p.draft_version_id=v.id OR p.published_version_id=v.id)
      AND NOT EXISTS(SELECT 1 FROM page_recipe_versions r WHERE r.source_version_id=v.id) RETURNING id`,
        [original.id],
      ),
    )
    expect(removed.rows).toEqual([{ id: unreferenced }])
    expect((await recipe(id)).source_version_id).toBe(original.version)
    expect(await use(id)).toBeTruthy()
  })

  it('revalidates governed media at capture and use without accepting foreign assets', async () => {
    const media = await db.as(
      'owner',
      async c =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO media
      (site_id,object_key,content_hash,original_name,alt_text,decorative,width,height,bytes,mime_type,status,uploaded_by)
      VALUES($1,$2,$3,'recipe.jpg','Sample image',false,100,100,1000,'image/jpeg','ready',$4) RETURNING id`,
            [s.siteA, `media/recipe/${randomUUID()}/original.jpg`, 'a'.repeat(64), s.superAdmin],
          )
        ).rows[0]!.id,
    )
    // The database's slot-independent reference validator must still enforce
    // ownership even if a malformed client puts an image in a text slot.
    const content = JSON.parse(heroContent(s.heroDefId))
    content[0].values.heading = { media_id: media, variant: 'original' }
    const original = await source(content)
    const id = await capture(original.version)
    await db.as('owner', c => c.query("UPDATE media SET deleted_at=now(),status='deleted' WHERE id=$1", [media]))
    await expectSqlState(use(id), 'CMS04')
    await expectSqlState(capture(original.version), 'CMS04')
    await db.as('owner', c =>
      c.query("UPDATE media SET deleted_at=NULL,status='ready',site_id=$2 WHERE id=$1", [media, s.siteB]),
    )
    await expectSqlState(use(id), 'CMS04')
    const linked = JSON.parse(heroContent(s.heroDefId))
    linked[0].values.intro = `<a href="/media/${media}/original">Foreign asset</a>`
    await expectSqlState(capture((await source(linked)).version), 'CMS04')
    await db.as('owner', c => c.query('UPDATE media SET site_id=$2 WHERE id=$1', [media, s.siteA]))
    expect(await use(id)).toBeTruthy()
    const linkedSource = await source(linked)
    await capture(linkedSource.version)
    const usage = await db.as('owner', c =>
      c.query('SELECT media_id FROM media_usage WHERE version_id=$1', [linkedSource.version]),
    )
    expect(usage.rows).toEqual([{ media_id: media }])
  })

  it('retains valid private collection bindings without private records and rejects foreign reader keys', async () => {
    const doc = {
      schemaVersion: 3,
      fields: [{ name: 'people', type: 'repeat', label: 'People' }],
      nodes: [
        { type: 'repeat', field: 'people', empty: { behavior: 'hide' }, item: [{ type: 'text', field: 'name' }] },
      ],
    }
    const def = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query<{ section_def_id: string }>(
            'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
            [
              'recipe-people',
              'Recipe people',
              'Collections',
              '',
              '',
              '',
              JSON.stringify({ nodes: [], policyVersion: 4, cssPolicyVersion: 6 }),
              JSON.stringify([{ id: 'people', kind: 'repeat', label: 'People', constraints: {} }]),
              'recipe-people',
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
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        'recipe-people',
        'Recipe people',
        'recipe_people',
        JSON.stringify([{ key: 'name', label: 'Name', type: 'text', required: true }]),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'name',
          subtitleField: null,
          imageField: null,
          groupField: null,
        }),
      ]),
    )
    const binding = { readerKey: 'recipe_people', selection: { mode: 'automatic', limit: 10 } }
    const original = await source([
      {
        section_def_id: def,
        section_def_version: 1,
        label: '',
        hidden: false,
        hidden_at: [],
        values: { people: binding },
      },
    ])
    const id = await capture(original.version)
    expect((await recipe(id)).content[0].values.people).toEqual(binding)
    expect(await use(id)).toBeTruthy()
    const withoutSamples = await capture(original.version, [{ index: 0, sample: false }])
    expect((await recipe(withoutSamples)).content[0].values.people).toEqual(binding)
    expect(await use(withoutSamples)).toBeTruthy()
    const missing = await source([
      { section_def_id: def, section_def_version: 1, values: { people: { ...binding, readerKey: 'foreign_people' } } },
    ])
    await expectSqlState(capture(missing.version), 'CMS04')
    const leaked = await source([
      {
        section_def_id: def,
        section_def_version: 1,
        values: { people: { ...binding, entries: [{ values: { name: 'Private record' } }] } },
      },
    ])
    await expectSqlState(capture(leaked.version), 'CMS04')
  })
})
