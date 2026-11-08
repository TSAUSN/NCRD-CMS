import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, heroContent, type Scenario } from '@cms/schema/fixtures'
import { pageReleaseSelection } from '../src/lib/page-release.ts'
let db: TestDatabase, s: Scenario, revision: string, versionId: string
beforeAll(async () => {
  db = await TestDatabase.create('page_release')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await c.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      s.pageA,
      heroContent(s.heroDefId, '[Published heading]'),
      JSON.stringify({ description: '[Page description]' }),
    ])
    await c.query('SELECT app.publish_page($1,1,$2,$3,$4)', [s.pageA, ...CHECKED_CLEAN])
    await c.query('SELECT app.save_page_draft($1,2,$2,$3)', [
      s.pageA,
      heroContent(s.heroDefId, '[Scheduled heading]'),
      JSON.stringify({ description: '[Page description]' }),
    ])
    const head = (await c.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [s.pageA])).rows[0]!
    revision = String(head.revision)
    versionId = head.draft_version_id
  })
})
afterAll(async () => {
  await db?.close()
})
it('selects only the exact owned saved page and does not publish or schedule it', async () => {
  const picked = await db.asUser(s.editorA, c => pageReleaseSelection(c, s.pageA, revision, versionId))
  expect(picked.firstSiteReview).toBe(false)
  if (picked.firstSiteReview) throw new Error('unexpected first publication')
  expect(picked.page).toMatchObject({ type: 'page', id: s.pageA, revision, versionId })
  expect(Object.keys(picked).sort()).toEqual(['firstSiteReview', 'page', 'siteId'])
  const state = await db.asUser(
    s.superAdmin,
    async c =>
      (await c.query('SELECT draft_version_id,published_version_id FROM pages WHERE id=$1', [s.pageA])).rows[0],
  )
  expect(state.draft_version_id).not.toBe(state.published_version_id)
  expect((await db.as('owner', c => c.query('SELECT count(*)::int AS n FROM scheduled_actions'))).rows[0].n).toBe(0)
})
it('refuses stale pins, foreign pages and non-publishers', async () => {
  await expect(db.asUser(s.editorA, c => pageReleaseSelection(c, s.pageA, '0', versionId))).rejects.toMatchObject({
    kind: 'stale_revision',
  })
  await expect(
    db.asUser(s.editorA, c => pageReleaseSelection(c, s.pageA, revision, randomUUID())),
  ).rejects.toMatchObject({ kind: 'stale_revision' })
  await expect(db.asUser(s.editorB, c => pageReleaseSelection(c, s.pageA, revision, versionId))).rejects.toMatchObject({
    kind: 'not_found',
  })
  await expect(
    db.asUser(s.contributorA, c => pageReleaseSelection(c, s.pageA, revision, versionId)),
  ).rejects.toMatchObject({ kind: 'not_authorized' })
})
it('selects an unpublished draft but rejects the same head once published', async () => {
  await db.asUser(s.editorA, async c => {
    const pageId = (await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'only-saved', '[Only saved]']))
      .rows[0]!.id
    const saved = (
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        pageId,
        heroContent(s.heroDefId, '[Fresh page]'),
        JSON.stringify({ description: '[Page description]' }),
      ])
    ).rows[0]!
    const draft = await pageReleaseSelection(c, pageId, String(saved.revision), saved.version_id)
    expect(draft).toMatchObject({ firstSiteReview: false, page: { id: pageId, unpublished: true } })
    await c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, saved.revision, ...CHECKED_CLEAN])
    const live = (await c.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!
    await expect(pageReleaseSelection(c, pageId, String(live.revision), live.draft_version_id)).rejects.toMatchObject({
      kind: 'invalid_state',
    })
  })
})
it('returns the first-site review requirement without selecting site-wide changes', async () => {
  await db.as('owner', c => c.query('UPDATE sites SET initial_release_required=true WHERE id=$1', [s.siteA]))
  try {
    expect(await db.asUser(s.editorA, c => pageReleaseSelection(c, s.pageA, revision, versionId))).toEqual({
      firstSiteReview: true,
      siteId: s.siteA,
    })
  } finally {
    await db.as('owner', c => c.query('UPDATE sites SET initial_release_required=false WHERE id=$1', [s.siteA]))
  }
})
