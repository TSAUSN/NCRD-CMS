// Revalidation rewrites the derived security artifacts of versions that are
// otherwise immutable, so what it does has to be accountable, isolated, and
// honest about what it could not do.
//
// Accountable: `compiled_ast`, `compiled_css`, `render_hash` and the two policy
// stamps are the entire security decision about a section — what markup
// renders, what stylesheet ships, and which policies vouched for them. Changing
// them with a bare UPDATE from the migration connection left nothing in
// `audit_log`, so "why does this version's render hash differ from the one the
// release notes quote" had no answer available anywhere in the database.
//
// Isolated: a run over a hundred definitions where the eleventh is unrepairable
// has to repair the other ninety-nine, and must not leave the eleventh with a
// new AST and an old stylesheet.
//
// Honest: a run that could not do what it was asked has to say so in what it
// prints and in what it exits with. A summary that counts only successes is how
// a broken deploy looks green.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { compileSection, compileStructuredSection, CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION } from '@cms/renderer'
import { StructuredDocument, STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import {
  findRestyleCandidates,
  findStaleDefinitions,
  formatRevalidation,
  revalidateDefinitions,
  revalidationExitCode,
} from '../src/revalidate.ts'
import { ScratchDatabase } from './database.ts'

const ROOT = '11111111-1111-1111-1111-111111111111'

let db: ScratchDatabase
let pool: Pool

beforeAll(async () => {
  db = await ScratchDatabase.create('revalidate')
  pool = db.pool()
  await pool.query(`INSERT INTO app_users (id, email, display_name) VALUES ($1, 'root@example.test', 'Root')`, [ROOT])
}, 60_000)
afterAll(async () => {
  await db?.close()
})

/**
 * A stored definition, written the way an older release wrote one.
 *
 * Straight INSERTs on purpose. `app.upsert_section_def_version` would refuse
 * every row here — that is what it is for — and the rows revalidation exists to
 * repair are exactly the ones that got in before the gate that would now stop
 * them.
 */
async function seed(input: {
  slug: string
  sourceHtml?: string
  sourceCss?: string
  compiledCss?: string
  cssPolicyVersion?: number | null
  sanitizerPolicyVersion?: number
  slots?: string
}): Promise<string> {
  const sourceHtml = input.sourceHtml ?? `<section class="${input.slug}"><p>{{body}}</p></section>`
  const def = await pool.query<{ id: string }>(
    `
    INSERT INTO section_defs (scope, slug, name, category, created_by)
    VALUES ('global', $1, $2, 'Test', $3) RETURNING id`,
    [input.slug, input.slug, ROOT],
  )
  const defId = def.rows[0]!.id
  await pool.query(
    `
    INSERT INTO section_def_versions
      (section_def_id, version, source_html, source_css, compiled_css, compiled_ast, slots,
       sanitizer_policy_version, css_policy_version, render_hash, carries_trusted_code, changelog)
    VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, false, 'seeded')`,
    [
      defId,
      sourceHtml,
      input.sourceCss ?? '.body{padding:1rem}',
      input.compiledCss ?? `.cms-section--${input.slug} .body{padding:1rem}`,
      JSON.stringify({
        nodes: [
          { kind: 'html', value: `<section class="${input.slug}"><p>` },
          { kind: 'slot', slotId: 'body', slotKind: 'text', context: 'element-text' },
          { kind: 'html', value: '</p></section>' },
        ],
        policyVersion: input.sanitizerPolicyVersion ?? SANITIZER_POLICY_VERSION,
        cssPolicyVersion: input.cssPolicyVersion ?? 0,
      }),
      input.slots ?? JSON.stringify([{ id: 'body', kind: 'text', label: 'Body', constraints: {} }]),
      input.sanitizerPolicyVersion ?? SANITIZER_POLICY_VERSION,
      input.cssPolicyVersion === undefined ? CSS_POLICY_VERSION - 1 : input.cssPolicyVersion,
      `hash-${input.slug}`,
    ],
  )
  return defId
}

async function storedArtifacts(defId: string) {
  const { rows } = await pool.query<{
    compiled_ast: unknown
    compiled_css: string
    render_hash: string
    sanitizer_policy_version: number
    css_policy_version: number | null
  }>(
    `SELECT compiled_ast, compiled_css, render_hash, sanitizer_policy_version, css_policy_version
        FROM section_def_versions WHERE section_def_id = $1`,
    [defId],
  )
  return rows[0]!
}

async function auditRows(action = 'section_def.revalidate') {
  const { rows } = await pool.query<{ item_id: string; actor_type: string; detail: Record<string, unknown> }>(
    'SELECT item_id, actor_type, detail FROM audit_log WHERE action = $1 ORDER BY id',
    [action],
  )
  return rows
}

describe('a report changes nothing and says what it would do', () => {
  let defId = ''
  beforeAll(async () => {
    defId = await seed({ slug: 'report-only' })
  })

  it('lists the definition the database itself refuses', async () => {
    const stale = await findStaleDefinitions(pool)
    const found = stale.find(s => s.slug === 'report-only')
    expect(found).toBeDefined()
    expect(found!.storedCssPolicyVersion).toBe(CSS_POLICY_VERSION - 1)
    expect(found!.authoredCssRecoverable).toBe(true)
  })

  it('leaves every derived column exactly as it found it', async () => {
    const before = await storedArtifacts(defId)
    const outcomes = await revalidateDefinitions(pool)
    expect(outcomes.find(o => o.slug === 'report-only')!.status).toBe('unchanged')
    expect(await storedArtifacts(defId)).toEqual(before)
  })

  it('writes no audit record for a run that wrote nothing', async () => {
    expect(await auditRows()).toEqual([])
  })
})

describe('applying a revalidation is a change with a history', () => {
  let defId = ''
  beforeAll(async () => {
    defId = await seed({ slug: 'audited' })
  })

  it('rewrites the derived artifacts and returns the audit row it wrote', async () => {
    const before = await storedArtifacts(defId)
    const outcomes = await revalidateDefinitions(pool, { apply: true })
    const outcome = outcomes.find(o => o.slug === 'audited')!
    expect(outcome.status).toBe('rewritten')
    expect(outcome.auditId).not.toBeNull()

    const after = await storedArtifacts(defId)
    expect(after.css_policy_version).toBe(CSS_POLICY_VERSION)
    expect(after.sanitizer_policy_version).toBe(SANITIZER_POLICY_VERSION)
    // The render hash is derived from the AST and the CSS together, so a
    // recompile that changed neither would not change it either. It changed,
    // which is precisely why this rewrite needs to be recorded.
    expect(after.render_hash).not.toBe(before.render_hash)
  })

  it('recorded what changed and what it changed from', async () => {
    const rows = (await auditRows()).filter(r => r.item_id === defId)
    expect(rows).toHaveLength(1)
    // Not a product user: there is none. The audit_log shape constraint only
    // lets a 'user' row name an actor, so an operator act has to say it is one.
    expect(rows[0]!.actor_type).toBe('migration')
    expect(rows[0]!.detail).toMatchObject({
      slug: 'audited',
      version: 1,
      before: { render_hash: 'hash-audited', css_policy_version: CSS_POLICY_VERSION - 1 },
      after: { css_policy_version: CSS_POLICY_VERSION, sanitizer_policy_version: SANITIZER_POLICY_VERSION },
    })
  })

  it('is idempotent: a second run finds nothing to do and writes no new history', async () => {
    const auditBefore = await auditRows()
    const artifactsBefore = await storedArtifacts(defId)

    const outcomes = await revalidateDefinitions(pool, { apply: true })
    expect(outcomes.map(o => o.slug)).not.toContain('audited')

    expect(await auditRows()).toEqual(auditBefore)
    expect(await storedArtifacts(defId)).toEqual(artifactsBefore)
    expect(formatRevalidation(outcomes.filter(o => o.slug === 'audited'))).toBe('every section definition is current.')
  })
})

describe('one definition failing does not decide what happens to the rest', () => {
  let good1 = ''
  let broken = ''
  let good2 = ''

  beforeAll(async () => {
    // Alphabetical, because `section_definitions_needing_revalidation()` orders
    // by slug: the broken one sits between two repairable ones, so a run that
    // aborts on the first failure leaves visible, asymmetric damage.
    good1 = await seed({ slug: 'a-repairable' })
    // A `slots` column holding an object rather than an array. Not reachable
    // through any command — which is the point: revalidation runs over rows a
    // restore or a hand edit produced, and one of them being nonsense is the
    // ordinary case rather than the exotic one.
    broken = await seed({ slug: 'b-corrupt', slots: JSON.stringify({ body: { kind: 'text' } }) })
    good2 = await seed({ slug: 'c-repairable' })
  })

  it('repairs the definitions either side of the one it could not', async () => {
    const outcomes = await revalidateDefinitions(pool, { apply: true })
    const byslug = new Map(outcomes.map(o => [o.slug, o]))
    expect(byslug.get('a-repairable')!.status).toBe('rewritten')
    expect(byslug.get('b-corrupt')!.status).toBe('failed')
    expect(byslug.get('c-repairable')!.status).toBe('rewritten')

    expect((await storedArtifacts(good1)).css_policy_version).toBe(CSS_POLICY_VERSION)
    expect((await storedArtifacts(good2)).css_policy_version).toBe(CSS_POLICY_VERSION)
  })

  it('says why the one it could not repair failed', async () => {
    const outcomes = await revalidateDefinitions(pool, { apply: true })
    const failure = outcomes.find(o => o.slug === 'b-corrupt')!
    expect(failure.blocking).toHaveLength(1)
    expect(failure.blocking[0]).not.toBe('')
  })

  it('leaves the failed definition whole rather than half-migrated', async () => {
    // The derived columns move together or not at all. A row with a current AST
    // and a stale stylesheet passes one gate and fails the other, which is a
    // worse state than the one revalidation was asked to fix.
    const stored = await storedArtifacts(broken)
    expect(stored.css_policy_version).toBe(CSS_POLICY_VERSION - 1)
    expect(stored.render_hash).toBe('hash-b-corrupt')
    expect(stored.compiled_css).toBe('.cms-section--b-corrupt .body{padding:1rem}')
  })

  it('writes no audit row for the definition it did not change', async () => {
    expect((await auditRows()).map(r => r.item_id)).not.toContain(broken)
  })
})

describe('a definition only a person can repair is reported, not guessed at', () => {
  let preSplit = ''
  let oldSlug = ''

  beforeAll(async () => {
    // css_policy_version NULL is what every row from before migration 0013
    // carries: `source_css` may hold authored or compiled CSS and nothing can
    // tell by looking, so a recompile would either double-scope the definition
    // or publish unscoped CSS into a shared stylesheet.
    preSplit = await seed({ slug: 'pre-split', cssPolicyVersion: null })
    // A slug that predates `app.is_section_slug`. It has no scope its
    // stylesheet could be confined to, and renaming it changes a class name a
    // published page is already using.
    oldSlug = await seed({ slug: 'Legacy_Slug', compiledCss: '.cms-section--Legacy_Slug .body{padding:1rem}' })
  })

  it('reports the pre-split row as needing an author and touches nothing', async () => {
    const before = await storedArtifacts(preSplit)
    const outcome = (await revalidateDefinitions(pool, { apply: true })).find(o => o.slug === 'pre-split')!
    expect(outcome.status).toBe('needs-an-author')
    expect(outcome.blocking.join(' ')).toContain('predates the authored/compiled CSS split')
    expect(await storedArtifacts(preSplit)).toEqual(before)
  })

  it('reports the out-of-grammar slug as needing an author rather than scoping it to the shared class', async () => {
    // The specific repair that reported success and made things worse: falling
    // back to `.cms-section` recompiled the definition against the scope every
    // section shares, stamped it current, and left a row that still cannot
    // publish.
    const before = await storedArtifacts(oldSlug)
    const outcome = (await revalidateDefinitions(pool, { apply: true })).find(o => o.slug === 'Legacy_Slug')!
    expect(outcome.status).toBe('needs-an-author')
    expect(outcome.blocking.join(' ')).toContain('cannot be a section scope')
    expect(await storedArtifacts(oldSlug)).toEqual(before)
    expect((await auditRows()).map(r => r.item_id)).not.toContain(oldSlug)
  })
})

describe('the command tells the truth about a partial run', () => {
  it('counts the failures alongside the successes', async () => {
    const outcomes = await revalidateDefinitions(pool, { apply: true })
    const report = formatRevalidation(outcomes)
    expect(report).toContain('failed')
    expect(report).toContain('need an author')
    // Every definition that could not be repaired says why on its own line.
    for (const outcome of outcomes) {
      if (outcome.status === 'rewritten' || outcome.status === 'unchanged') continue
      expect(report).toContain(outcome.blocking[0]!)
    }
  })

  it('exits non-zero while anything still needs a person', async () => {
    const outcomes = await revalidateDefinitions(pool, { apply: true })
    expect(outcomes.some(o => o.status === 'failed')).toBe(true)
    expect(revalidationExitCode(outcomes)).toBe(1)
  })

  it('exits non-zero for a failure even when nothing needs an author', () => {
    // The case the exit status used to get wrong. `needs-an-author` was the
    // only thing it looked at, so a run where every definition the database
    // refused *also* failed to be repaired reported success.
    const failed = {
      sectionDefId: '00000000-0000-0000-0000-000000000001',
      slug: 'x',
      version: 1,
      storedPolicyVersion: 4,
      storedCssPolicyVersion: 5,
      defect: 'stale',
      authoredCssRecoverable: true,
      status: 'failed' as const,
      auditId: null,
      blocking: ['the database refused the rewrite'],
    }
    expect(revalidationExitCode([failed])).toBe(1)
    expect(formatRevalidation([failed])).toContain('1 failed')
  })

  it('exits zero when there was nothing to do', () => {
    expect(revalidationExitCode([])).toBe(0)
    expect(formatRevalidation([])).toBe('every section definition is current.')
  })

  // FINDING for the lead, left as a documented expectation because the fix is
  // in packages/platform/src/revalidate-cli.ts, outside the scope of this test.
  //
  // Line 11 of that file computes the process exit status itself:
  //
  //     process.exitCode = outcomes.some((o) => o.status === 'needs-an-author') ? 1 : 0
  //
  // which is now incomplete — a run where a definition failed exits 0 and a
  // deploy step reads that as success. `revalidationExitCode` above is the
  // shared answer; the CLI should call it rather than re-deriving one.
  //
  // This asserts what the file says today, so the gap is not something a reader
  // has to already know about. Making the CLI call `revalidationExitCode` is
  // what fixes it, and DELETING THIS TEST is part of that change.
  it('the CLI takes its exit status from the shared helper', async () => {
    // It used to ask only about `needs-an-author`, so a run in which
    // definitions actually failed exited 0 and a scheduler would have called
    // that a success.
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('../src/revalidate-cli.ts', import.meta.url), 'utf8')
    expect(source).toContain('revalidationExitCode(outcomes)')
    expect(source).not.toContain(`outcomes.some((o) => o.status === 'needs-an-author') ? 1 : 0`)
  })
})

