import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
import { renderPage } from '@cms/renderer'
let db: TestDatabase, s: Scenario
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { ensureSawsoSite } from '../src/lib/sawso-site.ts'
import { ensureSawsoCorePages, ensureSawsoPublicPages } from '../src/lib/sawso-pages.ts'
import { ensureSawsoFrame } from '../src/lib/sawso-frame.ts'
import { listReleaseCandidates, planSiteRelease, executeSiteRelease } from '../src/lib/releases.ts'
beforeAll(async () => {
  db = await TestDatabase.create('sawso_pages')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('publishes approved public pages with one automatic story template and an immutable filterable newsroom', async () => {
  const site = await db.asUser(s.superAdmin, async c => {
    const site = await ensureSawsoSite(c, randomUUID())
    await ensureSawsoCorePages(c, site.siteId)
    await ensureSawsoPublicPages(c, site.siteId)
    await ensureSawsoFrame(c, site.siteId)
    return site
  })
  const plan = await planSiteRelease(
    s.superAdmin,
    randomUUID(),
    site.siteId,
    await listReleaseCandidates(s.superAdmin, site.siteId),
  )
  expect(
    [...new Set(plan.preview_report.flatMap(check => check.report.blocking).map(f => f.rule))],
    plan.preview_report
      .filter(check => check.report.blocking.some(f => f.rule !== 'sample_content'))
      .map(check => check.title)
      .join(', '),
  ).toEqual(['sample_content'])
  await executeSiteRelease(s.superAdmin, plan.id, 'Confirmed: Publish with sample content.')
  const audit = (
    await db.as('owner', c =>
      c.query("SELECT detail FROM audit_log WHERE item_id=$1 AND action='release.publish'", [plan.id]),
    )
  ).rows[0]!.detail
  expect(audit.readiness_report_ref).toBe(plan.id)
  expect(audit.readiness.pages).toBe(49)
  expect(audit.readiness_report_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(audit).length).toBeLessThan(65536)

  async function route(path: string) {
    return (await db.as('public', c => c.query('SELECT * FROM public_api.resolve_route($1,$2)', [site.hostname, path])))
      .rows[0]!
  }
  const home = await route('/'),
    news = await route('/newsroom'),
    health = await route('/ways-we-help/health'),
    capacity = await route('/ways-we-help/capacity-building'),
    family = await route('/ways-we-help/family-care'),
    livelihoods = await route('/ways-we-help/livelihoods')
  expect(home.render_manifest.sections.map((s: any) => s.def.slug)).toEqual([
    'core-feature-slider',
    'core-feature-tiles',
    'core-text-block',
    'core-feature-tiles',
    'core-photo-grid',
    'core-newsroom',
    'core-numbered-steps',
    'core-link-band',
    'core-contact-cards',
  ])
  const envelope = (row: any) =>
    row.render_manifest.sections.find((s: any) => s.def.slug === 'core-stories')?.instance.values.stories.entries
  expect(envelope(health)).toHaveLength(6)
  expect(envelope(capacity)).toHaveLength(1)
  expect(envelope(livelihoods)).toHaveLength(0)
  expect(envelope(family)).toBeUndefined()
  const list = news.render_manifest.sections.find((s: any) => s.def.slug === 'core-story-split').instance.values.stories
    .entries
  const eligible = (
    await db.as('owner', c =>
      c.query(
        `SELECT e.stable_key FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.published_version_id WHERE e.collection_id=$1 AND e.published_archived_at IS NULL AND (v.values->>'published_date')::date BETWEEN ((statement_timestamp() AT TIME ZONE 'UTC')::date - interval '13 months')::date AND (statement_timestamp() AT TIME ZONE 'UTC')::date`,
        [site.collectionId],
      ),
    )
  ).rows
  expect(new Set(list.map((e: any) => e.stableKey))).toEqual(new Set(eligible.map(row => row.stable_key)))
  const html = (row: any, options = {}) =>
    renderPage({ manifest: row.render_manifest, shell: row.shell_payload, isStaging: true, options }).html
  const filtered = html(news, { newsroom: { sector: 'education' } })
  expect(filtered.match(/class="core-story-card"/g)).toHaveLength(7)
  expect(filtered).toContain('Our Stories in Education')
  expect(html(news, { newsroom: { page: '2' } }).match(/class="core-story-card"/g)).toHaveLength(24)
  for (const row of [home, news, health, family, livelihoods]) {
    expect(html(row).match(/<h1(?: |\>)/g)).toHaveLength(1)
    expect(html(row)).toContain('/cms-themes/sawso/salvation-army-shield.svg')
  }
  const ukraine = await route('/stories/life-in-ukraine-years-into-war')
  expect(html(ukraine)).toContain('May 29, 2026')
  const story = (
    await db.as('owner', c =>
      c.query(
        "SELECT render_manifest FROM published_routes WHERE site_id=$1 AND path LIKE '/stories/%' ORDER BY path",
        [site.siteId],
      ),
    )
  ).rows
  expect(story).toHaveLength(34)
  expect(new Set(story.map(r => r.render_manifest.sections[0].def.section_def_id)).size).toBe(1)
  const missing = story.find(r => !r.render_manifest.sections[0].instance.values.story.entries[0].values.body)!,
    summary = missing.render_manifest.sections[0].instance.values.story.entries[0].values
  const storyHtml = html({ ...news, render_manifest: missing.render_manifest })
  expect(storyHtml).toContain('Read the full story')
  expect(storyHtml).toContain('href="' + summary.old_address + '"')
}, 180000)
