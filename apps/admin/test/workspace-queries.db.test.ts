import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
let db: TestDatabase, s: Scenario
vi.mock('server-only', () => ({}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import { listWorkspacePages } from '../src/lib/workspace-queries.ts'
beforeAll(async () => {
  db = await TestDatabase.create('workspace_reads')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('keeps Home and Pages scoped to the reader, including foreign-site and signed-out denial', async () => {
  const pages = await listWorkspacePages(s.editorA)
  expect(pages.some(page => page.id === s.pageA)).toBe(true)
  expect(pages.every(page => page.site_id === s.siteA)).toBe(true)
  expect(await listWorkspacePages(s.editorB, s.siteA)).toEqual([])
  expect(await db.as('authenticated', client => client.query('SELECT id FROM pages'))).toMatchObject({ rows: [] })
})
it('shows saved page grouping, edit facts, menu state and actual live sample markers', async () => {
  const id = await db.asUser(s.editorA, async client => {
    const id = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'workspace-child', 'A child page'])
    ).rows[0]!.id
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        JSON.stringify([
          {
            section_def_id: s.heroDefId,
            section_def_version: 1,
            values: { heading: 'Sample title', intro: 'Sample introduction', __cms_sample_fields: ['heading'] },
          },
        ]),
        '{}',
      ])
    ).rows[0]!
    await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [id, saved.revision, ...CHECKED_CLEAN])
    const revision = (await client.query('SELECT revision FROM pages WHERE id=$1', [id])).rows[0]!.revision
    await client.query('SELECT app.set_page_parent($1,$2,$3)', [id, revision, s.pageA])
    return id
  })
  let page = (await listWorkspacePages(s.editorA, s.siteA)).find(page => page.id === id)!
  expect(page.parent_page_id).toBe(s.pageA)
  expect(page.edited_by).toBe('You')
  expect(Date.parse(page.edited_at)).not.toBeNaN()
  expect(page.live_samples).toBe(true)
  expect(typeof page.in_menu).toBe('boolean')
  await db.asUser(s.editorA, async client => {
    const head = (
      await client.query(
        'SELECT p.revision,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [id],
      )
    ).rows[0]!
    delete head.content[0].values.__cms_sample_fields
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        id,
        head.revision,
        JSON.stringify(head.content),
        '{}',
      ])
    ).rows[0]!
    await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [id, saved.revision, ...CHECKED_CLEAN])
  })
  page = (await listWorkspacePages(s.editorA, s.siteA)).find(page => page.id === id)!
  expect(page.live_samples).toBe(false)
})
