// The refusal nobody was told about.
//
// The canonical policy is settled and safe: an authored canonical naming
// another host is never published, and the page's own address goes out in its
// place. What was missing is the other half. The author typed a URL into the
// SEO panel, the page published, the page looked entirely correct, and the URL
// they typed simply was not there — no error, no warning, nothing to fix. SPEC
// §6.8 has listed `invalid canonical host` among the blocking readiness rules
// the whole time; it was the one rule on that list `runReadinessChecks` did not
// implement, because the check needs the value the author typed and the
// rendered page no longer has it.
//
// So this file asks the two questions that matter about closing that gap:
// does the evaluation now see the refusal, and does the published page still
// contain exactly what it contained before? Feedback was the point; changing
// what goes live was not.
//
// A real database rather than a hand-built manifest, because the thing under
// test is the seam: `evaluateVersionReadiness` is the only place a
// `ReadinessInput` is built, and it builds it from a manifest the database
// produced, a shell the database stored, and a render it performed itself. A
// stub of any of those three would be testing the stub.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { READINESS_POLICY_VERSION } from '@cms/domain'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import {
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  renderPage,
  type RenderManifest,
  type SiteShell,
} from '@cms/renderer'
import { evaluateVersionReadiness, evaluateVersionsReadiness } from '../src/publication.ts'
import { ScratchDatabase } from './database.ts'

const ROOT = '11111111-1111-1111-1111-111111111111'
/** The site's verified live domain, once it has one. */
const VERIFIED = 'example.test'
/** The host that serves it in the meantime, and keeps serving it afterwards. */
const STAGING = 'demo.staging.test'
const PATH = '/about'

let db: ScratchDatabase
let pool: Pool
let siteId: string
let pageId: string
let heroDefId: string

beforeAll(async () => {
  db = await ScratchDatabase.create('canonready')
  pool = db.pool()

  // Bootstrapping the first super admin is a migration-owner act: there is
  // nobody to authorize it yet. Everything after this goes through a command.
  await pool.query(`INSERT INTO app_users (id, email, display_name) VALUES ($1, 'root@example.test', 'Root')`, [ROOT])
  await pool.query(`INSERT INTO global_roles (user_id, role) VALUES ($1, 'super_admin')`, [ROOT])

  await asRoot(async client => {
    siteId = (
      await client.query<{ id: string }>('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'canon',
        'Canonical',
        'resource',
        STAGING,
        JSON.stringify(DEFAULT_THEME_TOKENS),
        '[]',
      ])
    ).rows[0]!.id
    await client.query('SELECT app.publish_theme($1,1)', [siteId])
    await client.query('SELECT app.publish_global_elements($1,1,1)', [siteId])
    await client.query('SELECT app.publish_navigation($1,1)', [siteId])

    // One section that renders an h1, so the only thing this file can be
    // blocked on is the canonical link. The compiled artifacts are the real
    // shapes and the policy stamps are @cms/renderer's own constants — a
    // definition the renderer refuses to walk would fail every test here for a
    // reason that exists only in the fixture.
    heroDefId = (
      await client.query<{ section_def_id: string }>(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          'hero',
          'Hero',
          'Openers',
          '<section class="hero"><h1>{{heading}}</h1></section>',
          '.hero{padding:4rem 1.5rem}',
          '.cms-section--hero .hero{padding:4rem 1.5rem}',
          JSON.stringify({
            nodes: [
              { kind: 'html', value: '<section class="hero"><h1>' },
              { kind: 'slot', slotId: 'heading', slotKind: 'text', context: 'element-text' },
              { kind: 'html', value: '</h1></section>' },
            ],
            policyVersion: SANITIZER_POLICY_VERSION,
            cssPolicyVersion: CSS_POLICY_VERSION,
          }),
          JSON.stringify([{ id: 'heading', kind: 'text', label: 'Heading', constraints: {} }]),
          'hash-hero-1',
          SANITIZER_POLICY_VERSION,
          CSS_POLICY_VERSION,
          'initial',
        ],
      )
    ).rows[0]!.section_def_id

    pageId = (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [siteId, 'about', 'About']))
      .rows[0]!.id
  })
}, 60_000)

afterAll(async () => {
  await db?.close()
})

/** A session belonging to the super admin, which is how the commands are reached. */
async function asRoot<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1,$2,true)', ['app.user_id', ROOT])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * The site shell readiness will read, written straight into the projection.
 *
 * Normally `app.publish_site_shell` builds this and derives `canonical_host`
 * from the site's live primary domain. Going through it would mean seeding a
 * verified domain to say "this site has a live address", which is a test about
 * the domain lifecycle. What is under test here is what readiness does with a
 * shell, so each case states the shell it means.
 */
