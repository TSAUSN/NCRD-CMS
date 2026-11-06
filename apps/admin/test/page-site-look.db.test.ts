import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
let db: TestDatabase, s: Scenario, actor: string
vi.mock('server-only', () => ({}))
vi.mock('../src/lib/session.ts', () => ({ currentSession: async () => ({ principal: { userId: actor } }) }))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import { loadPageSiteLook, savePageSiteLook } from '../src/app/pages/[pageId]/site-look-actions.ts'
beforeAll(async () => {
  db = await TestDatabase.create('page_site_look')
  s = await seedScenario(db)
  actor = s.editorA
  await db.asUser(actor, client =>
    client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      s.pageA,
      JSON.stringify([
        { section_def_id: s.heroDefId, section_def_version: 1, values: { heading: 'Our home', intro: 'Welcome' } },
      ]),
      '{}',
    ]),
  )
  await db.asUser(s.superAdmin, client =>
    client.query('SELECT * FROM app.save_site_file_bundle($1,0,$2)', [
      s.siteA,
      JSON.stringify({
        version: 1,
        files: [],
        styles: [],
        scripts: [],
        original: {
          version: 1,
          definitions: [],
          pages: [{ pageId: s.pageA, html: { lang: 'en' }, body: {}, header: true, footer: true }],
        },
      }),
    ]),
  )
})
afterAll(async () => {
  await db?.close()
})
async function request(pageId = s.pageA) {
  const loaded = await loadPageSiteLook(pageId)
  if (!loaded.ok) throw new Error(loaded.message)
  const header = structuredClone(loaded.frame.header.draft)
  if (header.schemaVersion === 1) header.brand.siteName = 'A shared welcome'
  return {
    pageId,
    headerRevision: loaded.frame.header.revision,
    footerRevision: loaded.frame.footer.revision,
    menuRevision: loaded.menu.revision,
    header,
    footer: loaded.frame.footer.draft,
    menu: [{ label: 'Home', visible: true, target: { type: 'page', page_id: pageId } }],
    frameChanged: true,
    menuChanged: true,
  }
}
it('keeps brought-in frame and menu saves atomic through the existing Editor commands', async () => {
  const loaded = await loadPageSiteLook(s.pageA)
  expect(loaded.ok && loaded.canManage).toBe(true)
  if (!loaded.ok) return
  expect(loaded.frame.pages.map(page => page.id)).toContain(s.pageA)
  const input = await request(),
    result = await savePageSiteLook(input)
  expect(result.ok).toBe(true)
  const after = await loadPageSiteLook(s.pageA)
  if (!after.ok) throw new Error(after.message)
  expect(after.frame.header.draft).toEqual(input.header)
  expect(after.menu.draft).toEqual(input.menu)
  expect(after.frame.header.publishedVersionId).toBe(loaded.frame.header.publishedVersionId)
})
it('rolls back frame changes when the menu revision is stale', async () => {
  const before = await loadPageSiteLook(s.pageA),
    input = await request()
  if (input.header.schemaVersion === 1) input.header.brand.siteName = 'Must roll back'
  const result = await savePageSiteLook({ ...input, menuRevision: input.menuRevision - 1 })
  expect(result.ok).toBe(false)
  expect(await loadPageSiteLook(s.pageA)).toEqual(before)
})
it('keeps contributor and foreign-site writes refused', async () => {
  const input = await request()
  actor = s.contributorA
  try {
    const read = await loadPageSiteLook(s.pageA)
    expect(read.ok && read.canManage).toBe(false)
    expect((await savePageSiteLook(input)).ok).toBe(false)
  } finally {
    actor = s.editorA
  }
  actor = s.editorB
  try {
    expect((await loadPageSiteLook(s.pageA)).ok).toBe(false)
    expect((await savePageSiteLook(input)).ok).toBe(false)
  } finally {
    actor = s.editorA
  }
})

it('refuses page-level shared-area saves on a native site', async () => {
  const pageId = await db.asUser(
    s.superAdmin,
    async c =>
      (await c.query("SELECT app.create_page($1,'native-frame','[Native page]') AS id", [s.siteB])).rows[0]!.id,
  )
  actor = s.editorB
  try {
    const before = await loadPageSiteLook(pageId),
      input = await request(pageId),
      result = await savePageSiteLook(input)
    expect(result).toEqual({
      ok: false,
      message: 'Use Header & menu or Footer at site level to change these shared areas.',
    })
    expect(await loadPageSiteLook(pageId)).toEqual(before)
  } finally {
    actor = s.editorA
  }
})
