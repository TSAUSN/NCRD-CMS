import { sawsoStoryRows } from '@cms/seeds/sawso-stories'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import {
  ensureChapterRedirects,
  ensureSawsoRedirects,
  redirectWorkspace,
  importRedirectsInTransaction,
} from '../src/lib/redirects.ts'
import { previewRedirectCsv } from '../src/lib/redirect-import.ts'
let db: TestDatabase, s: Scenario, peoria: string, texas: string, finder: string
beforeAll(async () => {
  db = await TestDatabase.create('redirect_import')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    peoria = (await c.query("SELECT app.create_page($1,'chapters/peoria','Peoria Chapter') AS id", [s.siteA])).rows[0]!
      .id
    texas = (await c.query("SELECT app.create_page($1,'chapters/north-texas','North Texas Chapter') AS id", [s.siteA]))
      .rows[0]!.id
    finder = (await c.query("SELECT app.create_page($1,'chapters','Find a chapter') AS id", [s.siteA])).rows[0]!.id
  })
})
afterAll(async () => {
  await db?.close()
})
it('installs only available CSV-backed destinations and preserves every edited mapping on retries', async () => {
  await db.asUser(s.superAdmin, c => ensureChapterRedirects(c, s.siteA))
  let data = await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))
  expect(data.rows.map(row => [row.oldPath, row.pageId])).toEqual([
    ['/chapter', finder],
    ['/chapter/northtexas', texas],
    ['/chapter/peoria', peoria],
  ])
  const row = data.rows.find(row => row.pageId === peoria)!
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.save_site_redirect($1,$2,$3,$4,$5)', [s.siteA, row.id, row.revision, row.oldPath, finder]),
  )
  const before = (await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))).rows
  await db.asUser(s.superAdmin, c => ensureChapterRedirects(c, s.siteA))
  data = await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))
  expect(data.rows).toEqual(before)
})
it('previews and atomically imports additions and updates, preserving matching rows on repetition', async () => {
  const source =
    'Old address,New address\n/chapter/peoria,/chapters/north-texas\n/old-home,/\n/another-old,/chapters/peoria'
  const preview = async () => {
    const data = await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))
    return previewRedirectCsv(source, data.pages, data.rows)
  }
  const plan = await preview()
  expect(plan.every(row => row.issue === null)).toBe(true)
  expect(await db.asUser(s.superAdmin, c => importRedirectsInTransaction(c, s.siteA, source, plan))).toBe(3)
  const before = (await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))).rows
  const repeated = await preview()
  expect(await db.asUser(s.superAdmin, c => importRedirectsInTransaction(c, s.siteA, source, repeated))).toBe(0)
  expect((await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))).rows).toEqual(before)
})
it('refuses a stale preview and invalid rows without changing any redirect or exposing another site’s pages', async () => {
  const data = await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA)),
    source = 'Old address,New address\n/chapter/peoria,/chapters/peoria',
    plan = previewRedirectCsv(source, data.pages, data.rows),
    row = data.rows.find(row => row.oldPath === '/chapter/peoria')!
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.save_site_redirect($1,$2,$3,$4,$5)', [s.siteA, row.id, row.revision, row.oldPath, finder]),
  )
  const before = (await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))).rows
  await expect(db.asUser(s.superAdmin, c => importRedirectsInTransaction(c, s.siteA, source, plan))).rejects.toThrow(
    'changed',
  )
  const invalid = 'Old address,New address\n/would-be-new,/\n/chapters/peoria,/'
  const current = await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA)),
    invalidPlan = previewRedirectCsv(invalid, current.pages, current.rows)
  await expect(
    db.asUser(s.superAdmin, c => importRedirectsInTransaction(c, s.siteA, invalid, invalidPlan)),
  ).rejects.toThrow('Row 3')
  await expect(db.asUser(s.editorA, c => importRedirectsInTransaction(c, s.siteA, source, plan))).rejects.toThrow(
    'administrator',
  )
  expect((await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))).rows).toEqual(before)
})

it('maps all34 approved SAWSO story paths and preserves an edited destination on repetition', async () => {
  await db.asUser(s.superAdmin, async c => {
    for (const story of sawsoStoryRows())
      await c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, story.values.story_url.slice(1), story.values.title])
  })
  expect(await db.asUser(s.superAdmin, c => ensureSawsoRedirects(c, s.siteA))).toBe(34)
  const before = (await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))).rows.filter(r =>
    r.oldPath.startsWith('/sawso/story/'),
  )
  expect(before).toHaveLength(34)
  const data = await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))
  for (const story of sawsoStoryRows()) {
    const row = before.find(r => r.oldPath === new URL(story.values.old_address).pathname)!
    expect(data.pages.find(p => p.id === row.pageId)!.path).toBe(story.values.story_url)
  }
  const row = before[0]!
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.save_site_redirect($1,$2,$3,$4,$5)', [s.siteA, row.id, row.revision, row.oldPath, finder]),
  )
  expect(await db.asUser(s.superAdmin, c => ensureSawsoRedirects(c, s.siteA))).toBe(0)
  expect(
    (await db.asUser(s.superAdmin, c => redirectWorkspace(c, s.siteA))).rows.find(r => r.id === row.id)!.pageId,
  ).toBe(finder)
  await expect(db.asUser(s.editorA, c => ensureSawsoRedirects(c, s.siteA))).rejects.toThrow('administrator')
})
