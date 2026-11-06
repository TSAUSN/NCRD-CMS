import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState, CHECKED_CLEAN } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { importReferenceDrafts } from '../../importer/src/database.ts'
import { importCatalogueLibrary } from '../../importer/src/catalogue-library-database.ts'
import { importPageTemplates } from '../../importer/src/page-templates-database.ts'
import type { V1Catalogue, V1Definition } from '../../importer/src/source.ts'
import { canonical, digest } from '../../importer/src/backup.ts'
import { staticCompatibility } from '../../importer/src/static-compatibility.ts'
import type { MigrationBundle, MigrationRecord } from '../../importer/src/migration.ts'
import { createFilesystemMediaStore, createPlaceholderScreenshotter } from '../../platform/src/local/index.ts'

let db: TestDatabase
let scenario: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('v1_import')
  scenario = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

function fixture(): MigrationBundle {
  const sourceRecords: Omit<MigrationRecord, 'sourceSha256'>[] = [
    {
      key: 'backup/sites/humanneedsindex',
      kind: 'placeholder',
      sourceSite: 'humanneedsindex',
      payload: null,
      issues: [],
    },
    {
      key: 'backup/sites/humanneedsindex/pages/home',
      kind: 'draft-page',
      sourceSite: 'humanneedsindex',
      payload: { title: 'Private draft', status: 'draft' },
      issues: ['review'],
    },
    {
      key: 'backup/releaseNotes/one',
      kind: 'release-note',
      sourceSite: 'humanneedsindex',
      payload: { action: 'publish', userEmail: 'private@example.test', timestamp: '2026-07-30T00:00:00Z' },
      issues: [],
    },
  ]
  const records = sourceRecords.map(record => ({ ...record, sourceSha256: digest(canonical(record.payload)) }))
  return {
    format: 'cms-v1-migration',
    version: 1,
    runId: digest(randomUUID()),
    manifestSha256: digest('fixture'),
    takenAt: '2026-07-30T00:00:00Z',
    files: [],
    records,
    counts: { documents: 2, placeholders: 1, sourceFiles: 0, definitions: 0, assets: 0 },
    references: [
      {
        key: 'sites/humanneedsindex/pages/home',
        sourceSite: 'humanneedsindex',
        sourcePage: 'home',
        sourceState: 'draft',
        issues: ['review'],
        sections: [
          {
            key: 'fixture-section',
            appliedFields: 1,
            ...staticCompatibility({
              slug: 'fixture-source',
              html: '<section><h2 data-editable="text" data-block-id="heading">Preserved source</h2><p>Private historical copy</p></section>',
              css: 'section{padding:2rem}',
            }),
          },
        ],
      },
    ],
  }
}
const importBundle = (bundle: MigrationBundle) =>
  db.asUser(scenario.superAdmin, client =>
    importReferenceDrafts(client, bundle, {
      prefix: `v1-${bundle.runId.slice(0, 8)}`,
      stagingApex: 'staging.example.test',
    }),
  )

