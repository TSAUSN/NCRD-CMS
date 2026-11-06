import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
vi.mock('server-only', () => ({}))
let db: TestDatabase, s: Scenario, siteId: string, collectionId: string
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { ensureSawsoSite } from '../src/lib/sawso-site.ts'
import { ensureSawsoCorePages, ensureSawsoPublicPages } from '../src/lib/sawso-pages.ts'
import { changeStoriesTags } from '../src/lib/stories-tags.ts'
import { addWorldToPage, addSplitToPage, storyWidgetPages } from '../src/lib/story-widget-add.ts'
import { buildStoryFeedPreview } from '../src/lib/story-feed-preview.ts'
beforeAll(async () => {
  db = await TestDatabase.create('story_feed_preview')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    const created = await ensureSawsoSite(c, randomUUID(), 'preview-sawso')
    siteId = created.siteId
    collectionId = created.collectionId
    await ensureSawsoCorePages(c, siteId)
    await ensureSawsoPublicPages(c, siteId)
    await c.query("SELECT app.set_site_membership($1,$2,'editor')", [s.editorA, siteId])
    const head = (await c.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [collectionId])).rows[0]!
    await changeStoriesTags(c, siteId, collectionId, String(head.revision), String(head.entry_revision), {
      action: 'review-policy',
      publishUnreviewed: true,
    })
    const rows = (
        await c.query(
          "SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY v.values->>'published_date' DESC,e.id",
          [collectionId],
        )
      ).rows,
      revision = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [collectionId])).rows[0]!
        .entry_revision
    await c.query('SELECT app.save_collection_entries($1,$2,$3)', [
      collectionId,
      revision,
      JSON.stringify(
        rows.map((row, i) => ({
          id: row.id,
          stableKey: row.stable_key,
          values:
            i === 0 ? { ...row.values, hidden: true, body: '<p>[Private article body sentinel]</p>' } : row.values,
        })),
      ),
    ])
  })
})
afterAll(async () => {
  await db?.close()
})
const filters = { q: '', status: 'all' as const, main: '', secondary: '' }
const cards = (html: string) => (html.match(/<article\b[^>]*\bclass="[^"]*\bcore-story-card\b/g) ?? []).length
async function fingerprint() {
  return db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query(
          'SELECT app.release_fingerprint($1) AS hash,(SELECT count(*) FROM audit_log WHERE site_id=$1) AS audits',
          [siteId],
        )
      ).rows[0],
  )
}
it('renders real card fields and bounded pages without publishing or carrying full article text', async () => {
  const before = await fingerprint(),
    first = await buildStoryFeedPreview(s.editorA, siteId, 'preview-sawso', filters),
    second = await buildStoryFeedPreview(s.editorA, siteId, 'preview-sawso', filters, 2)
  expect(first).not.toBeNull()
  expect(cards(first!)).toBe(24)
  expect(cards(second!)).toBeGreaterThan(0)
  expect(cards(second!)).toBeLessThan(24)
  expect(first).toContain('More stories')
  expect(second).toContain('Previous stories')
  expect(first).toContain('Back to Stories')
  expect(first).toContain('visit=1&amp;site=draft&amp;lists=draft')
  for (const html of [first!, second!]) {
    expect(html).not.toContain('[Private article body sentinel]')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('data-cms-section=')
    expect(html).not.toContain('data-cms-entry=')
  }
  expect(await fingerprint()).toEqual(before)
  expect(
    await db.as(
      'public',
      async c =>
        (await c.query('SELECT * FROM public_api.resolve_route($1,$2)', ['preview-sawso.staging.localhost', '/'])).rows,
    ),
  ).toEqual([])
})
it('applies current list search/status/tags and feed eligibility, explains empty matches and escapes search text', async () => {
  const hidden = await buildStoryFeedPreview(s.editorA, siteId, 'preview-sawso', { ...filters, status: 'hidden' })
  expect(cards(hidden!)).toBe(0)
  expect(hidden).toContain('1 story matches the list filters; 0 are eligible for feeds.')
  expect(hidden).toContain('No feed stories match these filters.')
  const gap = await buildStoryFeedPreview(s.editorA, siteId, 'preview-sawso', {
    ...filters,
    main: 'family-care',
    secondary: 'africa',
  })
  expect(cards(gap!)).toBe(0)
  const text = '</p><script>window.secret=1</script>',
    search = await buildStoryFeedPreview(s.editorA, siteId, 'preview-sawso', { ...filters, q: text })
  expect(cards(search!)).toBe(0)
  expect(search).toContain('&lt;script&gt;')
  expect(search).not.toContain('<script>window.secret')
})
it('does not construct another tenant’s private Story preview', async () => {
  expect(await buildStoryFeedPreview(s.editorB, siteId, 'preview-sawso', filters)).toBeNull()
})

