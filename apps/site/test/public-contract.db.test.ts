// The public contract (SPEC §6.8, §9): what a crawler with JavaScript disabled
// actually gets, asserted against a real database through the real public
// renderer role. The manual `curl` proved it once; this keeps it proved.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import {
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  sectionScopeSelector,
  compileSection,
  renderPage,
  type RenderManifest,
  type SiteShell,
} from '@cms/renderer'
import { normalizeHost, normalizePath } from '@cms/domain'

let db: TestDatabase
let s: Scenario

/** Authored, as a person would write it. `hero.css` is what the policy makes of it. */
const HERO_CSS = '.hero{padding:2rem}'

const hero = compileSection({
  sourceHtml: '<section><h1>{{heading}}</h1><p>{{intro}}</p></section>',
  sourceCss: HERO_CSS,
  scopeSelector: sectionScopeSelector('hero') ?? undefined,
  slots: [
    { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
    { id: 'intro', kind: 'text', label: 'Intro', constraints: {} },
  ],
})

async function publishHome(heading: string, description: string) {
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
      'hero',
      'Hero',
      'Openers',
      '<section><h1>{{heading}}</h1><p>{{intro}}</p></section>',
      HERO_CSS,
      hero.css,
      JSON.stringify(hero.ast),
      JSON.stringify([
        { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
        { id: 'intro', kind: 'text', label: 'Intro', constraints: {} },
      ]),
      // The compiler's own policy version, so this test cannot drift from it.
      hero.renderHash,
      SANITIZER_POLICY_VERSION,
      CSS_POLICY_VERSION,
      'contract test',
    ]),
  )

  const defId = await db.asUser(
    s.superAdmin,
    async c => (await c.query<{ id: string }>("SELECT id FROM section_defs WHERE slug = 'hero'")).rows[0]!.id,
  )
  const version = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query<{ v: number }>('SELECT max(version) AS v FROM section_def_versions WHERE section_def_id = $1', [
          defId,
        ])
      ).rows[0]!.v,
  )

  const content = JSON.stringify([
    {
      section_def_id: defId,
      section_def_version: version,
      values: { heading, intro: 'Complete from the server.' },
      hidden: false,
      hidden_at: [],
      label: 'Hero',
    },
  ])

  const rev = await db.asUser(s.editorA, async c =>
    Number(
      (await c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [s.pageA])).rows[0]!.revision,
    ),
  )
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, rev, content, JSON.stringify({ description })]),
  )
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, rev + 1, ...CHECKED_CLEAN]),
  )
}

/** Exactly what apps/site does per request: resolve, then render. */
async function fetchAsPublic(rawHost: string, rawPath: string) {
  const host = normalizeHost(rawHost)
  if (!host) return null
  const path = normalizePath(rawPath)
  const { rows } = await db.as('public', c =>
    c.query<{
      render_manifest: RenderManifest
      shell_payload: SiteShell
      is_staging: boolean
      canonical_host: string | null
    }>('SELECT * FROM public_api.resolve_route($1,$2)', [host, path]),
  )
  const row = rows[0]
  if (!row) return null
  const routes = await db.as('public', c =>
    c.query<{ page_id: string; path: string }>('SELECT page_id, path FROM public_api.site_routes($1)', [host]),
  )
  return renderPage({
    manifest: row.render_manifest,
    shell: row.shell_payload,
    isStaging: row.is_staging,
    navigationPaths: Object.fromEntries(routes.rows.map(route => [route.page_id, route.path])),
    options: { canonicalBase: row.canonical_host ? `https://${row.canonical_host}` : undefined },
  })
}

beforeAll(async () => {
  db = await TestDatabase.create('public')
  s = await seedScenario(db)
  await publishHome('Explore the Index', 'Data with dignity.')
})
afterAll(async () => {
  await db?.close()
})