describe('V1 offline migration lifecycle', () => {
  it('imports source references atomically, retains immutable provenance, and creates no publication or users', async () => {
    const bundle = fixture()
    const before = await db.as(
      'owner',
      async client => (await client.query('SELECT count(*) AS n FROM app_users')).rows[0]!.n,
    )
    const imported = await importBundle(bundle)
    expect(imported.createdPages).toBe(1)
    const state = await db.asUser(scenario.superAdmin, async client => {
      const targets = (await client.query('SELECT * FROM v1_import_targets WHERE run_id=$1', [imported.runId])).rows
      const page = (
        await client.query(
          'SELECT p.*,v.carries_trusted_code,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [targets[0]!.page_id],
        )
      ).rows[0]!
      const records = (
        await client.query('SELECT * FROM v1_import_records WHERE run_id=$1 ORDER BY source_key', [imported.runId])
      ).rows
      const audits = (
        await client.query(
          "SELECT * FROM audit_log WHERE action='migration.v1.release_note' AND detail->>'run_id'=$1",
          [imported.runId],
        )
      ).rows
      return { page, records, audits }
    })
    expect(state.page.published_version_id).toBeNull()
    // Passive HTML is correctly classified by the server. Import review has
    // its own exact-version publish gate, rather than spoofing trusted code.
    await expectSqlState(
      db.asUser(scenario.superAdmin, client =>
        client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [state.page.id, 1, ...CHECKED_CLEAN]),
      ),
      'CMS04',
    )
    expect(state.page.content).toHaveLength(2)
    expect(Object.values(state.page.content[1].values)).toContain('Preserved source')
    const definition = await db.asUser(
      scenario.superAdmin,
      async client =>
        (
          await client.query('SELECT slots FROM section_def_versions WHERE section_def_id=$1 AND version=$2', [
            state.page.content[1].section_def_id,
            state.page.content[1].section_def_version,
          ])
        ).rows[0],
    )
    expect(definition.slots).toEqual([expect.objectContaining({ kind: 'text', label: 'Heading' })])
    expect(state.records).toHaveLength(3)
    expect(state.records.find(record => record.kind === 'placeholder')?.payload).toBeNull()
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]!.actor_type).toBe('migration')
    expect(state.audits[0]!.actor_id).toBeNull()
    expect(JSON.stringify(state.audits)).not.toContain('private@example.test')
    expect(
      await db.as('owner', async client => (await client.query('SELECT count(*) AS n FROM app_users')).rows[0]!.n),
    ).toBe(before)
    const retry = await importBundle(bundle)
    expect(retry).toMatchObject({ runId: imported.runId, createdPages: 0, existingPages: 1 })
  })

  it('rejects changed receipts and rolls back an entire package when a later record is invalid', async () => {
    const bundle = fixture()
    await importBundle(bundle)
    const changed = structuredClone(bundle)
    changed.records[1]!.payload = { title: 'Changed source' }
    await expectSqlState(importBundle(changed), 'CMS04')
    const invalid = fixture()
    invalid.records.push({ ...invalid.records[0]!, key: '../escape' })
    await expectSqlState(importBundle(invalid), 'CMS04')
    expect(
      await db.asUser(
        scenario.superAdmin,
        async client => (await client.query('SELECT id FROM v1_import_runs WHERE run_key=$1', [invalid.runId])).rows,
      ),
    ).toEqual([])
  })

  it('rolls back source records and earlier writes if reference compilation fails', async () => {
    const bundle = fixture()
    bundle.references[0]!.sections[0]!.sourceHtml = '<script>unsafe()</script>'
    await expect(importBundle(bundle)).rejects.toThrow(/reference HTML|active content/)
    expect(
      await db.asUser(
        scenario.superAdmin,
        async client => (await client.query('SELECT id FROM v1_import_runs WHERE run_key=$1', [bundle.runId])).rows,
      ),
    ).toEqual([])
  })

  it('keeps private source inaccessible to other CMS roles and immutable even to an owner', async () => {
    const bundle = fixture()
    const imported = await importBundle(bundle)
    expect(
      await db.asUser(scenario.editorA, async client => (await client.query('SELECT * FROM v1_import_runs')).rows),
    ).toEqual([])
    await expectSqlState(
      db.asUser(scenario.editorA, client =>
        client.query('SELECT app.stage_v1_import($1)', [JSON.stringify(fixture())]),
      ),
      'CMS02',
    )
    await expectSqlState(
      db.as('public', client => client.query('SELECT * FROM v1_import_records')),
      '42501',
      '42P01',
    )
    await expectSqlState(
      db.as('worker', client => client.query('SELECT * FROM v1_import_records')),
      '42501',
      '42P01',
    )
    await expect(
      db.as('owner', client =>
        client.query('UPDATE v1_import_runs SET run_key=$1 WHERE id=$2', [digest('changed'), imported.runId]),
      ),
    ).rejects.toThrow(/append-only/)
  })

  it('records review decisions with CAS, retry receipts, and immutable V2 target evidence', async () => {
    const imported = await importBundle(fixture())
    const source = await db.asUser(
      scenario.superAdmin,
      async client =>
        (
          await client.query(
            'SELECT r.id,t.page_id,t.version_id FROM v1_import_records r JOIN v1_import_targets t ON t.run_id=r.run_id AND t.source_key=r.source_key WHERE r.run_id=$1',
            [imported.runId],
          )
        ).rows[0]!,
    )
    const request = randomUUID()
    const review = (actor: string, id: string, revision: number, target: string | null) =>
      db.asUser(actor, client =>
        client.query('SELECT app.review_v1_record($1,$2,$3,$4,$5,$6,$7) AS revision', [
          id,
          source.id,
          revision,
          'mapped',
          'Reviewed the preserved draft against its source.',
          target,
          'fixture-parity-report',
        ]),
      )
    await expectSqlState(review(scenario.editorA, request, 0, source.version_id), 'CMS02')
    await expectSqlState(review(scenario.superAdmin, request, 0, null), 'CMS04')
    expect((await review(scenario.superAdmin, request, 0, source.version_id)).rows[0]!.revision).toBe('1')
    expect((await review(scenario.superAdmin, request, 0, source.version_id)).rows[0]!.revision).toBe('1')
    await expectSqlState(review(scenario.superAdmin, randomUUID(), 0, source.version_id), 'CMS01')
    await expectSqlState(review(scenario.superAdmin, request, 1, source.version_id), 'CMS04')
    await db.asUser(scenario.superAdmin, async client => {
      const site = (await client.query('SELECT site_id FROM pages WHERE id=$1', [source.page_id])).rows[0]!.site_id
      await client.query('SELECT app.publish_theme($1,1)', [site])
      await client.query('SELECT app.publish_global_elements($1,1,1)', [site])
      await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [source.page_id, 1, ...CHECKED_CLEAN])
      await client.query('SELECT app.publish_navigation($1,1)', [site])
    })
    await db.asUser(scenario.superAdmin, async client => {
      const version = (await client.query('SELECT content,meta FROM page_versions WHERE id=$1', [source.version_id]))
        .rows[0]!
      await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        source.page_id,
        2,
        JSON.stringify(version.content),
        JSON.stringify(version.meta),
      ])
    })
    await expectSqlState(
      db.asUser(scenario.superAdmin, client =>
        client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [source.page_id, 3, ...CHECKED_CLEAN]),
      ),
      'CMS04',
    )
  })

  it('inspects and transfers real image bytes, remaps the reference, indexes usage and refuses changed source bytes', async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'cms-v1-media-'))
    try {
      const source = path.join(temporary, 'source')
      const assetDirectory = path.join(source, 'tsa-humanneedsindex/public/images')
      mkdirSync(assetDirectory, { recursive: true })
      // A tiny generated PNG fixture, not evidence of browser rendering.
      const image = await createPlaceholderScreenshotter().capture({
        html: 'image fixture',
        viewport: { width: 8, height: 8 },
      })
      writeFileSync(path.join(assetDirectory, 'photo.png'), image.png)
      const store = createFilesystemMediaStore(path.join(temporary, 'objects'))
      const bundle = fixture()
      bundle.counts.assets = 1
      bundle.files = [
        {
          path: 'asset/tsa-humanneedsindex/public/images/photo.png',
          sha256: digest(Buffer.from(image.png)),
          bytes: image.png.length,
        },
      ]
      bundle.references[0]!.sections[0]!.sourceHtml =
        '<section><h2>Source image</h2><img src="/images/photo.png" alt="Source image" width="8" height="8"></section>'
      const importWithMedia = (input: MigrationBundle) =>
        db.asUser(scenario.superAdmin, client =>
          importReferenceDrafts(client, input, {
            prefix: `images-${input.runId.slice(0, 8)}`,
            stagingApex: 'staging.example.test',
            media: { sourceRoot: source, store },
          }),
        )
      const imported = await importWithMedia(bundle)
      expect(imported.transferredImages).toBe(1)
      const result = await db.as('owner', async client => {
        const media = (
          await client.query('SELECT m.* FROM media m JOIN v1_import_media x ON x.media_id=m.id WHERE x.run_id=$1', [
            imported.runId,
          ])
        ).rows[0]!
        const variants = (await client.query('SELECT * FROM media_variants WHERE media_id=$1', [media.id])).rows
        const usage = (await client.query('SELECT * FROM media_usage WHERE media_id=$1', [media.id])).rows
        const definitions = (
          await client.query(
            'SELECT v.source_html FROM section_def_versions v JOIN section_defs d ON d.id=v.section_def_id WHERE d.site_id=$1',
            [imported.sites[0]],
          )
        ).rows
        return { media, variants, usage, definitions }
      })
      expect(result.media.status).toBe('ready')
      expect(result.variants).toHaveLength(3)
      expect(result.usage).toHaveLength(1)
      expect(JSON.stringify(result.definitions)).toContain(`/media/${result.media.id}/original`)
      expect(digest(Buffer.from((await store.get(result.media.object_key))!))).toBe(result.media.content_hash)
      expect((await importWithMedia(bundle)).existingPages).toBe(1)
      const changed = structuredClone(bundle)
      changed.runId = digest(randomUUID())
      writeFileSync(path.join(assetDirectory, 'photo.png'), 'changed bytes')
      await expect(importWithMedia(changed)).rejects.toThrow(/changed after inventory/)
      expect(
        await db.asUser(
          scenario.superAdmin,
          async client => (await client.query('SELECT id FROM v1_import_runs WHERE run_key=$1', [changed.runId])).rows,
        ),
      ).toEqual([])
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})

