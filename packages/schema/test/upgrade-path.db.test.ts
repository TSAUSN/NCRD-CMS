// The upgrade path, with rows that really were written under the old policies.
//
// Migrations from empty prove the schema is coherent. They prove nothing about
// the case that actually happens to a running system: a database with rows in
// it, written by code that no longer exists. So this builds those rows the way
// the old commands did, runs the migration over them, and checks both halves —
// that nothing published changed, and that nothing stale can be published.
//
// Three eras are seeded, because they fail differently and the difference is
// the whole point of the reporting:
//
//   * Before 0013, `source_css` was the only CSS column and held whichever form
//     the caller happened to store. Nothing can tell authored from compiled by
//     looking, so these are not recoverable and have to be reported as needing
//     an author rather than guessed at.
//   * At 0014, CSS policy 5. The stylesheet is correctly scoped and the AST is
//     current; the only stale thing is which policy vouched for it. These are
//     recoverable, and revalidation is what recovers them.
//   * Also at 0014, a slug written before `app.is_section_slug` existed. A slug
//     becomes a CSS class name, so one that is not a slug has no scope its
//     stylesheet could be confined to — and renaming it changes a class name on
//     a live page, which is an editorial decision and not a script's to make.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { migrate } from '../src/migrate/index.ts'
import { requireTestDatabase } from './harness.ts'

const DB = 'cms_upgrade_path'
const ROOT = '11111111-1111-1111-1111-111111111111'
/** What migration 0013 copied into `compiled_css` and could not label. */
const PRE_SPLIT_CSS = '.cms-section .legacy{padding:1rem}'

let admin: Client
let client: Client
let url = ''
let legacyDefId = ''
let policy5DefId = ''
let oldSlugDefId = ''
let stalePageVersion = ''

const SLOTS = JSON.stringify([{ id: 'body', kind: 'text', label: 'Body', constraints: {} }])

/** An AST of the era named by `policyVersion`, structurally the same shape. */
function astFor(className: string, policyVersion: number, cssPolicyVersion: number): string {
  return JSON.stringify({
    nodes: [
      { kind: 'html', value: `<section class="${className}"><p>` },
      { kind: 'slot', slotId: 'body', slotKind: 'text', context: 'element-text' },
      { kind: 'html', value: '</p></section>' },
    ],
    policyVersion,
    cssPolicyVersion,
  })
}

async function seedDefinition(input: {
  slug: string
  name: string
  sourceCss: string
  compiledCss: string
  sanitizerPolicyVersion: number
  cssPolicyVersion: number | null
}): Promise<string> {
  const def = await client.query<{ id: string }>(
    `
    INSERT INTO section_defs (scope, slug, name, category, created_by)
    VALUES ('global', $1, $2, 'Test', $3) RETURNING id`,
    [input.slug, input.name, ROOT],
  )
  const defId = def.rows[0]!.id
  await client.query(
    `
    INSERT INTO section_def_versions
      (section_def_id, version, source_html, source_css, compiled_css, compiled_ast, slots,
       sanitizer_policy_version, css_policy_version, render_hash, carries_trusted_code, changelog)
    VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, false, 'seeded')`,
    [
      defId,
      `<section class="${input.slug}"><p>{{body}}</p></section>`,
      input.sourceCss,
      input.compiledCss,
      astFor(input.slug, input.sanitizerPolicyVersion, input.cssPolicyVersion ?? 0),
      SLOTS,
      input.sanitizerPolicyVersion,
      input.cssPolicyVersion,
      `hash-${input.slug}`,
    ],
  )
  return defId
}

