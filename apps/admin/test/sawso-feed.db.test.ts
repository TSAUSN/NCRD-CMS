import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
let db: TestDatabase, s: Scenario
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { ensureSawsoSite } from '../src/lib/sawso-site.ts'
import { ensureSawsoCorePages } from '../src/lib/sawso-pages.ts'
import { listReleaseCandidates, planSiteRelease, executeSiteRelease } from '../src/lib/releases.ts'
beforeAll(async () => {
  db = await TestDatabase.create('sawso_feed')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('publishes six newest Health stories and freezes the13-month cutoff in the published manifest', async () => {
  const site = await db.asUser(s.superAdmin, async c => {
    const site = await ensureSawsoSite(c, randomUUID())
    await ensureSawsoCorePages(c, site.siteId)
    return site
  })
  const plan = await planSiteRelease(
    s.superAdmin,
    randomUUID(),
    site.siteId,
    await listReleaseCandidates(s.superAdmin, site.siteId),
  )
  expect(plan.preview_report.flatMap(check => check.report.blocking).every(f => f.rule === 'sample_content')).toBe(true)
  await executeSiteRelease(s.superAdmin, plan.id, 'Confirmed: Publish with sample content.')
  const route = (
    await db.as('public', c =>
      c.query('SELECT * FROM public_api.resolve_route($1,$2)', [site.hostname, '/ways-we-help/health']),
    )
  ).rows[0]!
  const feed = route.render_manifest.sections.find((s: { def: { slug: string } }) => s.def.slug === 'core-stories')
    .instance.values.stories.entries
  expect(feed).toHaveLength(6)
  expect(feed[0].values.title).toContain('As Ebola Spreads')
  expect(feed.map((e: { values: { published_date: string } }) => e.values.published_date)).toEqual([
    '2026-09-03',
    '2026-08-14',
    '2026-06-23',
    '2026-06-02',
    '2026-06-02',
    '2026-06-02',
  ])
  const counts = await db.as('owner', async c => {
    const result: Record<string, number> = {}
    for (const tag of [
      'disaster-relief-recovery',
      'health',
      'education',
      'business-economic-development',
      'anti-human-trafficking',
      'capacity-building',
      'family-care',
      'livelihoods',
    ]) {
      const selected = (
        await c.query('SELECT app.normalize_list_selection($1,$2,$3,false) AS selected', [
          site.siteId,
          'stories',
          JSON.stringify({
            mode: 'automatic',
            limit: 200,
            order: 'newest',
            dateField: 'published_date',
            maxAgeMonths: 13,
            filter: { field: 'tags', value: tag },
          }),
        ])
      ).rows[0]!.selected
      result[tag] = selected.stableKeys.length
    }
    return result
  })
  expect(Object.values(counts)).toEqual([17, 11, 7, 5, 3, 1, 0, 0])
}, 120000)