describe('V1 library import (LIB-01)', () => {
  // A site created by a V1 import receives the sections V1 offered it, as its
  // own definitions: shared ones and its own, with the site's brand variables,
  // its already-imported pictures, and pictures from the same frozen run.
  const libraryDefinition = (id: string, html: string, sites: string[] | null = null): V1Definition => ({
    id,
    name: `Library ${id}`,
    category: 'Hero',
    family: null,
    sites,
    slots: [],
    html,
    css: '.x{color:var(--color-primary)}',
    sourcePath: 'registry',
    sourceLine: 1,
    htmlSha256: '',
    cssSha256: '',
  })
  const catalogue = (definitions: V1Definition[]): V1Catalogue => ({
    definitions,
    siteVariants: [],
    manifest: { files: [], sha256: '' },
    runId: 'catalogue',
    presetClasses: [],
    presetCss: '',
    divergingIds: [],
    unresolvedAnchors: new Map(),
  })

  it('creates the site’s own faithful definitions once, reusing and importing pictures from the frozen run', async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'cms-v1-library-'))
    try {
      const source = path.join(temporary, 'source'),
        images = path.join(source, 'tsa-humanneedsindex/public/images')
      mkdirSync(images, { recursive: true })
      const photo = await createPlaceholderScreenshotter().capture({ html: 'photo', viewport: { width: 8, height: 8 } })
      const other = await createPlaceholderScreenshotter().capture({
        html: 'other',
        viewport: { width: 10, height: 10 },
      })
      writeFileSync(path.join(images, 'photo.png'), photo.png)
      writeFileSync(path.join(images, 'other.png'), other.png)
      const store = createFilesystemMediaStore(path.join(temporary, 'objects'))
      const bundle = fixture()
      bundle.counts.assets = 2
      bundle.files = [
        {
          path: 'asset/tsa-humanneedsindex/public/images/photo.png',
          sha256: digest(Buffer.from(photo.png)),
          bytes: photo.png.length,
        },
        {
          path: 'asset/tsa-humanneedsindex/public/images/other.png',
          sha256: digest(Buffer.from(other.png)),
          bytes: other.png.length,
        },
      ]
      bundle.references[0]!.sections[0]!.sourceHtml =
        '<section><h2>Source image</h2><img src="/images/photo.png" alt="Source image" width="8" height="8"></section>'
      const imported = await db.asUser(scenario.superAdmin, client =>
        importReferenceDrafts(client, bundle, {
          prefix: `lib-${bundle.runId.slice(0, 8)}`,
          stagingApex: 'staging.example.test',
          media: { sourceRoot: source, store },
        }),
      )
      const site = imported.sites[0]!
      const library = catalogue([
        libraryDefinition(
          'hero-v1',
          '<section class="x"><h2 data-editable="text" data-block-id="hero-title">A bold statement</h2><img src="/images/photo.png" alt="" width="8" height="8"></section>',
        ),
        libraryDefinition(
          'story-v1',
          '<section class="x"><p data-editable="text" data-block-id="story-text">A story</p><img src="/images/other.png" alt="Volunteers" width="10" height="10"></section>',
          ['humanneedsindex'],
        ),
        libraryDefinition('event-v1', '<section><h2 data-editable="text" data-block-id="t">Event</h2></section>', [
          'echelonsymposium',
        ]),
        libraryDefinition('signup-v1', '<section><form action="#"><input name="email"></form></section>'),
      ])
      const run = (
        actor = scenario.superAdmin,
        siteId = site,
        options: { refresh?: boolean; catalogue?: V1Catalogue } = {},
      ) =>
        db.asUser(actor, client =>
          importCatalogueLibrary(client, {
            runId: imported.runId,
            siteId,
            site: 'humanneedsindex',
            catalogue: options.catalogue ?? library,
            sourceRoot: source,
            store,
            siteCss: ':root{--color-primary:#EF3E42}',
            ...(options.refresh ? { refresh: true } : {}),
          }),
        )
      const report = await run()
      expect(report.created.map(entry => entry.slug)).toEqual(['v1-lib-hni-hero-v1', 'v1-lib-hni-story-v1'])
      expect(report.refused).toEqual([{ sourceId: 'signup-v1', reason: expect.stringMatching(/not passive markup/) }])
      expect(report.importedImages).toEqual(['/images/other.png'])
      const stored = await db.as(
        'owner',
        async client =>
          (
            await client.query(`SELECT d.slug, d.scope, d.site_id, d.name, d.category, v.source_html, v.source_css, v.slots
        FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.slug LIKE 'v1-lib-hni-%' ORDER BY d.slug`)
          ).rows,
      )
      expect(stored.map(row => [row.slug, row.scope, row.site_id, row.name])).toEqual([
        ['v1-lib-hni-hero-v1', 'site', site, 'Library hero-v1'],
        ['v1-lib-hni-story-v1', 'site', site, 'Library story-v1'],
      ])
      const media = await db.as(
        'owner',
        async client =>
          (
            await client.query(`SELECT x.source_path, x.media_id FROM v1_import_media x WHERE x.run_id=$1 ORDER BY 1`, [
              imported.runId,
            ])
          ).rows,
      )
      expect(media.map(row => row.source_path)).toEqual([
        'asset/tsa-humanneedsindex/public/images/other.png',
        'asset/tsa-humanneedsindex/public/images/photo.png',
      ])
      // The already-imported picture is reused; the new one comes from the same run.
      expect(stored[0]!.source_html).toContain(`/media/${media[1]!.media_id}/original`)
      expect(stored[1]!.source_html).toContain(`/media/${media[0]!.media_id}/original`)
      expect(stored[0]!.source_css).toMatch(/^&\{--color-primary:#EF3E42\}/)
      expect(stored[0]!.slots).toEqual([
        expect.objectContaining({ label: 'Hero title', constraints: { sourceSample: 'A bold statement' } }),
      ])
      // A rerun leaves what exists exactly as it is.
      expect((await run()).existing).toEqual(['hero-v1', 'story-v1'])
      const versions = () =>
        db.as('owner', async client =>
          (
            await client.query(
              "SELECT d.slug, max(v.version) AS version FROM section_def_versions v JOIN section_defs d ON d.id=v.section_def_id WHERE d.slug LIKE 'v1-lib-hni-%' GROUP BY d.slug ORDER BY d.slug",
            )
          ).rows.map(row => [row.slug, Number(row.version)]),
        )
      expect(await versions()).toEqual([
        ['v1-lib-hni-hero-v1', 1],
        ['v1-lib-hni-story-v1', 1],
      ])
      // A refresh with nothing changed writes nothing.
      expect(await run(undefined, undefined, { refresh: true })).toMatchObject({
        existing: ['hero-v1', 'story-v1'],
        refreshed: [],
        edited: [],
      })
      // Someone edits the hero by hand; then the mapping of both changes.
      await db.asUser(scenario.superAdmin, async client => {
        const row = (
          await client.query(
            `SELECT v.* FROM section_def_versions v JOIN section_defs d ON d.id=v.section_def_id WHERE d.slug='v1-lib-hni-hero-v1'`,
          )
        ).rows[0]!
        await client.query(
          'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            'v1-lib-hni-hero-v1',
            'Library hero-v1',
            'Hero',
            row.source_html,
            row.source_css,
            row.compiled_css,
            JSON.stringify(row.compiled_ast),
            JSON.stringify(row.slots),
            row.render_hash,
            row.sanitizer_policy_version,
            row.css_policy_version,
            'Shorter title by hand',
            false,
            'legacy',
            null,
            null,
            'site',
            site,
          ],
        )
      })
      const changed = catalogue(
        library.definitions.map(definition => ({
          ...definition,
          html: definition.html.replace('A bold statement', 'A bolder statement').replace('A story', 'A longer story'),
        })),
      )
      // Without refresh, nothing moves; with it, only the unedited definition gets a new version.
      expect((await run(undefined, undefined, { catalogue: changed })).existing).toEqual(['hero-v1', 'story-v1'])
      expect(await run(undefined, undefined, { catalogue: changed, refresh: true })).toMatchObject({
        existing: [],
        edited: ['hero-v1'],
        refreshed: [{ sourceId: 'story-v1', slug: 'v1-lib-hni-story-v1', version: 2 }],
      })
      expect(await versions()).toEqual([
        ['v1-lib-hni-hero-v1', 2],
        ['v1-lib-hni-story-v1', 2],
      ])
      const refreshed = await db.as(
        'owner',
        async client =>
          (
            await client.query(`SELECT v.slots, v.changelog FROM section_def_versions v JOIN section_defs d ON d.id=v.section_def_id
        WHERE d.slug='v1-lib-hni-story-v1' AND v.version=2`)
          ).rows[0]!,
      )
      expect(refreshed.slots).toEqual([expect.objectContaining({ constraints: { sourceSample: 'A longer story' } })])
      expect(refreshed.changelog).toMatch(/^V1 library section story-v1 /)
      // V1's page templates become the site's recipes of its own library sections (LIB-09).
      const templates = [
        { id: 't1', name: 'Starter', description: '', sites: null, sections: ['story-v1', 'hero-v1'] },
        { id: 't2', name: 'Sign up', description: '', sites: null, sections: ['hero-v1', 'signup-v1'] },
        { id: 't3', name: 'Echelon only', description: '', sites: ['echelonsymposium'], sections: ['hero-v1'] },
      ]
      const recipes = (actor = scenario.superAdmin) =>
        db.asUser(actor, client =>
          importPageTemplates(client, { runId: imported.runId, siteId: site, site: 'humanneedsindex', templates }),
        )
      const first = await recipes()
      expect(first).toMatchObject({
        created: [{ name: 'Starter', sections: 2 }],
        existing: [],
        skipped: [{ name: 'Sign up', reason: "its signup-v1 section is not in this site's library" }],
      })
      const recipe = await db.as(
        'owner',
        async client =>
          (
            await client.query(
              `SELECT r.name, v.content FROM page_recipes r
        JOIN page_recipe_versions v ON v.id=r.current_version_id WHERE r.id=$1`,
              [first.created[0]!.recipeId],
            )
          ).rows[0]!,
      )
      expect(
        recipe.content.map((section: { label: string; section_def_version: number }) => [
          section.label,
          section.section_def_version,
        ]),
      ).toEqual([
        ['Library story-v1', 2],
        ['Library hero-v1', 2],
      ])
      // With V1's starting content, from each definition's current version.
      expect(JSON.stringify(recipe.content)).toContain('A longer story')
      expect(
        await db.as(
          'owner',
          async client =>
            (
              await client.query(
                `SELECT count(*) FILTER (WHERE archived_at IS NULL) AS live, count(*) AS total
        FROM pages WHERE site_id=$1 AND slug LIKE 'source-v1-page-templates-%'`,
                [site],
              )
            ).rows[0],
        ),
      ).toEqual({ live: '0', total: '1' })
      // A rerun leaves the recipe as it is; only a super admin may run it.
      expect(await recipes()).toMatchObject({ created: [], existing: ['Starter'] })
      await expect(recipes(scenario.editorA)).rejects.toThrow(/only a super admin/)
      // Only a super admin, and only into a site this test created.
      await expect(run(scenario.editorA)).rejects.toThrow(/only a super admin/)
      await expect(run(scenario.superAdmin, scenario.siteA)).rejects.toThrow(/not created by this V1 import run/)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})