describe('a published page is complete without JavaScript', () => {
  it('exposes page ids with paths so the public shell can resolve page targets', async () => {
    const { rows } = await db.as('public', c =>
      c.query<{ page_id: string; path: string }>('SELECT page_id, path FROM public_api.site_routes($1)', [
        'site-a.staging.example.test',
      ]),
    )
    expect(rows).toContainEqual({ page_id: s.pageA, path: '/' })
  })

  it('serves the real heading, content, title, and description', async () => {
    const page = await fetchAsPublic('site-a.staging.example.test', '/')
    expect(page).not.toBeNull()
    expect(page!.html).toContain('<h1>Explore the Index</h1>')
    expect(page!.html).toContain('Complete from the server.')
    expect(page!.html).toContain('<title>Home</title>')
    expect(page!.html).toContain('content="Data with dignity."')
  })

  it('contains no script tag at all', async () => {
    const page = await fetchAsPublic('site-a.staging.example.test', '/')
    expect(page!.html).not.toMatch(/<script/i)
  })

  it('carries no editor instrumentation', async () => {
    const page = await fetchAsPublic('site-a.staging.example.test', '/')
    expect(page!.html).not.toContain('data-cms-')
  })

  it('keeps a staging host out of the index', async () => {
    const page = await fetchAsPublic('site-a.staging.example.test', '/')
    expect(page!.noindex).toBe(true)
  })
})

describe('host handling never falls through to another tenant', () => {
  it.each([
    ['an unknown host', 'nobody.example.test', '/'],
    ['a hostile host header', 'site-a.staging.example.test/../site-b', '/'],
    ['an empty host', '', '/'],
    ['a host with userinfo', 'user@site-a.staging.example.test', '/'],
  ])('returns nothing for %s', async (_name, host, path) => {
    expect(await fetchAsPublic(host, path)).toBeNull()
  })

  it('ignores case and port so one tenant has one identity', async () => {
    const page = await fetchAsPublic('Site-A.Staging.Example.Test:3001', '/')
    expect(page!.html).toContain('<h1>Explore the Index</h1>')
  })

  it('returns nothing for an unpublished path on a real host', async () => {
    expect(await fetchAsPublic('site-a.staging.example.test', '/not-a-page')).toBeNull()
  })

  it('serves site B nothing on site A’s host', async () => {
    const pageB = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteB, 'only-b', 'Only B']))
          .rows[0]!.id,
    )
    await db.asUser(s.superAdmin, c => c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [pageB, 0, '[]', '{}']))
    expect(await fetchAsPublic('site-a.staging.example.test', '/only-b')).toBeNull()
  })
})

describe('publishing is visible immediately and never leaks a draft', () => {
  it('shows new content on the next request', async () => {
    await publishHome('A second publication', 'Still complete.')
    const page = await fetchAsPublic('site-a.staging.example.test', '/')
    expect(page!.html).toContain('<h1>A second publication</h1>')
  })

  it('does not show a draft saved after the publish', async () => {
    const rev = await db.asUser(s.editorA, async c =>
      Number(
        (await c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [s.pageA])).rows[0]!.revision,
      ),
    )
    const defId = await db.asUser(
      s.superAdmin,
      async c => (await c.query<{ id: string }>("SELECT id FROM section_defs WHERE slug = 'hero'")).rows[0]!.id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        s.pageA,
        rev,
        JSON.stringify([
          {
            section_def_id: defId,
            section_def_version: 1,
            values: { heading: 'DRAFT ONLY' },
            hidden: false,
            hidden_at: [],
            label: '',
          },
        ]),
        '{}',
      ]),
    )
    const page = await fetchAsPublic('site-a.staging.example.test', '/')
    expect(page!.html).not.toContain('DRAFT ONLY')
    expect(page!.html).toContain('A second publication')
  })

  it('stops serving a page once it is unpublished', async () => {
    const rev = await db.asUser(s.editorA, async c =>
      Number(
        (await c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [s.pageA])).rows[0]!.revision,
      ),
    )
    await db.asUser(s.editorA, c => c.query('SELECT app.unpublish_page($1,$2)', [s.pageA, rev]))
    expect(await fetchAsPublic('site-a.staging.example.test', '/')).toBeNull()
  })
})
