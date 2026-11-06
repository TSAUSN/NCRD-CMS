import { installCoreLibrary } from '@cms/seeds/core-install'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { SiteSetup } from '@cms/schema'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { mapErrors } from '@cms/domain'
import { evaluateVersionReadiness } from '@cms/platform'

let db: TestDatabase
let s: Scenario
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { executeSiteRelease, listReleaseCandidates, planSiteRelease } from '../src/lib/releases.ts'
import { publishTogetherItems, publishTogetherPlan } from '../src/lib/publish-together.ts'

beforeAll(async () => {
  db = await TestDatabase.create('publish_together')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, client => installCoreLibrary(client))
})
afterAll(async () => {
  await db?.close()
})

async function newSite() {
  const setup = SiteSetup.parse({
    ...starterSiteSetup('resource'),
    name: 'Together',
    slug: `together-${randomUUID().slice(0, 8)}`,
  })
  const { siteId } = await db.asUser(s.superAdmin, client =>
    createSiteFromSetupInTransaction(client, randomUUID(), setup, `${setup.slug}.staging.example.test`),
  )
  const pages = await db.asUser(
    s.superAdmin,
    async client =>
      (await client.query<{ id: string; slug: string }>('SELECT id, slug FROM pages WHERE site_id=$1', [siteId])).rows,
  )
  return {
    siteId,
    home: pages.find(page => page.slug === '')!.id,
    resources: pages.find(page => page.slug === 'resources')!.id,
  }
}

/** The plan for a page, as the editor's Publish asks for it. */
function planFor(pageId: string) {
  return db.asUser(s.superAdmin, async client => {
    const draft = (
      await client.query<{ draft_version_id: string }>('SELECT draft_version_id FROM pages WHERE id=$1', [pageId])
    ).rows[0]!
    return publishTogetherPlan(client, pageId, await evaluateVersionReadiness(client, draft.draft_version_id, 'member'))
  })
}

async function release(siteId: string, pageId: string) {
  const plan = (await planFor(pageId))!
  const items = publishTogetherItems(await listReleaseCandidates(s.superAdmin, siteId), pageId, plan)!
  const planned = await planSiteRelease(s.superAdmin, randomUUID(), siteId, items)
  const findings = planned.preview_report.flatMap(check => check.report.blocking)
  expect(findings.length).toBeGreaterThan(0)
  expect(findings.every(finding => finding.rule === 'sample_content')).toBe(true)
  await expect(executeSiteRelease(s.superAdmin, planned.id, '')).rejects.toThrow('sample content')
  await executeSiteRelease(s.superAdmin, planned.id, 'Confirmed: Publish with sample content.')
  return items
}

/** Put a link into the home page's first rich-text value. */
async function linkFromHome(home: string, href: string) {
  await db.asUser(s.superAdmin, async client => {
    const page = (
      await client.query<{ revision: string; content: { values: Record<string, unknown> }[]; meta: unknown }>(
        `SELECT p.revision, v.content, v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1`,
        [home],
      )
    ).rows[0]!
    const section = page.content.find(item =>
      Object.values(item.values).some(value => typeof value === 'string' && value.includes('<p>')),
    )!
    const key = Object.keys(section.values).find(name => String(section.values[name]).includes('<p>'))!
    section.values[key] = `<p>Read <a href="${href}">our resources</a>.</p>`
    await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      home,
      page.revision,
      JSON.stringify(page.content),
      JSON.stringify(page.meta),
    ])
  })
}

describe('publishing a page together with what it needs', () => {
  it('includes the private home linked from the saved frame when publishing a secondary page first', async () => {
    const site = await newSite()
    const secondary = await db.asUser(s.superAdmin, async client => {
      const id = (await client.query('SELECT app.create_page($1,$2,$3) AS id', [site.siteId, 'details', 'Details']))
        .rows[0]!.id
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        id,
        heroContent(s.heroDefId, 'Event details'),
        '{}',
      ])
      return id
    })
    expect((await planFor(secondary))?.pages).toContainEqual({ id: site.home, title: 'Home', path: '/' })
    await release(site.siteId, secondary)
    const routes = (
      await db.as('owner', client =>
        client.query('SELECT path FROM published_routes WHERE site_id=$1 ORDER BY path', [site.siteId]),
      )
    ).rows
    expect(routes).toContainEqual({ path: '/' })
    expect(routes).toContainEqual({ path: '/details' })
  })
  it('publishes a new site for the first time with its design, header, footer and menu', async () => {
    const site = await newSite()
    const plan = (await planFor(site.home))!
    expect(plan).toMatchObject({ siteId: site.siteId, siteWide: true, collections: true })
    expect(plan.pages.map(page => page.path).sort()).toEqual(['/about', '/resources'])
    const items = await release(site.siteId, site.home)
    expect(new Set(items.map(item => item.type))).toEqual(
      new Set(['page', 'theme', 'frame', 'navigation', 'collection_schema']),
    )
    const state = await db.asUser(
      s.superAdmin,
      async client =>
        (
          await client.query(
            'SELECT initial_release_required, (SELECT published_version_id FROM pages WHERE id=$2) AS resources FROM sites WHERE id=$1',
            [site.siteId, site.resources],
          )
        ).rows[0],
    )
    expect(state.initial_release_required).toBe(false)
    expect(state.resources).toEqual(expect.any(String))
    // Nothing else is held back now, so an ordinary publish needs no plan.
    expect(await planFor(site.home)).toBeNull()
  })

  it('takes a linked page and the list it shows live with the page that links to it', async () => {
    const site = await newSite()
    // Keep Resources private initially; otherwise its saved navigation link
    // correctly includes it in the first release before this page adds a link.
    await db.asUser(s.superAdmin, async client => {
      const head = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [site.siteId])).rows[0]!
      await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
        site.siteId,
        head.revision,
        '[]',
        'manual',
      ])
    })
    await release(site.siteId, site.home)
    await linkFromHome(site.home, '/resources')
    const plan = await planFor(site.home)
    expect(plan).toMatchObject({
      siteWide: false,
      collections: true,
      pages: [{ id: site.resources, path: '/resources' }],
    })
    const items = await release(site.siteId, site.home)
    expect(items.map(item => item.type).sort()).toEqual(['collection_schema', 'page', 'page'])
    const live = await db.as('owner', async client =>
      (await client.query('SELECT path FROM published_routes WHERE site_id=$1 ORDER BY path', [site.siteId])).rows.map(
        row => row.path,
      ),
    )
    expect(live).toEqual(['/', '/resources'])
  })

  it('offers nothing when a link leads to a page that does not exist', async () => {
    const site = await newSite()
    await release(site.siteId, site.home)
    await linkFromHome(site.home, '/nowhere')
    expect(await planFor(site.home)).toBeNull()
  })
})