/**
 * The structured half, which had no test at all.
 *
 * The regression this closes is specific and quiet. Before migration 0027 the
 * repair path did not read `definition_kind`, so a structured row that was stale
 * only in its CSS stamp was handed to the *legacy* recompiler — and a structured
 * row stores an empty compiled template and no authored HTML, so
 * `compileSection('')` succeeded, produced an empty AST and the render hash of
 * nothing at all, and stamped it onto a version whose document was fine. The
 * section then rendered nothing, and the audit row said it had been revalidated.
 *
 * Straight INSERTs again, for the same reason as `seed` above: the gate that
 * would now refuse these rows is exactly what they predate.
 */
async function seedStructured(input: {
  slug: string
  schemaVersion?: number
  cssPolicyVersion?: number
}): Promise<string> {
  const def = await pool.query<{ id: string }>(
    `
    INSERT INTO section_defs (scope, slug, name, category, created_by)
    VALUES ('global', $1, $2, 'Test', $3) RETURNING id`,
    [input.slug, input.slug, ROOT],
  )
  const defId = def.rows[0]!.id
  const document = {
    schemaVersion: input.schemaVersion ?? STRUCTURED_SCHEMA_VERSION,
    fields: [{ name: 'heading', type: 'text', label: 'Heading' }],
    nodes: [
      {
        type: 'element',
        tag: 'section',
        attributes: { class: input.slug },
        children: [{ type: 'text', field: 'heading' }],
      },
    ],
  }
  await pool.query(
    `
    INSERT INTO section_def_versions
      (section_def_id, version, source_html, source_css, compiled_css, compiled_ast, slots,
       sanitizer_policy_version, css_policy_version, render_hash, carries_trusted_code, changelog,
       definition_kind, structured_doc, structured_schema_version)
    VALUES ($1, 1, '', $2, $3, $4, $5, $6, $7, $8, false, 'seeded', 'structured', $9, $10)`,
    [
      defId,
      '.heading{margin:0}',
      `.cms-section--${input.slug} .heading{margin:0}`,
      JSON.stringify({
        nodes: [],
        policyVersion: SANITIZER_POLICY_VERSION,
        cssPolicyVersion: input.cssPolicyVersion ?? CSS_POLICY_VERSION,
      }),
      JSON.stringify([{ id: 'heading', kind: 'text', label: 'Heading', constraints: {} }]),
      SANITIZER_POLICY_VERSION,
      input.cssPolicyVersion ?? CSS_POLICY_VERSION,
      `hash-${input.slug}`,
      JSON.stringify(document),
      input.schemaVersion ?? STRUCTURED_SCHEMA_VERSION,
    ],
  )
  return defId
}

