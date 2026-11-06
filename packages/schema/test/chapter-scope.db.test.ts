import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState, CHECKED_CLEAN } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let db: TestDatabase,
  s: Scenario,
  division: string,
  otherDivision: string,
  staff: string,
  volunteer: string,
  otherVolunteer: string,
  page: string,
  otherPage: string,
  chapter: string,
  otherChapter: string
const config = (name: string, pageId: string) => ({
  name,
  destination: 'page',
  pageId,
  externalUrl: null,
  updateMode: 'chapter-editors',
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
})
beforeAll(async () => {
  db = await TestDatabase.create('chapter_scope')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    const user = async (email: string) =>
      (await c.query('SELECT app.provision_user($1,$2) AS id', [email, '[Name]'])).rows[0]!.id as string
    staff = await user('division@example.test')
    volunteer = await user('volunteer@example.test')
    otherVolunteer = await user('another@example.test')
    division = (
      await c.query('SELECT app.create_chapter_division($1,$2) AS id', [s.siteA, 'Example division (sample)'])
    ).rows[0]!.id
    otherDivision = (
      await c.query('SELECT app.create_chapter_division($1,$2) AS id', [s.siteA, 'Another division (sample)'])
    ).rows[0]!.id
    await c.query('SELECT app.set_chapter_division_member($1,$2,true)', [division, staff])
    for (const name of ['one', 'two']) {
      const id = (
        await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'chapters/' + name, '[Chapter ' + name + ']'])
      ).rows[0]!.id as string
      const ch = (
        await c.query('SELECT * FROM app.save_chapter_setup($1,NULL,0,$2,$3)', [
          s.siteA,
          name,
          config('[Chapter ' + name + ']', id),
        ])
      ).rows[0]!.chapter_id as string
      await c.query('SELECT app.assign_chapter_division($1,$2)', [ch, name === 'one' ? division : otherDivision])
      const source = JSON.parse(heroContent(s.heroDefId)) as { values: Record<string, string> }[]
      const content = ['what', 'events', 'join'].map(part => ({
        ...source[0],
        values: { ...source[0]!.values, __cms_chapter_part: part },
      }))
      await c.query("SELECT * FROM app.save_page_draft($1,0,$2,'{}','checkpoint','Chapter example')", [
        id,
        JSON.stringify(content),
      ])
      await c.query('SELECT app.assign_chapter_editor($1,$2,true)', [ch, name === 'one' ? volunteer : otherVolunteer])
      if (name === 'one') {
        page = id
        chapter = ch
      } else {
        otherPage = id
        otherChapter = ch
      }
    }
  })
})
afterAll(async () => {
  await db?.close()
})
const head = async (user: string, id = page) =>
  (
    await db.asUser(user, c =>
      c.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [id],
      ),
    )
  ).rows[0]!
const save = (user: string, id: string, revision: string, content: unknown) =>
  db.asUser(user, c =>
    c.query("SELECT * FROM app.save_page_draft($1,$2,$3,'{}','checkpoint','Updated chapter')", [
      id,
      revision,
      JSON.stringify(content),
    ]),
  )