it('uses the same scriptless World renderer, scoped region links and card-only drafts without changing data', async () => {
  const before = await fingerprint(),
    html = await buildStoryFeedPreview(
      s.editorA,
      siteId,
      'preview-sawso',
      filters,
      1,
      { heading: '[World heading]', region: 'africa', main: ['health'], limit: '3' },
      { story0_region: 'asia' },
    )
  expect(html).toContain('data-cms-stories-widget="0"')
  expect(html).toContain('[World heading]')
  expect(html).toContain('Our Stories from Asia')
  expect(html).toContain('widget=world')
  expect(html).toContain('story0_region=africa')
  expect(cards(html!)).toBeLessThanOrEqual(3)
  expect(html).not.toContain('[Private article body sentinel]')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('<header')
  expect(await fingerprint()).toEqual(before)
})
it('hides structural choices from Editors and refuses foreign or stale draft insertion without changing content', async () => {
  expect(await db.asUser(s.editorA, c => storyWidgetPages(c, siteId))).toEqual([])
  const pages = await db.asUser(s.superAdmin, c => storyWidgetPages(c, siteId)),
    page = pages.find(p => p.slug === '')!,
    choice = { heading: '[World]', region: 'africa', main: ['health'], limit: '3' }
  const before = await fingerprint()
  await expect(db.asUser(s.editorA, c => addWorldToPage(c, siteId, page.id, page.revision, choice))).rejects.toThrow()
  await expect(
    db.asUser(s.superAdmin, c => addWorldToPage(c, s.siteB, page.id, page.revision, choice)),
  ).rejects.toThrow()
  await expect(db.asUser(s.superAdmin, c => addWorldToPage(c, siteId, page.id, '99999', choice))).rejects.toThrow()
  expect(await fingerprint()).toEqual(before)
})
it('appends exactly one private section with current settings, preserves all existing fields, and refuses duplicate retries', async () => {
  await db.asUser(s.superAdmin, async c => {
    const page = (await storyWidgetPages(c, siteId)).find(p => p.slug === '')!,
      before = (
        await c.query(
          'SELECT p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [page.id],
        )
      ).rows[0]!,
      choice = { heading: '[Chosen heading]', region: 'africa', main: ['health'], limit: '3' }
    const first = await addWorldToPage(c, siteId, page.id, page.revision, choice),
      again = await addWorldToPage(c, siteId, page.id, page.revision, choice)
    expect(again).toEqual(first)
    const after = (
      await c.query(
        'SELECT p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [page.id],
      )
    ).rows[0]!
    expect(after.published_version_id).toBe(before.published_version_id)
    expect(after.meta).toEqual(before.meta)
    expect(after.content.slice(0, -1)).toEqual(before.content)
    expect(after.content.at(-1).values).toMatchObject({
      heading: '[Chosen heading]',
      start_region: 'africa',
      per_region: '3',
      stories: { selection: { storyTags: { main: ['health'], secondary: [] } } },
    })
  })
  const page = (await db.asUser(s.superAdmin, c => storyWidgetPages(c, siteId))).find(p => p.slug === '')!
  await expect(
    db.asUser(s.superAdmin, c =>
      addWorldToPage(c, siteId, page.id, String(Number(page.revision) - 1), {
        heading: '[World]',
        region: '',
        main: [],
        limit: '200',
      }),
    ),
  ).rejects.toThrow()
  const before = await fingerprint()
  await expect(
    db.asUser(s.superAdmin, c =>
      addWorldToPage(c, siteId, page.id, page.revision, {
        heading: '[World]',
        region: 'removed-region',
        main: [],
        limit: '200',
      }),
    ),
  ).rejects.toThrow()
  expect(await fingerprint()).toEqual(before)
})

