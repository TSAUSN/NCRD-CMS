import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
import { compileSection } from '../../renderer/src/index.ts'
import {
  installBetterTogetherFrame,
  type OriginalFrameInstallPlan,
} from '../../importer/src/better-together-frame-install.ts'
let db: TestDatabase, s: Scenario, plan: OriginalFrameInstallPlan
beforeAll(async () => {
  db = await TestDatabase.create('bt_frame_install')
  s = await seedScenario(db)
  plan = await db.asUser(s.superAdmin, async c => {
    const definitions = [],
      components = []
    for (const kind of ['header', 'footer']) {
      const sourceHtml = '<div class="' + kind + '"><a href="/">{{title}}</a></div>',
        slots = [{ id: 'title', kind: 'text' as const, label: 'Title', constraints: {} }],
        ast = compileSection({ sourceHtml, slots })
      const id = (
        await c.query(
          'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            'bt-frame-' + kind,
            kind,
            'Better Together',
            sourceHtml,
            '',
            '',
            JSON.stringify(ast.ast),
            JSON.stringify(slots),
            ast.renderHash,
            ast.ast.policyVersion,
            ast.ast.cssPolicyVersion,
            'original',
            false,
            'legacy',
            null,
            null,
            'site',
            s.siteA,
          ],
        )
      ).rows[0]!.section_def_id
      await c.query('SELECT app.set_section_def_placement($1,$2)', [id, kind])
      definitions.push({
        id,
        version: 1,
        name: kind,
        sourceHtml: sourceHtml.replace('href="/"', 'href="{{destination}}"'),
        slots: [
          ...slots,
          { id: 'destination', kind: 'link' as const, label: 'Home link', constraints: { destinationOnly: true } },
        ],
      })
      components.push({ section_def_id: id, section_def_version: 1, values: { title: 'Original ' + kind } })
    }
    await c.query('SELECT * FROM app.save_global_elements_draft($1,1,1,$2,$3)', [
      s.siteA,
      JSON.stringify({ schemaVersion: 2, enabled: true, sticky: false, component: components[0] }),
      JSON.stringify({ schemaVersion: 2, enabled: true, component: components[1] }),
    ])
    await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId), '{}'])
    const pages = (
      await c.query(
        'SELECT p.id,p.revision,p.draft_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [s.pageA],
      )
    ).rows
    const frame = (
      await c.query(
        'SELECT h.kind,h.revision,h.draft_version_id,v.content FROM global_elements h JOIN global_element_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [s.siteA],
      )
    ).rows
    for (const head of frame) {
      head.content.component.section_def_version = 2
      head.content.component.values.destination = { url: '/', label: 'Home' }
    }
    const menu = (await c.query('SELECT revision,draft_version_id FROM navigations WHERE site_id=$1', [s.siteA]))
      .rows[0]!
    const bundle = {
      version: 1,
      files: [],
      scripts: [],
      styles: [],
      original: {
        version: 1,
        definitions: definitions.map(d => ({ section_def_id: d.id, section_def_version: 1 })),
        pages: [{ pageId: s.pageA, html: { lang: 'en' }, body: {}, header: true, footer: true }],
      },
    }
    const files = (await c.query('SELECT * FROM app.save_site_file_bundle($1,0,$2)', [s.siteA, JSON.stringify(bundle)]))
      .rows[0]!
    return {
      definitions,
      pages,
      frame,
      menu: { ...menu, tree: [{ label: 'Home', visible: true, target: { type: 'page', page_id: s.pageA } }] },
      files: {
        revision: files.revision,
        draft_version_id: files.version_id,
        bundle: {
          ...bundle,
          original: {
            ...bundle.original,
            definitions: [
              ...bundle.original.definitions,
              ...definitions.map(d => ({ section_def_id: d.id, section_def_version: 2 })),
            ],
            newPages: { html: { lang: 'en' }, body: {}, header: true, footer: true },
          },
        },
      },
    }
  })
})
afterAll(async () => {
  await db?.close()
})
const install = (p = plan, user = s.superAdmin, siteId = s.siteA, reviewed = true) =>
  db.asUser(user, client => installBetterTogetherFrame({ client, siteId, plan: p, reviewed }))
it('requires root review and site ownership before any writes', async () => {
  await expect(install(plan, s.editorA)).rejects.toThrow(/Super Admin/)
  await expect(install(plan, s.superAdmin, s.siteA, false)).rejects.toThrow(/Review/)
  await expect(install(plan, s.superAdmin, s.siteB)).rejects.toThrow(/another site/)
})
it('refuses stale page, menu, frame, file and definition checkpoints without partial changes', async () => {
  for (const key of ['pages', 'frame', 'menu', 'files', 'definitions'] as const) {
    const p = structuredClone(plan)
    if (key === 'definitions') p.definitions[0]!.version = 99
    else if (key === 'pages' || key === 'frame') p[key][0]!.revision = 999
    else p[key].revision = 999
    await expect(install(p)).rejects.toThrow(/changed after review/)
  }
  const actual = await db.as('owner', c =>
    c.query('SELECT max(version) AS version FROM section_def_versions WHERE section_def_id=$1', [
      plan.definitions[0]!.id,
    ]),
  )
  expect(actual.rows[0]!.version).toBe(1)
})
it('stores new immutable frame versions and reviewed defaults, then preserves later editorial drafts on rerun', async () => {
  expect(await install()).toEqual({ installed: true, definitions: 2 })
  const frame = await db.asUser(s.editorA, c =>
    c.query(
      'SELECT v.content FROM global_elements h JOIN global_element_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
      [s.siteA],
    ),
  )
  expect(frame.rows.every(row => row.content.component.section_def_version === 2)).toBe(true)
  await db.asUser(s.editorA, c =>
    c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      s.pageA,
      Number(plan.pages[0]!.revision) + 1,
      heroContent(s.heroDefId, 'Keep later edit'),
      '{}',
    ]),
  )
  const before = await db.as('owner', c =>
    c.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [s.pageA]),
  )
  expect(await install()).toEqual({ installed: false, definitions: 2 })
  expect(
    (await db.as('owner', c => c.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [s.pageA]))).rows,
  ).toEqual(before.rows)
  const bundle = (
    await db.as('owner', c =>
      c.query(
        'SELECT v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [s.siteA],
      ),
    )
  ).rows[0]!.bundle
  expect(bundle).toEqual(plan.files.bundle)
})