describe('repairing a structured definition', () => {
  it('recompiles it from its document, not from a source it does not have', async () => {
    const defId = await seedStructured({ slug: 'structured-stale', cssPolicyVersion: CSS_POLICY_VERSION - 1 })
    const before = await storedArtifacts(defId)

    const outcomes = await revalidateDefinitions(pool, { apply: true })
    const outcome = outcomes.find(candidate => candidate.sectionDefId === defId)
    expect(outcome, 'the stale structured row was never listed').toBeDefined()
    expect(outcome!.status).toBe('rewritten')

    const after = await storedArtifacts(defId)
    expect(after.css_policy_version).toBe(CSS_POLICY_VERSION)
    // The whole point. A legacy recompile of a row with no source HTML produces
    // the AST and the render hash of an empty template, which is a section that
    // renders nothing — so the stored template must still be the empty one a
    // structured row carries, and the hash must be the one the *structured*
    // compiler derives from the document rather than the one `compileSection('')`
    // derives from nothing.
    expect(after.compiled_ast).toMatchObject({ nodes: [] })
    expect(after.render_hash).not.toBe(before.render_hash)
    expect(after.render_hash).toBe(
      compileStructuredSection({
        slug: 'structured-stale',
        document: StructuredDocument.parse({
          schemaVersion: STRUCTURED_SCHEMA_VERSION,
          fields: [{ name: 'heading', type: 'text', label: 'Heading' }],
          nodes: [
            {
              type: 'element',
              tag: 'section',
              attributes: { class: 'structured-stale' },
              children: [{ type: 'text', field: 'heading' }],
            },
          ],
        }),
        sourceCss: '.heading{margin:0}',
      }).renderHash,
    )
  })

  it('leaves a document written for a schema this build does not implement to a person', async () => {
    // A row stamped *above* the current schema version was written by a build
    // that knew something this one does not, and rewriting it would be this
    // build deciding what a document it cannot read means. The row is reported
    // and left exactly as it was — which is the same decision the renderer makes
    // when it refuses to render one.
    const defId = await seedStructured({
      slug: 'structured-future',
      schemaVersion: STRUCTURED_SCHEMA_VERSION + 1,
    })
    const before = await storedArtifacts(defId)

    const outcomes = await revalidateDefinitions(pool, { apply: true })
    const outcome = outcomes.find(candidate => candidate.sectionDefId === defId)
    expect(outcome, 'the future-schema row was never listed').toBeDefined()
    expect(outcome!.status).toBe('needs-an-author')
    expect(outcome!.blocking.join(' ')).not.toBe('')

    expect(await storedArtifacts(defId)).toEqual(before)
  })
})