it('shows only assigned pages, versions and scopes, without whole-site rights or private contacts', async () => {
  for (const user of [volunteer, staff]) {
    const rows = await db.asUser(user, async c => ({
      pages: (await c.query('SELECT id FROM pages')).rows,
      versions: (await c.query('SELECT DISTINCT page_id FROM page_versions')).rows,
      scope: (await c.query('SELECT app.current_page_scopes() AS scope')).rows[0]!.scope,
      site: (await c.query('SELECT app.has_site_access($1) AS allowed', [s.siteA])).rows[0]!.allowed,
      divisions: (await c.query('SELECT id FROM chapter_divisions')).rows,
    }))
    expect(rows.pages).toEqual([{ id: page }])
    expect(rows.versions).toEqual([{ page_id: page }])
    expect(rows.scope).toEqual({ [page]: { siteId: s.siteA, role: user === staff ? 'editor' : 'contributor' } })
    expect(rows.site).toBe(false)
    expect(rows.divisions).toEqual(user === staff ? [{ id: division }] : [])
  }
  expect((await db.asUser(volunteer, c => c.query('SELECT * FROM chapters'))).rows).toEqual([])
  expect((await db.asUser(volunteer, c => c.query('SELECT * FROM chapter_versions'))).rows).toEqual([])
  expect((await db.asUser(staff, c => c.query('SELECT id FROM chapters'))).rows).toEqual([{ id: chapter }])
  await expectSqlState(
    db.asUser(volunteer, c => c.query('SELECT * FROM app.save_theme_draft($1,1,$2)', [s.siteA, '{}'])),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(volunteer, c => c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, 'forbidden', 'Forbidden'])),
    'CMS02',
  )
})
it('allows chapter edits and refuses stale or foreign saves without changing another page', async () => {
  const current = await head(volunteer),
    foreign = await head(s.superAdmin, otherPage)
  const content = structuredClone(current.content)
  content[1].values.heading = '[Changed event]'
  content[1].hidden = true
  await save(volunteer, page, current.revision, content)
  const setup = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.id=$1', [
        chapter,
      ]),
    )
  ).rows[0]!.config
  expect(setup.sections.events).toBe(false)
  expect(setup.contact).toEqual(config('[Chapter one]', page).contact)
  expect(setup.destination).toBe('page')
  expect(setup.updateMode).toBe('chapter-editors')
  await expectSqlState(save(volunteer, page, current.revision, content), 'CMS01')
  await expectSqlState(save(volunteer, otherPage, foreign.revision, content), 'CMS02')
  expect(await head(s.superAdmin, otherPage)).toEqual(foreign)
})
it('enforces shared content locks for edit, hide, move, remove, duplicate, replace and restore', async () => {
  const current = await head(volunteer),
    mutations = [
      (items: any[]) => {
        items[0].values.heading = 'Changed shared heading'
      },
      (items: any[]) => {
        items[0].hidden = true
      },
      (items: any[]) => {
        ;[items[0], items[1]] = [items[1], items[0]]
      },
      (items: any[]) => {
        items.splice(0, 1)
      },
      (items: any[]) => {
        items.push(structuredClone(items[0]))
      },
      (items: any[]) => {
        items[0].section_def_version = 2
      },
    ]
  for (const mutate of mutations) {
    const content = structuredClone(current.content)
    mutate(content)
    await expectSqlState(save(volunteer, page, current.revision, content), 'CMS02')
  }
  expect(await head(volunteer)).toEqual(current)
  const updated = structuredClone(current.content)
  updated[0].values.heading = '[Updated shared heading]'
  await save(s.superAdmin, page, current.revision, updated)
  const after = await head(volunteer)
  const old = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT id FROM page_versions WHERE page_id=$1 ORDER BY revision LIMIT 1', [page]),
    )
  ).rows[0]!.id
  await expectSqlState(
    db.asUser(volunteer, c =>
      c.query("SELECT * FROM app.restore_version_as_draft($1,$2,$3,'Restore')", [page, after.revision, old]),
    ),
    'CMS02',
  )
  // A site editor may deliberately replace a shared part. The canonical guard
  // follows that change, rather than leaving every later volunteer save blocked.
  await save(s.superAdmin, page, after.revision, updated.slice(1))
  const replaced = await head(volunteer)
  const own = structuredClone(replaced.content)
  own[0].values.heading = '[Updated event]'
  await save(volunteer, page, replaced.revision, own)
  await save(s.superAdmin, page, (await head(s.superAdmin)).revision, updated)
})
it('routes a submission to its division and publishes only through an authorized reviewer', async () => {
  const current = await head(volunteer)
  const submitted = (
    await db.asUser(volunteer, c =>
      c.query("SELECT * FROM app.submit_page_for_review($1,$2,'Please review this chapter.')", [
        page,
        current.revision,
      ]),
    )
  ).rows[0]!
  expect((await db.asUser(staff, c => c.query('SELECT id FROM submissions'))).rows).toEqual([
    { id: submitted.submission_id },
  ])
  expect((await db.asUser(otherVolunteer, c => c.query('SELECT id FROM submissions'))).rows).toEqual([])
  const queue = await db.asUser(staff, c => c.query('SELECT * FROM app.review_queue(NULL,false,100,NULL,NULL)'))
  expect(
    (await db.asUser(staff, c => c.query("SELECT app.inbox_snapshot()->>'reviews' AS reviews"))).rows[0]!.reviews,
  ).toBe('1')
  expect(
    (await db.asUser(otherVolunteer, c => c.query("SELECT app.inbox_snapshot()->>'reviews' AS reviews"))).rows[0]!
      .reviews,
  ).toBe('0')
  expect(queue.rows).toHaveLength(1)
  expect(queue.rows[0]).toMatchObject({ submission_id: submitted.submission_id, can_review: true, can_approve: true })
  expect(
    (await db.asUser(otherVolunteer, c => c.query('SELECT * FROM app.review_queue(NULL,false,100,NULL,NULL)'))).rows,
  ).toEqual([])
  const comment = (
    await db.asUser(volunteer, c =>
      c.query("SELECT app.add_page_comment($1,$2,'[Review note]',$3) AS id", [
        page,
        submitted.version_id,
        JSON.stringify([staff]),
      ]),
    )
  ).rows[0]!.id
  expect(
    (await db.asUser(staff, c => c.query('SELECT * FROM app.review_comments($1)', [submitted.submission_id]))).rows[0],
  ).toMatchObject({ id: comment, body: '[Review note]', can_resolve: true })
  await expectSqlState(
    db.asUser(otherVolunteer, c => c.query('SELECT * FROM app.review_comments($1)', [submitted.submission_id])),
    'CMS03',
  )
  await db.asUser(staff, c => c.query('SELECT app.resolve_page_comment($1,true)', [comment]))
  await expectSqlState(
    db.asUser(volunteer, c =>
      c.query("SELECT app.add_page_comment($1,$2,'[Private note]',$3)", [
        page,
        submitted.version_id,
        JSON.stringify([otherVolunteer]),
      ]),
    ),
    'CMS04',
  )
  expect(
    (await db.asUser(volunteer, c => c.query('SELECT * FROM app.review_people($1)', [s.siteA]))).rows.map(
      person => person.id,
    ),
  ).toContain(staff)
  expect(
    (await db.asUser(volunteer, c => c.query('SELECT * FROM app.review_people($1)', [s.siteA]))).rows.map(
      person => person.id,
    ),
  ).not.toContain(otherVolunteer)
  await expectSqlState(
    db.asUser(volunteer, c =>
      c.query('SELECT * FROM app.approve_page_submission($1,$2,$3,$4)', [submitted.submission_id, ...CHECKED_CLEAN]),
    ),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(s.editorB, c =>
      c.query('SELECT * FROM app.approve_page_submission($1,$2,$3,$4)', [submitted.submission_id, ...CHECKED_CLEAN]),
    ),
    'CMS03',
  )
  const result = (
    await db.asUser(staff, c =>
      c.query('SELECT * FROM app.approve_page_submission($1,$2,$3,$4)', [submitted.submission_id, ...CHECKED_CLEAN]),
    )
  ).rows[0]!
  expect(result.published_version_id).toBe(submitted.version_id)
})
it('revokes access on team removal, mode changes and disabled accounts, with no direct write bypass', async () => {
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('SELECT app.assign_chapter_editor($1,$2,NULL)', [chapter, volunteer])),
    'CMS04',
  )
  await expectSqlState(
    db.asUser(volunteer, c => c.query('DELETE FROM chapter_shared_sections WHERE page_id=$1', [page])),
    '42501',
  )
  await expectSqlState(
    db.asUser(staff, c => c.query('SELECT app.assign_chapter_editor($1,$2,true)', [otherChapter, volunteer])),
    'CMS02',
  )
  await db.asUser(s.superAdmin, c => c.query('SELECT app.set_chapter_division_member($1,$2,false)', [division, staff]))
  expect((await db.asUser(staff, c => c.query('SELECT id FROM pages'))).rows).toEqual([])
  await db.asUser(s.superAdmin, async c => {
    const row = (
      await c.query(
        'SELECT c.revision,v.config FROM chapters c JOIN chapter_versions v ON v.id=c.draft_version_id WHERE c.id=$1',
        [chapter],
      )
    ).rows[0]!
    await c.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
      s.siteA,
      chapter,
      row.revision,
      'one',
      { ...row.config, updateMode: 'division' },
    ])
  })
  expect((await db.asUser(volunteer, c => c.query('SELECT id FROM pages'))).rows).toEqual([])
  await db.asUser(s.superAdmin, c => c.query('SELECT app.assign_chapter_editor($1,$2,false)', [chapter, volunteer]))
  await db.asUser(s.superAdmin, c => c.query("SELECT app.set_user_status($1,'disabled')", [otherVolunteer]))
  expect((await db.asUser(otherVolunteer, c => c.query('SELECT id FROM pages'))).rows).toEqual([])
})
it('reapplies idempotently without changing content, assignments or function grants', async () => {
  const sql = await readFile(new URL('../migrations/0150_chapter_page_scope.sql', import.meta.url), 'utf8')
  await db.as('owner', async c => {
    const before = (await c.query('SELECT * FROM chapter_shared_sections ORDER BY page_id,part')).rows
    const grants = (
      await c.query("SELECT proname,proacl::text FROM pg_proc WHERE pronamespace='app'::regnamespace ORDER BY oid")
    ).rows
    await c.query(sql)
    await c.query(sql)
    expect((await c.query('SELECT * FROM chapter_shared_sections ORDER BY page_id,part')).rows).toEqual(before)
    expect(
      (await c.query("SELECT proname,proacl::text FROM pg_proc WHERE pronamespace='app'::regnamespace ORDER BY oid"))
        .rows,
    ).toEqual(grants)
  })
})