beforeAll(async () => {
  admin = new Client({ connectionString: requireTestDatabase() })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${DB}`)
  const parsed = new URL(requireTestDatabase())
  parsed.pathname = `/${DB}`
  url = parsed.toString()
  client = new Client({ connectionString: url })
  await client.connect()

  // ---- the era before the authored/compiled split -------------------------
  // Stop before the migrations under test, so the row can be written the way
  // the code of that era wrote it: one CSS column, holding compiled output.
  await migrate(url, { through: '0011_readiness_is_explicit.sql' })
  await client.query(
    `
    INSERT INTO app_users (id, email, display_name)
    VALUES ($1, 'root@example.test', 'Root')`,
    [ROOT],
  )
  const legacy = await client.query<{ id: string }>(
    `
    INSERT INTO section_defs (scope, slug, name, category, created_by)
    VALUES ('global', 'legacy', 'Legacy', 'Test', $1) RETURNING id`,
    [ROOT],
  )
  legacyDefId = legacy.rows[0]!.id
  await client.query(
    `
    INSERT INTO section_def_versions
      (section_def_id, version, source_html, source_css, compiled_ast, slots,
       sanitizer_policy_version, render_hash, carries_trusted_code, changelog)
    VALUES ($1, 1, '<section class="legacy"><p>{{body}}</p></section>', $2, $3, $4, 2, 'legacy-hash', false, 'seeded')`,
    [legacyDefId, PRE_SPLIT_CSS, astFor('legacy', 2, 3), SLOTS],
  )

  // ---- the CSS policy 5 era ----------------------------------------------
  // Stop again at the last migration that emitted CSS policy 5. These rows are
  // correct in every way except which policy checked them, which is exactly the
  // case a bump exists to report.
  await migrate(url, { through: '0014_slot_grammar_and_css_scope.sql' })
  policy5DefId = await seedDefinition({
    slug: 'brochure',
    name: 'Brochure',
    sourceCss: '.brochure{padding:1rem}',
    compiledCss: '.cms-section--brochure .brochure{padding:1rem}',
    sanitizerPolicyVersion: 4,
    cssPolicyVersion: 5,
  })
  // A slug from before the grammar. `Legacy_Slug` was storable then and is not
  // a slug now, and the difference is not cosmetic: `.cms-section--Legacy_Slug`
  // is a class name this row's stylesheet cannot be checked against.
  oldSlugDefId = await seedDefinition({
    slug: 'Legacy_Slug',
    name: 'Old Slug',
    sourceCss: '.old{padding:1rem}',
    compiledCss: '.cms-section--Legacy_Slug .old{padding:1rem}',
    sanitizerPolicyVersion: 4,
    cssPolicyVersion: 5,
  })

  // A page pinned to the policy-5 definition, so the manifest builder has
  // something real to refuse.
  const site = await client.query<{ id: string }>(
    `
    INSERT INTO sites (slug, name, kind, created_by) VALUES ('upgrade', 'Upgrade', 'resource', $1)
    RETURNING id`,
    [ROOT],
  )
  const page = await client.query<{ id: string }>(
    `
    INSERT INTO pages (site_id, slug, title) VALUES ($1, 'brochure', 'Brochure') RETURNING id`,
    [site.rows[0]!.id],
  )
  const version = await client.query<{ id: string }>(
    `
    INSERT INTO page_versions (site_id, page_id, revision, content, kind, author_id)
    VALUES ($1, $2, 1, $3, 'checkpoint', $4) RETURNING id`,
    [
      site.rows[0]!.id,
      page.rows[0]!.id,
      JSON.stringify([
        {
          section_def_id: policy5DefId,
          section_def_version: 1,
          values: { body: 'x' },
          hidden: false,
          hidden_at: [],
          label: 'Brochure',
        },
      ]),
      ROOT,
    ],
  )
  stalePageVersion = version.rows[0]!.id
  await client.query('UPDATE pages SET draft_version_id = $2, revision = 1 WHERE id = $1', [
    page.rows[0]!.id,
    stalePageVersion,
  ])

  // ---- and now every migration that came after --------------------------
  await migrate(url)
}, 60_000)

afterAll(async () => {
  await client?.end()
  await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`)
  await admin?.end()
})

