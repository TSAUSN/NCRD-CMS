import { ChapterSetup } from '@cms/schema'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, heroContent, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
let db: TestDatabase, s: Scenario
vi.mock('server-only', () => ({}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { listReleaseCandidates } from '../src/lib/releases.ts'
import { readPageSavedReview } from '../src/lib/page-release.ts'
import { releasePresentations } from '../src/lib/release-presentation.ts'
const longText = 'A complete private introduction. '.repeat(400).trim()
beforeAll(async () => {
  db = await TestDatabase.create('release_comparison')
  s = await seedScenario(db)
  await db.asUser(s.editorA, async client => {
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId, 'Before'), '{}'])
    await client.query('SELECT app.publish_page($1,1,$2,$3,$4)', [s.pageA, ...CHECKED_CLEAN])
    const content = JSON.parse(heroContent(s.heroDefId, 'After'))
    content[0].values.intro = longText
    await client.query('SELECT app.save_page_draft($1,2,$2,$3)', [s.pageA, JSON.stringify(content), '{}'])
  })
})
afterAll(async () => {
  await db?.close()
})
describe('bounded publish summaries and requested field comparisons', () => {
  it('keeps private field bodies out of the workspace payload, while returning full values on request', async () => {
    const candidates = await listReleaseCandidates(s.editorA, s.siteA),
      page = candidates.find(item => item.id === s.pageA)!
    const summary = await releasePresentations(s.editorA, s.siteA, candidates)
    expect(summary[page.key]?.cells).toEqual([])
    expect(summary[page.key]?.summary).toContain('Hero: changed heading · Hero: changed intro')
    expect(JSON.stringify(summary).length).toBeLessThan(2048)
    expect(JSON.stringify(summary)).not.toContain(longText)
    const comparison = await releasePresentations(s.editorA, s.siteA, [page], true)
    expect(comparison[page.key]?.cells.find(cell => cell.label === 'Hero · Intro')?.after).toBe(longText)
    expect(comparison[page.key]?.beforeVersionId).toBeTruthy()
  })
  it('does not return another site’s comparison even with its exact item reference', async () => {
    const candidates = await listReleaseCandidates(s.editorA, s.siteA)
    expect(await releasePresentations(s.editorB, s.siteA, candidates, true)).toEqual({})
  })
})

it('reads the same exact saved review and refuses stale, foreign and contributor requests', async () => {
  const candidate = (await listReleaseCandidates(s.editorA, s.siteA)).find(item => item.id === s.pageA)!,
    review = await readPageSavedReview(s.editorA, s.pageA, candidate.revision, candidate.versionId!)
  expect(review.presentation).toEqual(
    (await releasePresentations(s.editorA, s.siteA, [candidate], true))[candidate.key],
  )
  expect(review.presentation.changes?.[0]).toEqual({ text: 'Hero: changed heading', sectionIndex: 0 })
  await expect(readPageSavedReview(s.editorA, s.pageA, '0', candidate.versionId!)).rejects.toMatchObject({
    kind: 'stale_revision',
  })
  await expect(readPageSavedReview(s.editorB, s.pageA, candidate.revision, candidate.versionId!)).rejects.toMatchObject(
    { kind: 'not_found' },
  )
  await expect(
    readPageSavedReview(s.contributorA, s.pageA, candidate.revision, candidate.versionId!),
  ).rejects.toMatchObject({ kind: 'not_authorized' })
})
it('field comparisons use the requested saved version when a later draft exists', async () => {
  const candidate = (await listReleaseCandidates(s.editorA, s.siteA)).find(item => item.id === s.pageA)!
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      s.pageA,
      candidate.revision,
      heroContent(s.heroDefId, '[Later private heading]'),
      '{}',
    ]),
  )
  const comparison = (await releasePresentations(s.editorA, s.siteA, [candidate], true))[candidate.key]!
  expect(comparison.cells.find(cell => cell.label === 'Hero · Heading')?.after).toBe('After')
  expect(comparison.summary).not.toContain('[Later private heading]')
  await expect(readPageSavedReview(s.editorA, s.pageA, candidate.revision, candidate.versionId!)).rejects.toMatchObject(
    { kind: 'stale_revision' },
  )
})

it('reviews the chapter setup pinned to the page, including private contact changes, without reading a newer draft', async () => {
  const original = ChapterSetup.parse({
    name: 'Review summary chapter',
    destination: 'page',
    pageId: null,
    externalUrl: null,
    contact: { name: 'Original contact', role: 'Coordinator', email: 'original@example.test' },
    sections: {},
  })
  const state = await db.asUser(s.superAdmin, async client => {
    await client.query('SELECT app.enable_chapters($1)', [s.siteA])
    const pageId = (
      await client.query("SELECT app.create_page($1,'chapters/review-summary','Review summary chapter') AS id", [
        s.siteA,
      ])
    ).rows[0]!.id
    const content = heroContent(s.heroDefId, 'Chapter summary')
    const config = { ...original, pageId }
    const chapter = (
      await client.query('SELECT * FROM app.save_chapter_setup($1,NULL,0,$2,$3)', [
        s.siteA,
        'review-summary',
        JSON.stringify(config),
      ])
    ).rows[0]!
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [pageId, content, '{}'])
    await client.query('SELECT app.publish_page($1,1,$2,$3,$4)', [pageId, ...CHECKED_CLEAN])
    const chapterHead = (await client.query('SELECT revision FROM chapters WHERE id=$1', [chapter.chapter_id])).rows[0]!
    const selected = {
      ...config,
      destination: 'division',
      externalUrl: 'https://review.example.test/division',
      contact: { ...config.contact, name: 'Reviewed contact' },
    }
    await client.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
      s.siteA,
      chapter.chapter_id,
      chapterHead.revision,
      'review-summary',
      JSON.stringify(selected),
    ])
    await client.query('SELECT app.save_page_draft($1,2,$2,$3)', [pageId, content, '{}'])
    const head = (await client.query('SELECT revision,draft_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!
    const latestChapter = (await client.query('SELECT revision FROM chapters WHERE id=$1', [chapter.chapter_id]))
      .rows[0]!
    await client.query('SELECT * FROM app.save_chapter_setup($1,$2,$3,$4,$5)', [
      s.siteA,
      chapter.chapter_id,
      latestChapter.revision,
      'review-summary',
      JSON.stringify({ ...selected, contact: { ...selected.contact, name: 'Later unreviewed contact' } }),
    ])
    return { pageId, head }
  })
  const review = await readPageSavedReview(
    s.superAdmin,
    state.pageId,
    String(state.head.revision),
    state.head.draft_version_id,
  )
  expect(review.presentation.changes).toEqual(
    expect.arrayContaining([
      { text: 'Chapter setup: Where visitors go changed' },
      { text: 'Chapter setup: Page address changed' },
      { text: 'Chapter setup: Contact name changed' },
    ]),
  )
  expect(review.presentation.noVisibleChanges).toBe(false)
  expect(review.presentation.cells).toContainEqual({
    label: 'Chapter setup · Contact name',
    before: 'Original contact',
    after: 'Reviewed contact',
  })
  expect(JSON.stringify(review)).not.toContain('Later unreviewed contact')
  const editorReview = await readPageSavedReview(
    s.editorA,
    state.pageId,
    String(state.head.revision),
    state.head.draft_version_id,
  )
  expect(JSON.stringify(editorReview)).not.toContain('Reviewed contact')
  await expect(
    readPageSavedReview(s.editorB, state.pageId, String(state.head.revision), state.head.draft_version_id),
  ).rejects.toMatchObject({ kind: 'not_found' })
})