it('uses real scriptless Split views and owned names, preserving view links without article bodies or data writes', async () => {
  const before = await fingerprint(),
    choice = {
      heading: '<script>[Heading]</script>',
      introduction: '[Introduction]',
      first: 'recent' as const,
      size: '6' as const,
    },
    recent = await buildStoryFeedPreview(s.editorA, siteId, 'preview-sawso', filters, 1, undefined, {}, choice),
    sector = await buildStoryFeedPreview(
      s.editorA,
      siteId,
      'preview-sawso',
      filters,
      1,
      undefined,
      { story0_view: 'sectors', story0_sector: 'health' },
      choice,
    ),
    map = await buildStoryFeedPreview(
      s.editorA,
      siteId,
      'preview-sawso',
      filters,
      1,
      undefined,
      { story0_view: 'map', story0_region: 'africa' },
      choice,
    )
  expect(cards(recent!)).toBe(6)
  expect(recent).toContain('widget=split')
  expect(recent).toContain('&lt;script&gt;[Heading]&lt;/script&gt;')
  expect(sector).toContain('Our Stories in Health')
  expect(map).toContain('Our Stories from Africa')
  for (const html of [recent!, sector!, map!]) {
    expect(html).not.toContain('[Private article body sentinel]')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<header')
    expect(html).toContain('story0_view=map')
  }
  expect(await fingerprint()).toEqual(before)
})
it('appends Split View once as a private draft and keeps every existing page field, metadata and published head', async () => {
  await db.asUser(s.superAdmin, async c => {
    const page = (await storyWidgetPages(c, siteId)).find(p => p.slug === '')!,
      before = (
        await c.query(
          'SELECT p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [page.id],
        )
      ).rows[0]!,
      choice = { heading: '[Split heading]', introduction: '[Introduction]', first: 'map', size: '6' }
    const first = await addSplitToPage(c, siteId, page.id, page.revision, choice),
      again = await addSplitToPage(c, siteId, page.id, page.revision, choice)
    expect(again).toEqual(first)
    const after = (
      await c.query(
        'SELECT p.published_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [page.id],
      )
    ).rows[0]!
    expect(after.published_version_id).toBe(before.published_version_id)
    expect(after.meta).toEqual(before.meta)
    expect(after.content.slice(0, -1)).toEqual(before.content)
    expect(after.content.at(-1).values).toMatchObject({
      heading: '[Split heading]',
      introduction: '[Introduction]',
      start_view: 'map',
      page_size: '6',
      stories: { selection: { limit: 200 } },
    })
  })
})
it('refuses Split structural changes from Editors, other sites and stale heads with no partial saves', async () => {
  const page = (await db.asUser(s.superAdmin, c => storyWidgetPages(c, siteId))).find(p => p.slug === '')!,
    before = await fingerprint(),
    choice = { heading: '[Split heading]', introduction: '', first: 'recent', size: '12' }
  for (const [actor, site, revision] of [
    [s.editorA, siteId, page.revision],
    [s.superAdmin, s.siteB, page.revision],
    [s.superAdmin, siteId, '99999'],
  ])
    await expect(db.asUser(actor!, c => addSplitToPage(c, site!, page.id, revision!, choice))).rejects.toThrow()
  expect(await fingerprint()).toEqual(before)
})