describe('legacy rows survive the policy bumps without changing what they publish', () => {
  it('migrates a policy-2 / policy-3 definition and then refuses to publish it', async () => {
    const row = await client.query<{
      source_css: string
      compiled_css: string
      css_policy_version: number | null
    }>('SELECT source_css, compiled_css, css_policy_version FROM section_def_versions WHERE section_def_id = $1', [
      legacyDefId,
    ])

    // What it publishes is byte-identical to what it published before: the
    // column moved, the content did not.
    expect(row.rows[0]!.compiled_css).toBe(PRE_SPLIT_CSS)
    // The authored column is untouched — no data was lost or rewritten.
    expect(row.rows[0]!.source_css).toBe(PRE_SPLIT_CSS)
    // And its provenance is recorded as unknown rather than assumed.
    expect(row.rows[0]!.css_policy_version).toBeNull()
  })

  it('reports the legacy row as needing an author, not as recoverable', async () => {
    const { rows } = await client.query<{
      slug: string
      defect: string
      authored_css_recoverable: boolean
    }>('SELECT * FROM app.section_definitions_needing_revalidation()')
    const legacy = rows.find(r => r.slug === 'legacy')
    expect(legacy).toBeDefined()
    // The source column may hold either form and nothing can tell by looking,
    // so recompiling it would either double-scope the definition or publish
    // unscoped CSS. Saying so beats guessing.
    expect(legacy!.authored_css_recoverable).toBe(false)
  })

  it('says the CSS provenance is unknown, under the sanitizer defect reported first', async () => {
    // `section_definitions_needing_revalidation()` COALESCEs the two gates and
    // reports whichever answers first, so this row is listed for its policy-2
    // AST and its missing CSS provenance is not in the text at all. That is why
    // `authored_css_recoverable` is a separate column and not a re-reading of
    // the defect: it is the only thing that tells an operator `--apply` must
    // not touch this row, and it stays true after the AST is dealt with.
    const { rows } = await client.query<{ slug: string; defect: string }>(
      'SELECT * FROM app.section_definitions_needing_revalidation()',
    )
    expect(rows.find(r => r.slug === 'legacy')!.defect).toContain('sanitizer policy version 2')

    const css = await client.query<{ defect: string | null }>(
      `
      SELECT app.compiled_css_defect(dv.compiled_css, dv.css_policy_version,
                                     '.cms-section--' || d.slug) AS defect
        FROM section_def_versions dv JOIN section_defs d ON d.id = dv.section_def_id
       WHERE dv.section_def_id = $1`,
      [legacyDefId],
    )
    expect(css.rows[0]!.defect).toContain('no CSS policy version')
  })

  it('is idempotent: running the migrations again changes nothing', async () => {
    const before = await client.query('SELECT name, checksum FROM cms_migrations ORDER BY name')
    const applied = await migrate(url)
    expect(applied.filter(m => !m.alreadyApplied)).toEqual([])
    const after = await client.query('SELECT name, checksum FROM cms_migrations ORDER BY name')
    expect(after.rows).toEqual(before.rows)
  }, 60_000)
})