async function publishShell(canonicalHost: string | null, stagingHost: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO published_site_shells (site_id, revision, payload, updated_at)
     VALUES ($1, 1, $2, now())
     ON CONFLICT (site_id) DO UPDATE
       SET payload = EXCLUDED.payload,
           revision = published_site_shells.revision + 1, updated_at = now()`,
    [
      siteId,
      JSON.stringify({
        site: { id: siteId, name: 'Canonical', slug: 'canon' },
        theme: {},
        navigation: [],
        canonical_host: canonicalHost,
        staging_host: stagingHost,
      }),
    ],
  )
}

/** One immutable version of the page, carrying whatever canonical was authored. */
async function versionWithCanonical(canonical?: string): Promise<string> {
  return asRoot(async client => {
    const revision = (await client.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [pageId]))
      .rows[0]!.revision
    const meta: Record<string, string> = { description: 'What this page is about.' }
    if (canonical !== undefined) meta['canonical'] = canonical
    return (
      await client.query<{ version_id: string }>('SELECT version_id FROM app.save_page_draft($1,$2,$3,$4)', [
        pageId,
        revision,
        JSON.stringify([
          {
            section_def_id: heroDefId,
            section_def_version: 1,
            values: { heading: 'About this site' },
            hidden: false,
            hidden_at: [],
            label: 'Hero',
          },
        ]),
        JSON.stringify(meta),
      ])
    ).rows[0]!.version_id
  })
}

/** The document the public renderer would serve on the live domain. */
async function publishedHtml(versionId: string): Promise<string> {
  const manifest = (
    await pool.query<{ manifest: RenderManifest }>('SELECT app.build_render_manifest_internal($1) AS manifest', [
      versionId,
    ])
  ).rows[0]!.manifest
  const shell = (
    await pool.query<{ payload: SiteShell }>('SELECT payload FROM published_site_shells WHERE site_id = $1', [siteId])
  ).rows[0]!.payload
  return renderPage({
    manifest,
    shell,
    isStaging: false,
    options: { canonicalBase: `https://${VERIFIED}` },
  }).html
}

describe('a canonical the renderer refused is now a blocking readiness problem', () => {
  it('refuses a version whose canonical names somebody else’s host', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical('https://evil.test/hijack')

    const report = await evaluateVersionReadiness(pool, version, 'worker')
    expect(report.blocking.map(f => f.rule)).toEqual(['refused_canonical'])
    expect(report.ok).toBe(false)
  })

  it('tells the author what they wrote, why it was refused, and what happens instead', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical('https://evil.test/hijack')

    const [finding] = (await evaluateVersionReadiness(pool, version, 'worker')).blocking
    expect(finding!.message).toContain('https://evil.test/hijack')
    expect(finding!.message).toContain('evil.test')
    expect(finding!.message).toContain(VERIFIED)
    expect(finding!.message).toContain('its own address')
  })

  it('refuses a deceptive suffix, which is the case a string comparison would pass', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical(`https://${VERIFIED}.evil.test/x`)

    const report = await evaluateVersionReadiness(pool, version, 'worker')
    expect(report.blocking.map(f => f.rule)).toEqual(['refused_canonical'])
  })

  it('says nothing about the canonical when the authored value names this site', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical(`https://${VERIFIED}/elsewhere`)

    const report = await evaluateVersionReadiness(pool, version, 'worker')
    expect(report.findings).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('says nothing about the canonical when the page never set one', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical()

    const report = await evaluateVersionReadiness(pool, version, 'worker')
    expect(report.findings).toEqual([])
  })

  it('stamps the policy version the verdict was reached under', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical('https://evil.test/hijack')

    const report = await evaluateVersionReadiness(pool, version, 'worker')
    expect(report.policyVersion).toBe(READINESS_POLICY_VERSION)
  })

  it('reaches the same verdict for the editor as for the scheduler', async () => {
    // The parity this module exists to guarantee (D17). Both doors build the
    // manifest through a different function; neither may reach a different
    // conclusion about the same immutable version.
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical('https://evil.test/hijack')

    const asMember = await asRoot(client => evaluateVersionReadiness(client, version, 'member'))
    const asWorker = await evaluateVersionReadiness(pool, version, 'worker')
    expect(asMember).toEqual(asWorker)
  })
})

describe('the rule adds feedback and changes nothing that is published', () => {
  it('still puts the page’s own address where the refused one was asked for', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical('https://evil.test/hijack')

    const html = await publishedHtml(version)
    expect(html).toContain(`<link rel="canonical" href="https://${VERIFIED}${PATH}">`)
    expect(html).toContain(`<meta property="og:url" content="https://${VERIFIED}${PATH}">`)
    expect(html).not.toContain('evil.test')
  })

  it('still publishes an accepted canonical exactly as the policy normalized it', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical(`https://${VERIFIED.toUpperCase()}.:443/elsewhere`)

    const html = await publishedHtml(version)
    expect(html).toContain(`<link rel="canonical" href="https://${VERIFIED}/elsewhere">`)
  })
})

