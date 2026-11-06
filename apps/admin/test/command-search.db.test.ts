import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { randomUUID } from 'node:crypto'
import { ensureEchelonSite } from '../src/lib/echelon-site.ts'
import { chapterRows, ensureChapterDemoPages } from '../src/lib/chapters.ts'
let db: TestDatabase, s: Scenario, volunteer: string, chapter: string, page: string, site: string
vi.mock('server-only', () => ({}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import { commandSearch } from '../src/lib/command-search.ts'
beforeAll(async () => {
  db = await TestDatabase.create('command_search')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    site = (await ensureEchelonSite(c, randomUUID())).siteId
    await ensureChapterDemoPages(c, site)
    const row = (await chapterRows(c, site)).find(row => row.slug === 'peoria')!
    chapter = row.id
    page = row.config.pageId!
    volunteer = (
      await c.query("SELECT app.provision_user('search-volunteer@example.test','Search volunteer (sample)') AS id")
    ).rows[0]!.id
    await c.query('SELECT app.assign_chapter_editor($1,$2,true)', [chapter, volunteer])
    const list = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        site,
        'search-speakers',
        'Speakers',
        'speakers',
        JSON.stringify([{ key: 'name', label: 'Name', type: 'text', required: true }]),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'name',
          subtitleField: null,
          imageField: null,
          groupField: null,
        }),
      ])
    ).rows[0]!
    await c.query('SELECT app.save_collection_entries($1,0,$2)', [
      list.collection_id,
      JSON.stringify([{ id: null, stableKey: 'speaker-one', values: { name: 'Avery Brooks (sample)' } }]),
    ])
  })
})
afterAll(async () => {
  await db?.close()
})
it('finds pages and list items with fresh database permissions and literal search text', async () => {
  const own = await commandSearch(s.editorA, '')
  expect(own.some(row => row.href === `/pages/${s.pageA}`)).toBe(true)
  expect(own.some(row => row.href.includes(s.siteB))).toBe(false)
  expect(own.some(row => row.label === 'Publish')).toBe(true)
  expect(own.some(row => row.label === 'Settings' || row.label === 'People & access')).toBe(false)
  expect((await commandSearch(s.superAdmin, 'People')).some(row => row.href === '/people')).toBe(true)
  expect(await commandSearch(s.superAdmin, "%_' OR 1=1 --")).toEqual([])
  const items = await commandSearch(s.superAdmin, 'Avery')
  expect(items.some(row => row.group === 'List items')).toBe(true)
  expect(
    items
      .filter(row => row.group === 'List items')
      .every(row => /content\?collection=[\da-f-]+&entry=[\da-f-]+$/.test(row.href)),
  ).toBe(true)
})
it('never discovers other chapters, lists or whole-site actions for a page volunteer, and immediately respects revocation', async () => {
  const results = await commandSearch(volunteer, '')
  expect(results.filter(row => row.group === 'Pages').map(row => row.href)).toEqual([`/pages/${page}`])
  expect(results.filter(row => row.group === 'Actions').map(row => row.label)).toEqual([
    'Home',
    'All sites',
    'Reviews',
    'Pages',
  ])
  expect(await commandSearch(volunteer, 'North Texas')).toEqual([])
  expect(await commandSearch(volunteer, 'Avery')).toEqual([])
  await db.asUser(s.superAdmin, c => c.query('SELECT app.assign_chapter_editor($1,$2,false)', [chapter, volunteer]))
  expect((await commandSearch(volunteer, '')).some(row => row.href.includes(page) || row.href.includes(site))).toBe(
    false,
  )
})
