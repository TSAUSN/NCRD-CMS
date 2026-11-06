import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario, chapter: string, page: string, volunteer: string
const token = () => randomBytes(32).toString('base64url')
const origin = 'http://localhost:3000',
  email = 'chapter-invite@example.test'
const setup = (id: string) => ({
  name: '[Chapter]',
  destination: 'page',
  pageId: id,
  externalUrl: null,
  updateMode: 'chapter-editors',
  contact: { name: '[Name]', role: '[Role]', email: 'contact@example.test' },
  sections: {
    paragraph: true,
    social: false,
    socialFirst: false,
    events: false,
    board: false,
    photos: false,
    memberLogin: false,
  },
  boardDisplay: 'all',
})
const revision = async () =>
  (await db.asUser(s.superAdmin, c => c.query('SELECT revision FROM chapters WHERE id=$1', [chapter]))).rows[0]!
    .revision as string
const queue = (value: string) =>
  db.as('authenticated', c => c.query('SELECT app.queue_local_chapter_sign_in($1,$2,$3)', [email, value, origin]))
const consume = (value: string) =>
  db.as('authenticated', c => c.query('SELECT * FROM app.consume_local_chapter_sign_in($1)', [value]))
beforeAll(async () => {
  db = await TestDatabase.create('chapter_invites')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    page = (await c.query("SELECT app.create_page($1,'chapters/example','[Chapter]') AS id", [s.siteA])).rows[0]!.id
    chapter = (await c.query("SELECT * FROM app.save_chapter_setup($1,NULL,0,'example',$2)", [s.siteA, setup(page)]))
      .rows[0]!.chapter_id
    const division = (
      await c.query("SELECT app.create_chapter_division($1,'Example division (sample)') AS id", [s.siteA])
    ).rows[0]!.id
    await c.query('SELECT app.set_chapter_division_member($1,$2,true)', [division, s.editorB])
    await c.query('SELECT app.assign_chapter_division($1,$2)', [chapter, division])
    await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [page, heroContent(s.heroDefId), '{}'])
  })
})
afterAll(async () => {
  await db?.close()
})
it('lets an assigned division invite one page without granting whole-site access or editing an existing identity', async () => {
  volunteer = await db.asUser(
    s.editorB,
    async c =>
      (
        await c.query('SELECT app.invite_chapter_editor($1,$2,$3,$4)', [
          chapter,
          await revision(),
          email,
          'Volunteer (sample)',
        ])
      ).rows[0]!.invite_chapter_editor,
  )
  const access = await db.asUser(volunteer, async c => ({
    pages: (await c.query('SELECT id FROM pages')).rows,
    role: (await c.query('SELECT app.site_role($1) AS role', [s.siteA])).rows[0]!.role,
    mail: (await c.query('SELECT id FROM local_chapter_outbox')).rows,
  }))
  expect(
    (await db.as('authenticated', c => c.query('SELECT app.is_invited_email($1) AS invited', [email]))).rows[0]!
      .invited,
  ).toBe(true)
  expect(access.pages).toEqual([{ id: page }])
  expect(access.role).toBeNull()
  expect(access.mail).toEqual([])
  await db.asUser(s.editorB, async c =>
    c.query('SELECT app.invite_chapter_editor($1,$2,$3,$4)', [
      chapter,
      await revision(),
      'CHAPTER-INVITE@example.test',
      '[Changed global name]',
    ]),
  )
  const people = (await db.asUser(s.editorB, c => c.query('SELECT * FROM app.chapter_editor_feed($1)', [chapter]))).rows
  expect(people).toEqual([{ id: volunteer, name: 'Volunteer (sample)', email, enabled: true }])
})
let revisionValue: string
it('refuses stale invitations, foreign teams, direct identity writes and page reassignment', async () => {
  revisionValue = await revision()
  await expectSqlState(
    db.asUser(s.editorB, c => c.query("SELECT app.invite_chapter_editor($1,NULL,$2,'[Name]')", [chapter, email])),
    'CMS01',
  )
  await expectSqlState(
    db.asUser(s.contributorA, c =>
      c.query("SELECT app.invite_chapter_editor($1,$2,$3,'[Name]')", [chapter, revisionValue, email]),
    ),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(s.editorB, c => c.query("SELECT app.provision_user('someone@example.test','[Name]')")),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(s.editorB, c => c.query('UPDATE app_users SET display_name=$1 WHERE id=$2', ['Changed', volunteer])),
    '42501',
  )
  await expectSqlState(
    db.asUser(s.editorB, c =>
      c.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
        s.siteA,
        chapter,
        revisionValue,
        'example',
        setup(s.pageA),
      ]),
    ),
    'CMS02',
  )
  await db.asUser(s.editorB, c =>
    c.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
      s.siteA,
      chapter,
      revisionValue,
      'example',
      { ...setup(page), contact: { name: '[New contact]', role: '[Role]', email: 'new-contact@example.test' } },
    ]),
  )
})
it('records a self-hosted sign-in link privately, stores only a digest in the capability table and consumes it once', async () => {
  expect(
    (await db.as('authenticated', c => c.query('SELECT app.is_scoped_chapter_email($1) AS value', [email]))).rows[0]!
      .value,
  ).toBe(true)
  const value = token()
  await queue(value)
  expect(
    (await db.asUser(s.editorB, c => c.query('SELECT kind,recipient,subject,link FROM local_chapter_outbox'))).rows,
  ).toMatchObject([
    {
      kind: 'sign-in',
      recipient: email,
      subject: 'Sign in to edit [Chapter]',
      link: origin + '/auth/local-chapter?code=' + value,
    },
  ])
  expect((await db.asUser(s.editorA, c => c.query('SELECT id FROM local_chapter_outbox'))).rows).toEqual([])
  expect(
    (await db.asUser(volunteer, c => c.query('SELECT app.local_chapter_mail_feed($1) AS items', [s.siteA]))).rows[0]!
      .items,
  ).toEqual([])
  await expectSqlState(
    db.asUser(volunteer, c => c.query('SELECT * FROM app.chapter_editor_feed($1)', [chapter])),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(volunteer, c => c.query('SELECT digest FROM local_chapter_sign_in_links')),
    '42501',
  )
  const saved = (await db.as('owner', c => c.query('SELECT digest FROM local_chapter_sign_in_links'))).rows[0]!.digest
  expect(saved).toMatch(/^[a-f0-9]{64}$/)
  expect(saved).not.toBe(value)
  expect((await consume(token())).rows).toEqual([])
  const racing = await Promise.all([consume(value), consume(value)])
  expect(racing.flatMap(result => result.rows)).toEqual([{ user_id: volunteer, email, page_id: page }])
  expect((await consume(value)).rows).toEqual([])
})
it('refuses expired, replaced and revoked links and never exposes sign-in commands to the public or worker', async () => {
  const old = token(),
    next = token()
  await queue(old)
  await queue(next)
  expect((await consume(old)).rows).toEqual([])
  await db.as('owner', c =>
    c.query("UPDATE local_chapter_sign_in_links SET expires_at=now()-interval '1 second' WHERE used_at IS NULL"),
  )
  expect((await consume(next)).rows).toEqual([])
  const revoked = token()
  await queue(revoked)
  await db.asUser(s.superAdmin, c => c.query('SELECT app.assign_chapter_editor($1,$2,false)', [chapter, volunteer]))
  expect((await consume(revoked)).rows).toEqual([])
  for (const role of ['public', 'worker'] as const) {
    await expectSqlState(
      db.as(role, c => c.query('SELECT * FROM app.consume_local_chapter_sign_in($1)', [revoked])),
      '42501',
    )
    await expectSqlState(
      db.as(role, c => c.query('SELECT app.queue_local_chapter_sign_in($1,$2,$3)', [email, token(), origin])),
      '42501',
    )
  }
  await expectSqlState(
    db.as('authenticated', c =>
      c.query('SELECT app.queue_local_chapter_sign_in($1,$2,$3)', [email, token(), 'https://example.test']),
    ),
    'CMS04',
  )
})
it('reapplies without changing outbox rows or function authority', async () => {
  const sql = await readFile(new URL('../migrations/0151_local_chapter_invitations.sql', import.meta.url), 'utf8')
  await db.as('owner', async c => {
    const before = (await c.query('SELECT id,dedupe_key FROM local_chapter_outbox ORDER BY id')).rows
    await c.query(sql)
    await c.query(sql)
    expect((await c.query('SELECT id,dedupe_key FROM local_chapter_outbox ORDER BY id')).rows).toEqual(before)
  })
})
