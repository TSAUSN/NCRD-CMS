import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario, chapter: string, division: string, submission: string, originalLive: string | null
const origin = 'http://localhost:3000'
const config = (name: string, email: string, mode = 'division', pageId: string | null = null) => ({
  name,
  destination: pageId ? 'page' : 'external',
  pageId,
  externalUrl: pageId ? null : 'https://example.test/chapter',
  updateMode: mode,
  contact: { name: '[Name]', role: '[Role]', email },
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
const record = (cycle: string) =>
  db.asUser(s.superAdmin, c => c.query('SELECT app.record_chapter_check($1,$2,$3) AS count', [s.siteA, cycle, origin]))
const due = (clock: string) =>
  db.asWorker('local-mail', c => c.query('SELECT app.record_due_local_chapter_mail($1,$2) AS count', [origin, clock]))
beforeAll(async () => {
  db = await TestDatabase.create('chapter_checks')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await c.query('SELECT app.enable_chapters($1)', [s.siteA])
    division = (await c.query("SELECT app.create_chapter_division($1,'Example division (sample)') AS id", [s.siteA]))
      .rows[0]!.id
    await c.query('SELECT app.set_chapter_division_member($1,$2,true)', [division, s.editorB])
    chapter = (
      await c.query("SELECT * FROM app.save_chapter_setup($1,NULL,0,'first',$2)", [
        s.siteA,
        config('[First chapter]', 'shared@example.test', 'chapter-editors', s.pageA),
      ])
    ).rows[0]!.chapter_id
    await c.query('SELECT app.assign_chapter_division($1,$2)', [chapter, division])
    await c.query("SELECT * FROM app.save_chapter_setup($1,NULL,0,'second',$2)", [
      s.siteA,
      config('[Second chapter]', 'shared@example.test'),
    ])
    await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId), '{}'])
    const third = (
      await c.query("SELECT * FROM app.save_chapter_setup($1,NULL,0,'third',$2)", [
        s.siteA,
        config('[Third chapter]', 'unique@example.test'),
      ])
    ).rows[0]!.chapter_id
    await c.query('SELECT app.assign_chapter_division($1,$2)', [third, division])
  })
})
afterAll(async () => {
  await db?.close()
})
it('records one January email per contact, combining mixed update modes, with deduplication per cycle', async () => {
  expect((await record('2027-01-01')).rows[0]!.count).toBe(2)
  expect((await record('2027-01-01')).rows[0]!.count).toBe(0)
  const mail = (
    await db.asUser(s.superAdmin, c =>
      c.query(
        "SELECT recipient,subject,body,related_chapters FROM local_chapter_outbox WHERE kind='check' ORDER BY recipient",
      ),
    )
  ).rows
  expect(mail).toHaveLength(2)
  expect(mail[0]!.recipient).toBe('shared@example.test')
  expect(mail[0]!.related_chapters).toHaveLength(2)
  expect(mail[0]!.body).toContain('please take a few minutes to check your chapter page')
  expect(mail[0]!.body).toContain('Check my page: ' + origin + '/pages/' + s.pageA)
  expect(mail[0]!.body).toContain('in one email to the [Division] web team by January 31')
  expect(mail[0]!.body).toContain('Nothing to change? Just reply “all good”.')
  expect(mail[1]!.body).toContain('Example division (sample) web team')
  expect(mail[1]!.subject).toBe('January chapter page check')
  expect((await record('2027-07-01')).rows[0]!.count).toBe(2)
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query("SELECT body FROM local_chapter_outbox WHERE subject='July chapter page check'"),
      )
    ).rows.every(row => row.body.includes('July 31')),
  ).toBe(true)
})
it('does not disclose a combined contact message to a team lacking access to every chapter in it', async () => {
  const visible = (await db.asUser(s.editorB, c => c.query('SELECT recipient FROM local_chapter_outbox'))).rows
  expect(visible).toEqual([{ recipient: 'unique@example.test' }, { recipient: 'unique@example.test' }])
  const feed = (
    await db.asUser(s.editorB, c => c.query('SELECT app.local_chapter_mail_feed($1) AS messages', [s.siteA]))
  ).rows[0]!.messages
  expect(feed).toHaveLength(2)
  expect(
    feed.every(
      (mail: { recipient: string; expired: boolean }) =>
        mail.recipient === 'unique@example.test' && mail.expired === false,
    ),
  ).toBe(true)
  expect(
    (await db.asUser(s.contributorA, c => c.query('SELECT app.local_chapter_mail_feed($1) AS messages', [s.siteA])))
      .rows[0]!.messages,
  ).toEqual([])
  await expectSqlState(
    db.asUser(s.editorB, c => c.query('SELECT app.record_chapter_check($1,$2,$3)', [s.siteA, '2028-01-01', origin])),
    'CMS02',
  )
  await expectSqlState(
    db.as('worker', c => c.query('SELECT * FROM public.local_chapter_outbox')),
    '42501',
  )
})
it('uses five New York working days, preserving the clock across a weekend and daylight saving change', async () => {
  const result = await db.as('owner', c =>
    c.query(
      "SELECT app.chapter_review_due_at('2026-10-16T14:00:00Z') AS ordinary,app.chapter_review_due_at('2026-10-30T14:00:00Z') AS dst",
    ),
  )
  expect(result.rows[0]!.ordinary.toISOString()).toBe('2026-10-23T14:00:00.000Z')
  expect(result.rows[0]!.dst.toISOString()).toBe('2026-11-06T15:00:00.000Z')
})
it('routes review messages to the division, then reminds it and the national backup once after five working days', async () => {
  const head = (
    await db.asUser(s.contributorA, c =>
      c.query('SELECT revision,published_version_id FROM pages WHERE id=$1', [s.pageA]),
    )
  ).rows[0]!
  originalLive = head.published_version_id
  submission = (
    await db.asUser(s.contributorA, c =>
      c.query("SELECT * FROM app.submit_page_for_review($1,$2,'[Review note]')", [s.pageA, head.revision]),
    )
  ).rows[0]!.submission_id
  await db.as('owner', c =>
    c.query("UPDATE submissions SET created_at='2026-10-16T14:00:00Z' WHERE id=$1", [submission]),
  )
  expect((await due('2026-10-16T15:00:00Z')).rows[0]!.count).toBe(1)
  expect((await due('2026-10-23T13:59:59Z')).rows[0]!.count).toBe(0)
  expect((await due('2026-10-23T14:00:00Z')).rows[0]!.count).toBe(2)
  expect((await due('2026-10-24T14:00:00Z')).rows[0]!.count).toBe(0)
  const mail = (
    await db.asUser(s.superAdmin, c =>
      c.query(
        "SELECT kind,recipient,body FROM local_chapter_outbox WHERE kind IN('review','reminder') ORDER BY kind,recipient",
      ),
    )
  ).rows
  expect(mail.map(row => [row.kind, row.recipient])).toEqual([
    ['reminder', 'editor-b@example.test'],
    ['reminder', 'root@example.test'],
    ['review', 'editor-b@example.test'],
  ])
  expect(mail[0]!.body).toContain('Nothing is published automatically.')
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT status,published_version_id FROM pages WHERE id=$1', [s.pageA]),
      )
    ).rows[0]!.published_version_id,
  ).toBe(originalLive)
  expect(
    (await db.asUser(s.superAdmin, c => c.query('SELECT status FROM submissions WHERE id=$1', [submission]))).rows[0]!
      .status,
  ).toBe('open')
})
it('honors disabled checks, preserves the update-mode default and refuses stale settings or unprivileged internal calls', async () => {
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT app.save_chapter_check_settings($1,0,false,false) AS revision', [s.siteA]),
      )
    ).rows[0]!.revision,
  ).toBe('1')
  expect((await record('2028-01-01')).rows[0]!.count).toBe(0)
  expect(
    (
      await db.asUser(s.superAdmin, c =>
        c.query('SELECT default_update_mode FROM chapter_site_settings WHERE site_id=$1', [s.siteA]),
      )
    ).rows[0]!.default_update_mode,
  ).toBe('division')
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('SELECT app.save_chapter_check_settings($1,0,true,true)', [s.siteA])),
    'CMS01',
  )
  await expectSqlState(
    db.asUser(s.contributorA, c => c.query('SELECT app.save_chapter_check_settings($1,1,true,true)', [s.siteA])),
    'CMS02',
  )
  for (const role of ['authenticated', 'public', 'worker'] as const)
    await expectSqlState(
      db.as(role, c => c.query('SELECT app.record_chapter_checks_internal($1,$2,$3)', [s.siteA, '2028-01-01', origin])),
      '42501',
    )
  await expectSqlState(
    db.as('authenticated', c => c.query('SELECT app.record_due_local_chapter_mail($1)', [origin])),
    '42501',
  )
  await expectSqlState(
    db.as('worker', c => c.query('SELECT app.record_due_local_chapter_mail($1)', [origin])),
    'CMS02',
  )
  await expectSqlState(record('2027-02-01'), 'CMS04')
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query('SELECT app.record_chapter_check($1,$2,$3)', [s.siteA, '2028-01-01', 'https://example.test']),
    ),
    'CMS04',
  )
})
it('reapplies idempotently without changing recorded messages or chapter drafts', async () => {
  const sql = await readFile(new URL('../migrations/0153_local_chapter_checks.sql', import.meta.url), 'utf8')
  await db.as('owner', async c => {
    const before = (await c.query('SELECT id,body FROM local_chapter_outbox ORDER BY id')).rows
    await c.query(sql)
    await c.query(sql)
    expect((await c.query('SELECT id,body FROM local_chapter_outbox ORDER BY id')).rows).toEqual(before)
  })
})
