import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import {
  installBetterTogetherLists,
  type BetterTogetherListPlan,
} from '../../importer/src/better-together-list-install.ts'
import { compileSection } from '../../renderer/src/index.ts'
let db: TestDatabase, s: Scenario, plans: BetterTogetherListPlan[]
beforeAll(async () => {
  db = await TestDatabase.create('bt_native_lists')
  s = await seedScenario(db)
  plans = []
  await db.asUser(s.superAdmin, async c => {
    const content = []
    for (const kind of ['speakers', 'sponsors', 'workshops'] as const) {
      const html = '<div><p>{{title}}</p></div>',
        slots = [{ id: 'title', kind: 'text' as const, label: 'Title', constraints: {} }],
        compiled = compileSection({ sourceHtml: html, slots })
      const definition = (
        await c.query(
          'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            'original-' + kind,
            kind,
            'Better Together',
            html,
            '',
            '',
            JSON.stringify(compiled.ast),
            JSON.stringify(slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            'Original local source',
            false,
            'legacy',
            null,
            null,
            'site',
            s.siteA,
          ],
        )
      ).rows[0]!.section_def_id
      content.push({ section_def_id: definition, section_def_version: 1, values: { title: 'Original ' + kind } })
      plans.push({
        name: kind,
        readerKey: kind,
        pageId: s.pageA,
        pageRevision: 0,
        originalVersion: '',
        index: content.length - 1,
        definitionId: definition,
        originalDefinitionVersion: 1,
        fields: [{ key: 'title', label: 'Title', type: 'text', required: true }],
        presentation: {
          schemaVersion: 1,
          titleField: 'title',
          subtitleField: null,
          imageField: null,
          groupField: null,
        },
        entries: [{ id: null, stableKey: 'original-item', values: { title: 'Original ' + kind } }],
        sourceHtml: '<div>{{#items}}<p>{{title}}</p>{{/items}}</div>',
        slots: [
          {
            id: 'items',
            kind: 'repeat',
            label: kind,
            constraints: { collection: true, item: { fields: [{ id: 'title', kind: 'text', label: 'Title' }] } },
          },
        ],
        values: { items: { readerKey: kind, selection: { mode: 'automatic', limit: 200 } } },
      })
    }
    const page = (
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, JSON.stringify(content), '{}'])
    ).rows[0]!
    for (const plan of plans) {
      plan.pageRevision = page.revision
      plan.originalVersion = page.version_id
    }
    await c.query('SELECT * FROM app.save_site_file_bundle($1,0,$2)', [
      s.siteA,
      JSON.stringify({
        version: 1,
        files: [],
        scripts: [],
        styles: [],
        original: {
          version: 1,
          pages: [{ pageId: s.pageA, html: {}, body: {}, header: false, footer: false }],
          definitions: plans.map(plan => ({ section_def_id: plan.definitionId, section_def_version: 1 })),
        },
      }),
    ])
  })
})
afterAll(async () => {
  await db?.close()
})
it('requires Super Admin review, and refuses a stale page before creating lists', async () => {
  await expect(
    db.asUser(s.editorA, client => installBetterTogetherLists({ client, siteId: s.siteA, plans, reviewed: true })),
  ).rejects.toThrow(/Super Admin/)
  await expect(
    db.asUser(s.superAdmin, client => installBetterTogetherLists({ client, siteId: s.siteA, plans, reviewed: false })),
  ).rejects.toThrow(/Review/)
  await expect(
    db.asUser(s.superAdmin, client =>
      installBetterTogetherLists({
        client,
        siteId: s.siteA,
        plans: plans.map(plan => ({ ...plan, pageRevision: 999 })),
        reviewed: true,
      }),
    ),
  ).rejects.toThrow(/changed after review/)
  expect((await db.as('owner', c => c.query('SELECT id FROM collections WHERE site_id=$1', [s.siteA]))).rowCount).toBe(
    0,
  )
})
it('installs three draft lists and new layout pins, then a rerun preserves subsequent item drafts', async () => {
  const installed = await db.asUser(s.superAdmin, client =>
    installBetterTogetherLists({ client, siteId: s.siteA, plans, reviewed: true }),
  )
  expect(installed.created.map(list => list.readerKey)).toEqual(['speakers', 'sponsors', 'workshops'])
  const before = await db.as('owner', async c => {
    const page = (
        await c.query(
          'SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [s.pageA],
        )
      ).rows[0]!,
      files = (
        await c.query(
          'SELECT v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
          [s.siteA],
        )
      ).rows[0]!
    expect(page.content.every((section: { section_def_version: number }) => section.section_def_version === 2)).toBe(
      true,
    )
    expect(files.bundle.original.definitions).toHaveLength(6)
    expect(
      (await c.query('SELECT published_entry_revision FROM collections WHERE site_id=$1', [s.siteA])).rows.every(
        row => Number(row.published_entry_revision) === 0,
      ),
    ).toBe(true)
    return page
  })
  const list = installed.created[0]!.id
  await db.asUser(s.editorA, async c => {
    const row = (
      await c.query(
        'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
        [list],
      )
    ).rows[0]!
    await c.query('SELECT * FROM app.save_collection_entries($1,1,$2)', [
      list,
      JSON.stringify([{ id: row.id, stableKey: row.stable_key, values: { title: 'Coordinator edit' } }]),
    ])
  })
  const retry = await db.asUser(s.superAdmin, client =>
    installBetterTogetherLists({ client, siteId: s.siteA, plans, reviewed: true }),
  )
  expect(retry.created).toEqual([])
  expect(retry.existing.sort()).toEqual(['speakers', 'sponsors', 'workshops'])
  const after = await db.as('owner', c =>
    c.query('SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1', [
      s.pageA,
    ]),
  )
  expect(after.rows[0]).toEqual(before)
  expect(
    (
      await db.as('owner', c =>
        c.query(
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
          [list],
        ),
      )
    ).rows[0]!.values.title,
  ).toBe('Coordinator edit')
})
