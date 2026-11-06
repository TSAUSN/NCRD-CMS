import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { ensureEchelonSite } from '../src/lib/echelon-site.ts'
import { ensureChapterDemoPages, chapterRows } from '../src/lib/chapters.ts'
let db: TestDatabase,
  s: Scenario,
  volunteer: string,
  staff: string,
  chapter: string,
  page: string,
  division: string,
  site: string
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import { listPeople } from '../src/lib/people.ts'
beforeAll(async () => {
  db = await TestDatabase.create('people_scopes')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    site = (await ensureEchelonSite(c, randomUUID())).siteId
    await ensureChapterDemoPages(c, site)
    const row = (await chapterRows(c, site)).find(row => row.slug === 'peoria')!
    chapter = row.id
    page = row.config.pageId!
    volunteer = (
      await c.query("SELECT app.provision_user('people-chapter@example.test','Chapter volunteer (sample)') AS id")
    ).rows[0]!.id
    staff = (await c.query("SELECT app.provision_user('people-division@example.test','Division staff (sample)') AS id"))
      .rows[0]!.id
    division = (await c.query("SELECT app.create_chapter_division($1,'Example division (sample)') AS id", [site]))
      .rows[0]!.id
    await c.query('SELECT app.assign_chapter_editor($1,$2,true)', [chapter, volunteer])
    await c.query('SELECT app.set_chapter_division_member($1,$2,true)', [division, staff])
    await c.query('SELECT app.assign_chapter_division($1,$2)', [chapter, division])
  })
})
afterAll(async () => {
  await db?.close()
})
it('shows separate chapter and division assignments only to a super admin, never as whole-site memberships', async () => {
  const rows = await listPeople(s.superAdmin),
    person = rows.find(row => row.id === volunteer)!,
    editor = rows.find(row => row.id === staff)!
  expect(person.memberships).toEqual([])
  expect(person.pageAssignments).toEqual([
    { siteId: site, chapterId: chapter, pageId: page, title: 'Peoria Chapter', enabled: true },
  ])
  expect(person.divisionAssignments).toEqual([])
  expect(editor.memberships).toEqual([])
  expect(editor.divisionAssignments).toEqual([
    { siteId: site, divisionId: division, name: 'Example division (sample)' },
  ])
  expect(await listPeople(volunteer)).toEqual([])
  expect(await listPeople(staff)).toEqual([])
  expect(await listPeople(s.editorA)).toEqual([])
})
it('keeps scoped assignments when updating account details and reports paused chapter access without widening it', async () => {
  const before = (await listPeople(s.superAdmin)).find(row => row.id === volunteer)!
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.update_person($1,$2,$3,$4,$5)', [
      volunteer,
      before.revision,
      'Updated volunteer (sample)',
      'active',
      '[]',
    ]),
  )
  let person = (await listPeople(s.superAdmin)).find(row => row.id === volunteer)!
  expect(person.pageAssignments).toEqual(before.pageAssignments)
  expect(person.memberships).toEqual([])
  await db.asUser(s.superAdmin, async c => {
    const row = (await chapterRows(c, site)).find(row => row.id === chapter)!
    await c.query('SELECT app.save_chapter_setup($1,$2,$3,$4,$5)', [
      site,
      row.id,
      row.revision,
      row.slug,
      JSON.stringify({ ...row.config, updateMode: 'division' }),
    ])
  })
  person = (await listPeople(s.superAdmin)).find(row => row.id === volunteer)!
  expect(person.pageAssignments).toEqual([{ ...before.pageAssignments[0], enabled: false }])
  expect(person.memberships).toEqual([])
  expect(
    (await db.asUser(volunteer, c => c.query('SELECT app.has_page_access($1) AS allowed', [page]))).rows[0]!.allowed,
  ).toBe(false)
  expect((await listPeople(s.superAdmin)).find(row => row.id === staff)!.divisionAssignments).toHaveLength(1)
})