describe('a staging evaluation names the verified live address whenever there is one', () => {
  it('judges an authored canonical against the live host rather than the serving one', async () => {
    // The staging host is not the site's identity once a domain is verified, so
    // naming it is refused by the same host comparison as any other host — and
    // the fallback is the live address, not the staging one (SPEC §6.10).
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical(`https://${STAGING}${PATH}`)

    const report = await evaluateVersionReadiness(pool, version, 'worker')
    expect(report.blocking.map(f => f.rule)).toEqual(['refused_canonical'])
    expect(report.blocking[0]!.message).toContain(VERIFIED)
    expect(await publishedHtml(version)).toContain(`<link rel="canonical" href="https://${VERIFIED}${PATH}">`)
  })

  it('accepts the live address even though a staging host is what serves the render', async () => {
    await publishShell(VERIFIED, STAGING)
    const version = await versionWithCanonical(`https://${VERIFIED}${PATH}`)

    expect((await evaluateVersionReadiness(pool, version, 'worker')).ok).toBe(true)
  })

  it('treats the staging origin as the site’s address while no domain is verified', async () => {
    await publishShell(null, STAGING)
    const version = await versionWithCanonical(`https://${STAGING}${PATH}`)

    expect((await evaluateVersionReadiness(pool, version, 'worker')).ok).toBe(true)
  })

  it('still reaches a verdict about a foreign canonical before any domain is verified', async () => {
    // The reason this evaluation renders with the staging origin. Without one
    // it has no site identity to measure an authored canonical against, reaches
    // no verdict at all, and stays silent about a value the staging render in
    // front of readers is already refusing.
    await publishShell(null, STAGING)
    const version = await versionWithCanonical('https://evil.test/hijack')

    const report = await evaluateVersionReadiness(pool, version, 'worker')
    expect(report.blocking.map(f => f.rule)).toEqual(['refused_canonical'])
    expect(report.blocking[0]!.message).toContain(STAGING)
  })
})

describe('release readiness facts stay within one unchanged phase', () => {
  it('keeps every candidate report identical while reading shared facts once', async () => {
    await publishShell(VERIFIED, STAGING)
    const versions = [
      await versionWithCanonical('https://other.test/about'),
      await versionWithCanonical('https://' + VERIFIED + PATH),
    ]
    await asRoot(async client => {
      await client.query('SELECT app.lock_release_site($1)', [siteId])
      const expected = []
      for (const version of versions) expected.push(await evaluateVersionReadiness(client, version, 'member'))
      const query = vi.spyOn(client, 'query')
      try {
        const actual = await evaluateVersionsReadiness(
          client,
          versions.map(versionId => ({ versionId, access: 'member' })),
        )
        expect(actual).toEqual(expected)
        const statements = query.mock.calls.map(call => String(call[0]))
        expect(statements.filter(sql => sql.startsWith('SELECT payload FROM published_site_shells'))).toHaveLength(1)
        expect(statements.filter(sql => sql.startsWith('SELECT page_id,path,ARRAY'))).toHaveLength(1)
        expect(statements.filter(sql => sql.startsWith("SELECT '/'||COALESCE(p.slug"))).toHaveLength(1)
        expect(statements.filter(sql => sql.includes('SELECT app.build_render_manifest('))).toHaveLength(2)
      } finally {
        query.mockRestore()
      }
    })
  })

  it('reads fresh facts after the same transaction changes its future projection', async () => {
    await publishShell(VERIFIED, STAGING)
    const versionId = await versionWithCanonical('https://' + VERIFIED + PATH)
    await asRoot(async client => {
      await client.query('SELECT app.lock_release_site($1)', [siteId])
      const before = await evaluateVersionsReadiness(client, [{ versionId, access: 'member' }])
      expect(before[0]!.blocking).toEqual([])
      await client.query(
        "UPDATE published_site_shells SET payload=jsonb_set(payload,'{canonical_host}',to_jsonb('different.test'::text)) WHERE site_id=$1",
        [siteId],
      )
      const after = await evaluateVersionsReadiness(client, [{ versionId, access: 'member' }])
      expect(after[0]).toEqual(await evaluateVersionReadiness(client, versionId, 'member'))
      expect(after[0]!.blocking.map(finding => finding.rule)).toEqual(['refused_canonical'])
      expect(after).not.toEqual(before)
    })
  })
})
