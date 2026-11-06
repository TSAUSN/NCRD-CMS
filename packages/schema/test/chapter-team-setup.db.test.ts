import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario, division: string, staff: string, page: string, chapter: string
const config = {
  name: '[New chapter]',
  destination: 'page',
  pageId: null,
  externalUrl: null,
  updateMode: 'division',
  contact: { name: '[Name]', role: '[Role]', email: 'chapter@example.test' },
  sections: {
    paragraph: true,
    social: false,
    socialFirst: false,
    events: true,
    board: true,
    photos: false,
    memberLogin: false,
  },
  boardDisplay: 'all',
}
beforeAll(async () => {
  db = await TestDatabase.create('chapter_teams')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await c.query('SELECT app.enable_chapters($1)', [s.siteA])
    division = (await c.query("SELECT app.create_chapter_division($1,'Example division (sample)') AS id", [s.siteA]))
      .rows[0]!.id
    staff = (
      await c.query(
        "SELECT app.set_chapter_division_staff($1,'division-new@example.test','Division staff (sample)',true) AS id",
        [division],
      )
    ).rows[0]!.id
  })
})
afterAll(async () => {
  await db?.close()
})
it('shows an empty assigned division and its site without any page or whole-site capability', async () => {
  const result = await db.asUser(staff, async c => ({
    scopes: (await c.query('SELECT app.current_division_scopes() AS scopes')).rows[0]!.scopes,
    sites: (await c.query('SELECT id FROM sites')).rows,
    pages: (await c.query('SELECT id FROM pages')).rows,
    whole: (await c.query('SELECT app.has_site_access($1) AS allowed', [s.siteA])).rows[0]!.allowed,
  }))
  expect(result.scopes).toEqual({ [division]: { siteId: s.siteA, name: 'Example division (sample)' } })
  expect(result.sites).toEqual([{ id: s.siteA }])
  expect(result.pages).toEqual([])
  expect(result.whole).toBe(false)
  await expectSqlState(
    db.asUser(staff, c => c.query("SELECT app.create_page($1,'arbitrary','[Page]')", [s.siteA])),
    'CMS02',
  )
})
it('creates a private chapter page only in the assigned division and validates page bindings and addresses', async () => {
  chapter = (
    await db.asUser(staff, c =>
      c.query("SELECT app.create_division_chapter($1,'new-chapter',$2) AS id", [division, config]),
    )
  ).rows[0]!.id
  const head = (
    await db.asUser(staff, c =>
      c.query(
        'SELECT c.revision,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.id=$1',
        [chapter],
      ),
    )
  ).rows[0]!
  page = head.config.pageId
  expect(head.config).toEqual({ ...config, pageId: page })
  expect(page).toBeTypeOf('string')
  expect(
    (await db.asUser(staff, c => c.query('SELECT slug,published_version_id FROM pages WHERE id=$1', [page]))).rows,
  ).toEqual([{ slug: 'chapters/new-chapter', published_version_id: null }])
  expect((await db.asUser(s.contributorA, c => c.query('SELECT id FROM chapter_divisions'))).rows).toEqual([])
  await expectSqlState(
    db.asUser(s.editorB, c => c.query("SELECT app.create_division_chapter($1,'foreign',$2)", [division, config])),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(staff, c =>
      c.query("SELECT app.create_division_chapter($1,'rebound',$2)", [division, { ...config, pageId: s.pageA }]),
    ),
    'CMS04',
  )
  await expectSqlState(
    db.asUser(staff, c => c.query("SELECT app.create_division_chapter($1,'../invalid',$2)", [division, config])),
    'CMS04',
  )
  await expectSqlState(
    db.asUser(staff, c =>
      c.query("SELECT app.create_division_chapter($1,'invalid',$2)", [division, { ...config, contact: {} }]),
    ),
    'CMS04',
  )
  const external = (
    await db.asUser(staff, c =>
      c.query("SELECT app.create_division_chapter($1,'external-new',$2) AS id", [
        division,
        { ...config, destination: 'external', externalUrl: 'https://example.test/chapter' },
      ]),
    )
  ).rows[0]!.id
  expect(
    (
      await db.asUser(staff, c =>
        c.query('SELECT v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.id=$1', [
          external,
        ]),
      )
    ).rows[0]!.config.pageId,
  ).toBeNull()
  expect((await db.asUser(staff, c => c.query('SELECT id FROM pages'))).rows).toEqual([{ id: page }])
  await expectSqlState(
    db.asUser(staff, c => c.query('SELECT app.create_chapter_page($1,NULL)', [external])),
    'CMS01',
  )
  const attached = (await db.asUser(staff, c => c.query('SELECT app.create_chapter_page($1,1) AS id', [external])))
    .rows[0]!.id
  expect(attached).not.toBe(page)
  expect(
    (await db.asUser(staff, c => c.query('SELECT app.create_chapter_page($1,2) AS id', [external]))).rows[0]!.id,
  ).toBe(attached)
  await expectSqlState(
    db.asUser(s.editorB, c => c.query('SELECT app.create_chapter_page($1,2)', [external])),
    'CMS02',
  )
})
it('keeps division reassignment with site administrators, including national-only routing', async () => {
  await expectSqlState(
    db.asUser(staff, c => c.query('SELECT app.assign_chapter_division($1,NULL)', [chapter])),
    'CMS02',
  )
  await db.asUser(s.superAdmin, c => c.query('SELECT app.assign_chapter_division($1,NULL)', [chapter]))
  expect((await db.asUser(staff, c => c.query('SELECT id FROM pages WHERE id=$1', [page]))).rows).toEqual([])
  await db.asUser(s.superAdmin, c => c.query('SELECT app.assign_chapter_division($1,$2)', [chapter, division]))
  expect((await db.asUser(staff, c => c.query('SELECT id FROM pages WHERE id=$1', [page]))).rows).toEqual([
    { id: page },
  ])
})
it('uses revision-checked defaults without changing existing chapters or exposing private settings to public roles', async () => {
  const first = (
    await db.asUser(s.superAdmin, c =>
      c.query("SELECT app.save_chapter_defaults($1,0,'chapter-editors') AS revision", [s.siteA]),
    )
  ).rows[0]!.revision
  expect(first).toBe('1')
  expect((await db.asUser(staff, c => c.query('SELECT default_update_mode FROM chapter_site_settings'))).rows).toEqual([
    { default_update_mode: 'chapter-editors' },
  ])
  expect(
    (await db.asUser(staff, c => c.query('SELECT config FROM chapter_versions WHERE chapter_id=$1', [chapter])))
      .rows[0]!.config.updateMode,
  ).toBe('division')
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query("SELECT app.save_chapter_defaults($1,0,'division')", [s.siteA])),
    'CMS01',
  )
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query("SELECT app.save_chapter_defaults($1,NULL,'division')", [s.siteA])),
    'CMS01',
  )
  await expectSqlState(
    db.asUser(staff, c => c.query("SELECT app.save_chapter_defaults($1,1,'division')", [s.siteA])),
    'CMS02',
  )
  for (const role of ['public', 'worker'] as const)
    await expectSqlState(
      db.as(role, c => c.query('SELECT * FROM public.chapter_site_settings')),
      '42501',
    )
})
it('lets site administrators manage division staff without renaming accounts or widening their role', async () => {
  await db.asUser(s.superAdmin, c =>
    c.query("SELECT app.set_chapter_division_staff($1,'division-new@example.test','[Different name]',true)", [
      division,
    ]),
  )
  const teams = (await db.asUser(s.superAdmin, c => c.query('SELECT app.chapter_team_feed($1) AS teams', [s.siteA])))
    .rows[0]!.teams
  expect(teams).toEqual([
    {
      id: division,
      name: 'Example division (sample)',
      people: [{ id: staff, name: 'Division staff (sample)', email: 'division-new@example.test', active: true }],
    },
  ])
  await expectSqlState(
    db.asUser(staff, c => c.query('SELECT app.chapter_team_feed($1)', [s.siteA])),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(staff, c =>
      c.query("SELECT app.set_chapter_division_staff($1,'other@example.test','[Name]',true)", [division]),
    ),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(staff, c => c.query("UPDATE chapter_site_settings SET default_update_mode='division'")),
    '42501',
  )
  await db.asUser(s.superAdmin, c =>
    c.query("SELECT app.set_chapter_division_staff($1,'division-new@example.test','[Name]',false)", [division]),
  )
  expect(
    (await db.asUser(staff, c => c.query('SELECT app.current_division_scopes() AS scopes'))).rows[0]!.scopes,
  ).toEqual({})
  expect((await db.asUser(staff, c => c.query('SELECT id FROM sites'))).rows).toEqual([])
  await expectSqlState(
    db.asUser(staff, c => c.query("SELECT app.create_division_chapter($1,'removed',$2)", [division, config])),
    'CMS02',
  )
})
it('reapplies without changing assignments, chapter drafts or settings', async () => {
  const sql = await readFile(new URL('../migrations/0152_chapter_team_setup.sql', import.meta.url), 'utf8')
  await db.as('owner', async c => {
    const read = async () => ({
      settings: (await c.query('SELECT * FROM public.chapter_site_settings')).rows,
      chapters: (await c.query('SELECT * FROM chapters ORDER BY id')).rows,
    })
    const before = await read()
    await c.query(sql)
    await c.query(sql)
    expect(await read()).toEqual(before)
  })
})