describe('a definition stored under CSS policy 5', () => {
  // The renderer's half of this — `compiledCssProblems` refusing the same row —
  // is asserted in @cms/platform's css-conformance.db.test.ts, because
  // @cms/renderer depends on @cms/schema and cannot be imported from here.

  it('is listed as needing revalidation, and says which version it was compiled under', async () => {
    const { rows } = await client.query<{
      slug: string
      css_policy_version: number | null
      defect: string
      authored_css_recoverable: boolean
    }>('SELECT * FROM app.section_definitions_needing_revalidation()')
    const brochure = rows.find(r => r.slug === 'brochure')
    expect(brochure).toBeDefined()
    expect(brochure!.css_policy_version).toBe(5)
    expect(brochure!.defect).toContain('CSS policy version 5')
    expect(brochure!.defect).toContain('requires version 6')
    // Authored and compiled CSS are separate columns for this row, so a
    // recompile has something to recompile *from*.
    expect(brochure!.authored_css_recoverable).toBe(true)
  })

  it('cannot build a render manifest, so it can neither preview nor publish', async () => {
    await expect(
      client.query('SELECT app.build_render_manifest_internal($1)', [stalePageVersion]),
    ).rejects.toMatchObject({ code: 'CMS04' })
  })

  it('becomes valid once revalidation restamps it', async () => {
    // The stylesheet is already what CSS policy 6 would emit — 0015 changed how
    // a scope is *compared*, not what a scope looks like — so a real recompile
    // produces these same bytes and only the version stamp moves. Passing the
    // stored artifacts back in is that recompile's outcome, and the command
    // re-runs both gates on them before believing it.
    const stored = await client.query<{ compiled_ast: unknown; compiled_css: string }>(
      'SELECT compiled_ast, compiled_css FROM section_def_versions WHERE section_def_id = $1',
      [policy5DefId],
    )
    const { rows } = await client.query<{ audit_id: string | null }>(
      'SELECT app.revalidate_section_def_version($1,$2,$3,$4,$5,$6,$7) AS audit_id',
      [
        policy5DefId,
        1,
        JSON.stringify(stored.rows[0]!.compiled_ast),
        stored.rows[0]!.compiled_css,
        'hash-brochure-revalidated',
        4,
        6,
      ],
    )
    expect(rows[0]!.audit_id).not.toBeNull()

    const still = await client.query<{ slug: string }>(
      'SELECT slug FROM app.section_definitions_needing_revalidation()',
    )
    expect(still.rows.map(r => r.slug)).not.toContain('brochure')
    await expect(
      client.query('SELECT app.build_render_manifest_internal($1)', [stalePageVersion]),
    ).resolves.toBeDefined()
  })

  it('left an audit row saying what it changed, and from what', async () => {
    // A revalidation rewrites the compiled AST, the compiled CSS, the render
    // hash and both policy stamps of a version that is otherwise immutable.
    // Without this row there is no answer anywhere in the database to "why does
    // this version's render hash differ from the one we shipped".
    const { rows } = await client.query<{ actor_type: string; detail: Record<string, unknown> }>(
      `SELECT actor_type, detail FROM audit_log
        WHERE action = 'section_def.revalidate' AND item_id = $1`,
      [policy5DefId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.actor_type).toBe('migration')
    expect(rows[0]!.detail).toMatchObject({
      slug: 'brochure',
      version: 1,
      before: { render_hash: 'hash-brochure', css_policy_version: 5, sanitizer_policy_version: 4 },
      after: { render_hash: 'hash-brochure-revalidated', css_policy_version: 6, sanitizer_policy_version: 4 },
    })
  })

  it('writes no second audit row when there is nothing left to change', async () => {
    const stored = await client.query<{ compiled_ast: unknown; compiled_css: string; render_hash: string }>(
      'SELECT compiled_ast, compiled_css, render_hash FROM section_def_versions WHERE section_def_id = $1',
      [policy5DefId],
    )
    const { rows } = await client.query<{ audit_id: string | null }>(
      'SELECT app.revalidate_section_def_version($1,$2,$3,$4,$5,$6,$7) AS audit_id',
      [
        policy5DefId,
        1,
        JSON.stringify(stored.rows[0]!.compiled_ast),
        stored.rows[0]!.compiled_css,
        stored.rows[0]!.render_hash,
        4,
        6,
      ],
    )
    expect(rows[0]!.audit_id).toBeNull()
    const audit = await client.query(
      `SELECT id FROM audit_log WHERE action = 'section_def.revalidate' AND item_id = $1`,
      [policy5DefId],
    )
    expect(audit.rows).toHaveLength(1)
  })

  it('refuses to restamp artifacts that do not pass the gates', async () => {
    // The stamp is not the check. A caller that hands over a current version
    // number and an artifact from an older policy is asking the database to
    // vouch for something it has not looked at.
    await expect(
      client.query('SELECT app.revalidate_section_def_version($1,$2,$3,$4,$5,$6,$7)', [
        policy5DefId,
        1,
        astFor('brochure', 4, 6),
        '.cms-section--brochure .a,body{display:none}',
        'hash-x',
        4,
        6,
      ]),
    ).rejects.toMatchObject({ code: 'CMS04' })
  })
})

describe('a slug that predates the grammar', () => {
  it('is listed by the view that exists to find them', async () => {
    const { rows } = await client.query<{ slug: string }>('SELECT slug FROM app.section_slugs_out_of_grammar')
    expect(rows.map(r => r.slug)).toContain('Legacy_Slug')
  })

  it('is reported as needing revalidation, because its CSS cannot be checked', async () => {
    const { rows } = await client.query<{ slug: string; defect: string }>(
      'SELECT * FROM app.section_definitions_needing_revalidation()',
    )
    expect(rows.map(r => r.slug)).toContain('Legacy_Slug')
  })

  it('cannot be revalidated, because there is no scope its CSS could be confined to', async () => {
    // Refused rather than repaired. Renaming it would change a class name that
    // a published page is already using, which is a decision for a person.
    const error = await client
      .query('SELECT app.revalidate_section_def_version($1,$2,$3,$4,$5,$6,$7)', [
        oldSlugDefId,
        1,
        astFor('old', 4, 6),
        '.cms-section--Legacy_Slug .old{padding:1rem}',
        'hash-x',
        4,
        6,
      ])
      .catch((e: Error & { code?: string }) => e)
    expect((error as { code?: string }).code).toBe('CMS04')
    expect((error as Error).message).toContain('not a usable slug')
  })

  it('is left exactly as it was after being refused', async () => {
    const { rows } = await client.query<{ css_policy_version: number | null; render_hash: string }>(
      'SELECT css_policy_version, render_hash FROM section_def_versions WHERE section_def_id = $1',
      [oldSlugDefId],
    )
    expect(rows[0]!.css_policy_version).toBe(5)
    expect(rows[0]!.render_hash).toBe('hash-Legacy_Slug')
  })
})
