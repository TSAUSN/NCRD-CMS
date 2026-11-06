import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { recordLocalChapterMail } from '../src/chapter-mail.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('worker_chapter_mail')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await c.query('SELECT app.enable_chapters($1)', [s.siteA])
    await c.query('SELECT app.save_chapter_check_settings($1,0,false,true)', [s.siteA])
    await c.query("SELECT * FROM app.save_chapter_setup($1,NULL,0,'example',$2)", [
      s.siteA,
      {
        name: '[Chapter]',
        destination: 'page',
        pageId: s.pageA,
        externalUrl: null,
        updateMode: 'chapter-editors',
        contact: { name: '[Name]', role: '[Role]', email: 'chapter@example.test' },
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
      },
    ])
    await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId), '{}'])
  })
  await db.asUser(s.contributorA, c =>
    c.query("SELECT * FROM app.submit_page_for_review($1,1,'[Review note]')", [s.pageA]),
  )
})
afterAll(async () => {
  await db?.close()
})
it('records a pending review through the real worker session without reading private mail or sending it', async () => {
  const env = {
    AUTH_PROVIDER: 'local',
    CMS_LOCAL_TEST_MODE: 'true',
    MAILER_PROVIDER: 'recording',
    ADMIN_ORIGIN: 'http://localhost:3000',
    DATABASE_URL_WORKER: 'postgres://test@127.0.0.1:54329/cms_test',
  }
  expect(await recordLocalChapterMail(db.pool('worker'), 'local-chapter-mail', env)).toBe(1)
  expect(await recordLocalChapterMail(db.pool('worker'), 'local-chapter-mail', env)).toBe(0)
  const messages = (
    await db.asUser(s.superAdmin, c => c.query("SELECT kind,recipient FROM local_chapter_outbox WHERE kind='review'"))
  ).rows
  expect(messages).toEqual([{ kind: 'review', recipient: 'root@example.test' }])
  await expectSqlState(
    db.asWorker('local-chapter-mail', c => c.query('SELECT body FROM public.local_chapter_outbox')),
    '42501',
  )
  expect((await db.asUser(s.superAdmin, c => c.query('SELECT status FROM submissions'))).rows).toEqual([
    { status: 'open' },
  ])
})
