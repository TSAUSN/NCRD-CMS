import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario, id: string, host: string, otherPage: string
const save = (path: string, page = s.pageA, expected: string | null = '0', redirect: string | null = null) =>
  db.asUser(s.superAdmin, c =>
    c.query('SELECT app.save_site_redirect($1,$2,$3,$4,$5) AS id', [s.siteA, redirect, expected, path, page]),
  )
const resolve = (path: string, hostname = host) =>
  db.as('public', c => c.query('SELECT public_api.resolve_redirect($1,$2) AS target', [hostname, path]))
beforeAll(async () => {
  db = await TestDatabase.create('site_redirects')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    host = (await c.query('SELECT staging_hostname FROM sites WHERE id=$1', [s.siteA])).rows[0]!.staging_hostname
    otherPage = (await c.query("SELECT app.create_page($1,'other','[Other page]') AS id", [s.siteB])).rows[0]!.id
    await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId), '{}'])
  })
})
afterAll(async () => {
  await db?.close()
})
it('keeps draft destinations private, then resolves only the selected site’s published page', async () => {
  id = (await save('/Chapter/Peoria/')).rows[0]!.id
  expect((await resolve('/chapter/peoria')).rows[0]!.target).toBeNull()
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.publish_page($1,1,$2,$3,$4)', [s.pageA, ...CHECKED_CLEAN]),
  )
  expect((await resolve('/chapter/peoria')).rows[0]!.target).toBe('/')
  const otherHost = (
    await db.asUser(s.superAdmin, c => c.query('SELECT staging_hostname FROM sites WHERE id=$1', [s.siteB]))
  ).rows[0]!.staging_hostname
  expect((await resolve('/chapter/peoria', otherHost)).rows[0]!.target).toBeNull()
  expect((await resolve('/chapter/peoria', 'unknown.example.test')).rows[0]!.target).toBeNull()
})
it('rejects outside destinations, malformed sources, page conflicts, self redirects and redirect chains', async () => {
  for (const path of [
    '/',
    '//example.test',
    '/../private',
    '/old?x=1',
    '/old%2fpage',
    '/api/private',
    '/assets/file',
    '/scripts.js',
    '/robots.txt',
  ])
    await expectSqlState(save(path), 'CMS04')
  await expectSqlState(save('/foreign', otherPage), 'CMS04')
  await expectSqlState(save('/chain', id), 'CMS04')
  await expectSqlState(save('/chapter/peoria'), 'CMS04')
  await db.asUser(s.superAdmin, c => c.query("SELECT app.create_page($1,'existing','[Existing page]')", [s.siteA]))
  await expectSqlState(save('/existing'), 'CMS04')
  const revision = (await db.asUser(s.superAdmin, c => c.query('SELECT revision FROM pages WHERE id=$1', [s.pageA])))
    .rows[0]!.revision
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query("SELECT * FROM app.rename_page($1,$2,'[Home]','chapter/peoria')", [s.pageA, revision]),
    ),
    'CMS04',
  )
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query("SELECT app.create_page($1,'chapter/peoria','[Conflicting page]')", [s.siteA]),
    ),
    'CMS04',
  )
})
it('enforces site administration, revisions and direct-write/worker/public boundaries', async () => {
  await expectSqlState(save('/old-new', s.pageA, null), 'CMS01')
  await expectSqlState(save('/changed', s.pageA, '0', id), 'CMS01')
  await save('/chapter/peoria', s.pageA, '1', id)
  for (const actor of [s.editorA, s.contributorA, s.editorB]) {
    await expectSqlState(
      db.asUser(actor, c => c.query("SELECT app.save_site_redirect($1,NULL,0,'/forbidden',$2)", [s.siteA, s.pageA])),
      'CMS02',
    )
    expect((await db.asUser(actor, c => c.query('SELECT id FROM site_redirects'))).rows).toEqual([])
  }
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query("INSERT INTO site_redirects(site_id,old_path,page_id) VALUES($1,'/direct',$2)", [s.siteA, s.pageA]),
    ),
    '42501',
  )
  for (const role of ['public', 'worker'] as const)
    await expectSqlState(
      db.as(role, c => c.query('SELECT * FROM public.site_redirects')),
      '42501',
    )
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('SELECT app.remove_site_redirect($1,$2,1)', [s.siteA, id])),
    'CMS01',
  )
})
it('serializes competing new-page and redirect claims without leaving an ambiguous address', async () => {
  for (let index = 0; index < 5; index++) {
    const slug = 'race-' + index,
      result = await Promise.allSettled([
        save('/' + slug),
        db.asUser(s.superAdmin, c => c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, slug, '[New page]'])),
      ])
    expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    const failure = result.find(row => row.status === 'rejected') as PromiseRejectedResult
    expect(failure.reason.code).toBe('CMS04')
    const count = (
      await db.asUser(s.superAdmin, c =>
        c.query(
          "SELECT (SELECT count(*) FROM pages WHERE site_id=$1 AND slug=$2)+(SELECT count(*) FROM site_redirects WHERE site_id=$1 AND old_path='/'||$2) AS count",
          [s.siteA, slug],
        ),
      )
    ).rows[0]!.count
    expect(count).toBe('1')
  }
})
it('keeps new chapter-page attachment and redirect/site release locks in a consistent order', async () => {
  const division = await db.asUser(s.superAdmin, async c => {
    await c.query('SELECT app.enable_chapters($1)', [s.siteA])
    const id = (await c.query("SELECT app.create_chapter_division($1,'Example division (sample)') AS id", [s.siteA]))
      .rows[0]!.id
    await c.query('SELECT app.set_chapter_division_member($1,$2,true)', [id, s.editorB])
    return id
  })
  for (let index = 0; index < 3; index++) {
    const chapter = await db.asUser(s.superAdmin, async c => {
      const id = (
        await c.query('SELECT * FROM app.save_chapter_setup($1,NULL,0,$2,$3)', [
          s.siteA,
          'attach-' + index,
          {
            name: '[Chapter]',
            destination: 'external',
            pageId: null,
            externalUrl: 'https://example.test/chapter',
            updateMode: 'division',
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
      ).rows[0]!.chapter_id
      await c.query('SELECT app.assign_chapter_division($1,$2)', [id, division])
      return id
    })
    const result = await Promise.allSettled([
      save('/attachment-race-' + index),
      db.asUser(s.editorB, c => c.query('SELECT app.create_chapter_page($1,1) AS id', [chapter])),
    ])
    expect(result.map(row => row.status)).toEqual(['fulfilled', 'fulfilled'])
  }
})
it('allows ordinary page creation beside a release without reversing the site and path locks', async () => {
  for (let index = 0; index < 3; index++) {
    const revision = (await db.asUser(s.superAdmin, c => c.query('SELECT revision FROM pages WHERE id=$1', [s.pageA])))
      .rows[0]!.revision
    const result = await Promise.allSettled([
      db.asUser(s.superAdmin, async c => {
        await c.query('SELECT app.lock_release_site($1)', [s.siteA])
        return c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [s.pageA, revision, ...CHECKED_CLEAN])
      }),
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, 'beside-release-' + index, '[New page]']),
      ),
    ])
    expect(result.map(row => row.status)).toEqual(['fulfilled', 'fulfilled'])
  }
})
it('reapplies without changing redirects and removes only the expected version', async () => {
  const sql = await readFile(new URL('../migrations/0154_site_redirects.sql', import.meta.url), 'utf8')
  await db.as('owner', async c => {
    const before = (await c.query('SELECT * FROM site_redirects ORDER BY id')).rows
    await c.query(sql)
    await c.query(sql)
    expect((await c.query('SELECT * FROM site_redirects ORDER BY id')).rows).toEqual(before)
  })
  await db.asUser(s.superAdmin, c => c.query('SELECT app.remove_site_redirect($1,$2,2)', [s.siteA, id]))
  expect((await resolve('/chapter/peoria')).rows[0]!.target).toBeNull()
})
