import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { EMPTY_SITE_FILE_BUNDLE } from '../src/content/site-files.ts'
let db: TestDatabase, s: Scenario, own: string, foreign: string, styled: string
beforeAll(async () => {
  db = await TestDatabase.create('original')
  s = await seedScenario(db)
  for (const site of [s.siteA, s.siteB]) {
    const id = await db.asUser(
      s.superAdmin,
      async client =>
        (
          await client.query(
            "SELECT cloned.section_def_id FROM section_def_versions v CROSS JOIN LATERAL app.upsert_section_def_version('original-hero','Original hero','Openers',v.source_html,'','',v.compiled_ast,v.slots,v.render_hash,v.sanitizer_policy_version,v.css_policy_version,'Import',false,'legacy',NULL,NULL,'site',$2) cloned WHERE v.section_def_id=$1 AND v.version=1",
            [s.heroDefId, site],
          )
        ).rows[0]!.section_def_id,
    )
    if (site === s.siteA) own = id
    else foreign = id
  }
  styled = await db.asUser(
    s.superAdmin,
    async client =>
      (
        await client.query(
          "SELECT cloned.section_def_id FROM section_def_versions v CROSS JOIN LATERAL app.upsert_section_def_version('styled-original','Styled original','Openers',v.source_html,v.source_css,replace(v.compiled_css,'.cms-section--hero','.cms-section--styled-original'),v.compiled_ast,v.slots,v.render_hash,v.sanitizer_policy_version,v.css_policy_version,'Import',false,'legacy',NULL,NULL,'site',$2) cloned WHERE v.section_def_id=$1 AND v.version=1",
          [s.heroDefId, s.siteA],
        )
      ).rows[0]!.section_def_id,
  )
})
afterAll(async () => {
  await db?.close()
})
const layout = () => ({
  version: 1,
  definitions: [{ section_def_id: own, section_def_version: 1 }],
  pages: [{ pageId: s.pageA, html: { lang: 'en' }, body: { 'data-bs-spy': 'scroll' }, header: true, footer: false }],
})
async function save(original: unknown, user?: string) {
  return db.asUser(user ?? s.superAdmin, async client => {
    const revision =
      (await client.query('SELECT revision FROM site_file_heads WHERE site_id=$1', [s.siteA])).rows[0]?.revision ?? 0
    return (
      await client.query('SELECT * FROM app.save_site_file_bundle($1,$2,$3)', [
        s.siteA,
        revision,
        JSON.stringify({ ...EMPTY_SITE_FILE_BUNDLE, original }),
      ])
    ).rows[0]!
  })
}
describe('reviewed original document boundary', () => {
  it('requires Super Admin review, retains exact immutable choices and audits them', async () => {
    await expectSqlState(save(layout(), s.editorA), 'CMS02')
    const saved = await save(layout())
    expect(
      (
        await db.asUser(s.superAdmin, c =>
          c.query('SELECT bundle FROM site_file_versions WHERE id=$1', [saved.version_id]),
        )
      ).rows[0]!.bundle.original,
    ).toEqual(layout())
    expect(
      (
        await db.asUser(s.superAdmin, c =>
          c.query("SELECT count(*) FROM audit_log WHERE site_id=$1 AND action='site.files.review'", [s.siteA]),
        )
      ).rows[0]!.count,
    ).toBe('1')
    expect(
      (await db.as('owner', c => c.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [s.siteA])))
        .rows[0]?.payload?.site_files?.bundle?.original,
    ).toBeUndefined()
  })
  it('keeps a reviewed browser mode and refuses non-boolean or foreign-page mode claims', async () => {
    const original = layout(),
      value = { ...original, pages: [{ ...original.pages[0], quirks: true }] },
      saved = await save(value)
    expect(
      (
        await db.asUser(s.superAdmin, c =>
          c.query('SELECT bundle FROM site_file_versions WHERE id=$1', [saved.version_id]),
        )
      ).rows[0]!.bundle.original,
    ).toEqual(value)
    await expectSqlState(save({ ...original, pages: [{ ...original.pages[0], quirks: 'true' }] }), 'CMS04')
    const foreignPage = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query("SELECT app.create_page($1,'mode-foreign','Foreign page') AS id", [s.siteB])).rows[0]!.id,
    )
    await expectSqlState(
      save({ ...original, pages: [{ ...original.pages[0], quirks: true, pageId: foreignPage }] }),
      'CMS04',
    )
    await expectSqlState(save({ ...original, pages: [null] }), 'CMS04')
  })
  it('refuses foreign/global/missing definitions, changed versions, foreign pages and injected metadata', async () => {
    const original = layout()
    for (const value of [
      { ...original, definitions: [{ section_def_id: foreign, section_def_version: 1 }] },
      { ...original, definitions: [{ section_def_id: styled, section_def_version: 1 }] },
      { ...original, definitions: [{ section_def_id: s.heroDefId, section_def_version: 1 }] },
      { ...original, definitions: [{ section_def_id: randomUUID(), section_def_version: 1 }] },
      { ...original, definitions: [{ section_def_id: own, section_def_version: 2 }] },
      { ...original, pages: [{ ...original.pages[0], pageId: randomUUID() }] },
      { ...original, definitions: [...original.definitions, ...original.definitions] },
      { ...original, pages: [...original.pages, ...original.pages] },
      { ...original, html: '<script>run()</script>' },
      { ...original, pages: [{ ...original.pages[0], body: { onload: 'run()' } }] },
      { ...original, pages: [{ ...original.pages[0], body: { 'data-cms-section': '0' } }] },
      { ...original, pages: [{ ...original.pages[0], body: { style: 'color:red' } }] },
      { ...original, pages: [{ ...original.pages[0], body: { dir: 'down' } }] },
      { ...original, pages: [{ ...original.pages[0], body: { class: '\n' } }] },
    ])
      await expectSqlState(save(value), 'CMS04')
  })
  it('requires fresh import acknowledgement without executable files', async () => {
    await expect(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.import_site_content($1,$2,$3)', [
          randomUUID(),
          JSON.stringify({ site_file_versions: [{ bundle: { original: layout() } }] }),
          '{}',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'CMS04', message: 'Review the original page layouts before importing them.' })
  })
  it('keeps the original immutable snapshot when the next review removes it', async () => {
    const saved = await save(layout())
    await db.asUser(s.superAdmin, async c => {
      await c.query('SELECT * FROM app.save_site_file_bundle($1,$2,$3)', [
        s.siteA,
        saved.revision,
        JSON.stringify(EMPTY_SITE_FILE_BUNDLE),
      ])
    })
    expect(
      (
        await db.asUser(s.superAdmin, c =>
          c.query('SELECT bundle FROM site_file_versions WHERE id=$1', [saved.version_id]),
        )
      ).rows[0]!.bundle.original,
    ).toEqual(layout())
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query("UPDATE site_file_versions SET bundle=bundle-'original' WHERE id=$1", [saved.version_id]),
      ),
      '42501',
    )
  })
  it('retains archived page choices in history while refusing fresh approval for an unavailable page', async () => {
    await db.as('owner', c => c.query('UPDATE pages SET archived_at=now() WHERE id=$1', [s.pageA]))
    await db.as('owner', async c => {
      const value = JSON.stringify({ ...EMPTY_SITE_FILE_BUNDLE, original: layout() })
      expect(
        (await c.query('SELECT app.archived_site_file_bundle_defect($1,$2) AS defect', [s.siteA, value])).rows[0]!
          .defect,
      ).toBeNull()
      expect(
        (await c.query('SELECT app.site_file_bundle_defect($1,$2) AS defect', [s.siteA, value])).rows[0]!.defect,
      ).toContain('must belong to this site')
    })
  })
})

it('can reapply the browser-mode migration without layering wrappers or changing saved choices', async () => {
  const sql = readFileSync(new URL('../migrations/0138_original_browser_layout.sql', import.meta.url), 'utf8'),
    pageId = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query("SELECT app.create_page($1,'mode-idempotent','Original layout') AS id", [s.siteA])).rows[0]!.id,
    )
  await db.as('owner', async c => {
    await c.query(sql)
    await c.query(sql)
    expect(
      (
        await c.query('SELECT app.original_layout_defect($1,$2,false) AS defect', [
          s.siteA,
          JSON.stringify({ ...layout(), pages: [{ ...layout().pages[0], pageId, quirks: true }] }),
        ])
      ).rows[0]!.defect,
    ).toBeNull()
  })
})