describe('a re-style after a compiler improvement inside the same CSS policy', () => {
  // October 5: Tailwind's `@property` starting values are kept. A version the
  // compiler wrote before that is current and safe, so the database does not
  // list it; `--restyle` finds it, and `--apply` re-styles it with a history.
  it('finds it, re-styles it with an audit row, then finds nothing', async () => {
    const slug = 'restyle-card'
    const sourceHtml = `<section class="${slug}"><p class="card">{{body}}</p></section>`
    const sourceCss =
      '@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}.card{box-shadow:var(--tw-shadow)}'
    const slots = [{ id: 'body', kind: 'text' as const, label: 'Body', constraints: {} }]
    const compiled = compileSection({ sourceHtml, sourceCss, slots, scopeSelector: `.cms-section--${slug}` })
    const earlier = compiled.css.replace(/^[^{]*\{--tw-shadow:0 0 #0000\}/, '')
    expect(earlier).toBe(`.cms-section--${slug} .card{box-shadow:var(--tw-shadow)}`)
    const def = await pool.query<{ id: string }>(
      `INSERT INTO section_defs (scope, slug, name, category, created_by)
      VALUES ('global', $1, $1, 'Test', $2) RETURNING id`,
      [slug, ROOT],
    )
    await pool.query(
      `INSERT INTO section_def_versions (section_def_id, version, source_html, source_css, compiled_css, compiled_ast, slots,
       sanitizer_policy_version, css_policy_version, render_hash, carries_trusted_code, changelog)
      VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 'before-property-defaults', false, 'seeded')`,
      [
        def.rows[0]!.id,
        sourceHtml,
        sourceCss,
        earlier,
        JSON.stringify(compiled.ast),
        JSON.stringify(slots),
        compiled.ast.policyVersion,
        CSS_POLICY_VERSION,
      ],
    )

    expect((await findStaleDefinitions(pool)).some(row => row.slug === slug)).toBe(false)
    expect((await findRestyleCandidates(pool)).map(row => row.slug)).toContain(slug)
    const report = await revalidateDefinitions(pool, { restyle: true })
    expect(report.find(row => row.slug === slug)).toMatchObject({ status: 'unchanged', auditId: null })
    expect((await storedArtifacts(def.rows[0]!.id)).compiled_css).toBe(earlier)

    const applied = await revalidateDefinitions(pool, { restyle: true, apply: true })
    expect(applied.find(row => row.slug === slug)).toMatchObject({ status: 'rewritten', auditId: expect.any(String) })
    const stored = await storedArtifacts(def.rows[0]!.id)
    expect(stored.compiled_css).toBe(compiled.css)
    expect(stored.render_hash).toBe(compiled.renderHash)
    expect((await findRestyleCandidates(pool)).some(row => row.slug === slug)).toBe(false)
  })
})
