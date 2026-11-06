// A stored structured definition has a route forward, and exactly one.
//
// Migration 0019 kept structured rows out of `pnpm db:revalidate` on the
// grounds that the repair tool recompiles from `source_html` and a structured
// definition has none, so "listing one there would hand the repair tool a row
// whose repair is to overwrite it with an empty legacy definition". Two things
// were wrong with that.
//
// The exclusion was never written down: 0020's listing function selects on the
// AST gate and the CSS gate, and neither reads `definition_kind`. Move a
// structured row's CSS policy stamp and it appears in the list looking exactly
// like a legacy one — which is the first thing asserted below, because the
// caller can only avoid the wrong repair if the list tells it which model the
// row is written in.
//
// And with the exclusion honoured, a structured row below
// `app.current_structured_schema_version()` had no route at all: refused by the
// authoring command, refused by the manifest builder, absent from every list,
// and reachable by no command. Migration 0027 gives it one, and the shape of
// that command is the argument of this file. It may carry a row up to the
// version this database implements and never past it, it stores the document it
// is handed rather than reading it, it re-runs every gate on what it is about to
// store, it records what it changed, and it refuses to record what it did not.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STRUCTURED_SCHEMA_VERSION } from '../src/index.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('structrevalidate')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

// Literals, not @cms/renderer's constants: the renderer depends on this package,
// so importing back would be a cycle. Migrations 0012, 0013 and 0019 are what
// keep the numbers honest — a stale one fails loudly here rather than quietly
// storing something the renderer will refuse.
const SANITIZER_POLICY_VERSION = 4
const CSS_POLICY_VERSION = 6

/** What a structured row stores in `compiled_ast`: nothing to interpolate. */
const NO_TEMPLATE = JSON.stringify({
  nodes: [],
  policyVersion: SANITIZER_POLICY_VERSION,
  cssPolicyVersion: CSS_POLICY_VERSION,
})

const FIELDS = [
  { name: 'heading', type: 'text', label: 'Heading' },
  { name: 'body', type: 'richtext', label: 'Body' },
]

const NODES = [
  {
    type: 'element',
    tag: 'section',
    attributes: { class: 'quote' },
    children: [
      { type: 'element', tag: 'h1', children: [{ type: 'text', field: 'heading' }] },
      { type: 'element', tag: 'div', children: [{ type: 'richtext', field: 'body' }] },
    ],
  },
]

const document = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: STRUCTURED_SCHEMA_VERSION,
  fields: FIELDS,
  nodes: NODES,
  ...overrides,
})

const SLOTS = JSON.stringify(FIELDS.map(f => ({ id: f.name, kind: f.type, label: f.label, constraints: {} })))

const authoredCss = '.a{color:red}'
const compiledCssFor = (slug: string) => `.cms-section--${slug} .a{color:red}`

/** A stored structured definition, saved through the real command. */
async function save(slug: string): Promise<string> {
  const { rows } = await db.asUser(s.superAdmin, c =>
    c.query<{ section_def_id: string }>(
      'SELECT * FROM app.upsert_section_def_version' + '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        slug,
        'Structured',
        'Content',
        '',
        authoredCss,
        compiledCssFor(slug),
        NO_TEMPLATE,
        SLOTS,
        'hash',
        SANITIZER_POLICY_VERSION,
        CSS_POLICY_VERSION,
        'structured test',
        false,
        'structured',
        JSON.stringify(document()),
        STRUCTURED_SCHEMA_VERSION,
      ],
    ),
  )
  return rows[0]!.section_def_id
}

type StoredVersion = {
  definition_kind: string
  structured_doc: Record<string, unknown>
  structured_schema_version: number
  compiled_ast: unknown
  compiled_css: string
  render_hash: string
  sanitizer_policy_version: number
  css_policy_version: number
}

async function stored(defId: string): Promise<StoredVersion> {
  const { rows } = await db.as('owner', c =>
    c.query<StoredVersion>(
      `
    SELECT definition_kind, structured_doc, structured_schema_version, compiled_ast,
           compiled_css, render_hash, sanitizer_policy_version, css_policy_version
      FROM section_def_versions WHERE section_def_id = $1 AND version = 1`,
      [defId],
    ),
  )
  return rows[0]!
}

type StaleRow = {
  slug: string
  definition_kind: string
  structured_schema_version: number | null
  css_policy_version: number | null
  defect: string
}

async function staleRow(slug: string): Promise<StaleRow | undefined> {
  const { rows } = await db.as('owner', c =>
    c.query<StaleRow>(
      `SELECT slug, definition_kind, structured_schema_version, css_policy_version, defect
       FROM app.section_definitions_needing_revalidation()`,
    ),
  )
  return rows.find(r => r.slug === slug)
}

type CommandArgs = {
  doc?: unknown
  docJson?: string
  schemaVersion?: number | null
  compiledAst?: string
  compiledCss?: string
  renderHash?: string
  sanitizerPolicyVersion?: number
  cssPolicyVersion?: number
}

/**
 * The command, with every argument defaulting to what `save` stored.
 *
 * So a call with no overrides is exactly the no-op the command has to refuse,
 * and every test below says in its arguments the single thing it is changing.
 */
function revalidate(defId: string, slug: string, o: CommandArgs = {}) {
  return db.as('owner', c =>
    c.query<{ audit_id: string | null }>(
      'SELECT app.revalidate_structured_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9) AS audit_id',
      [
        defId,
        1,
        o.docJson ?? JSON.stringify('doc' in o ? o.doc : document()),
        'schemaVersion' in o ? o.schemaVersion : STRUCTURED_SCHEMA_VERSION,
        o.compiledAst ?? NO_TEMPLATE,
        o.compiledCss ?? compiledCssFor(slug),
        o.renderHash ?? 'hash',
        o.sanitizerPolicyVersion ?? SANITIZER_POLICY_VERSION,
        o.cssPolicyVersion ?? CSS_POLICY_VERSION,
      ],
    ),
  )
}

async function auditRows(defId: string) {
  const { rows } = await db.as('owner', c =>
    c.query<{ actor_type: string; actor_id: string | null; detail: Record<string, unknown> }>(
      `SELECT actor_type, actor_id, detail FROM audit_log
        WHERE action = 'section_def.revalidate_structured' AND item_id = $1 ORDER BY id`,
      [defId],
    ),
  )
  return rows
}

/** Push a row behind the commands' backs, the way a restore from a backup would. */
const behindTheCommand = (sql: string, params: unknown[]) => db.as('owner', c => c.query(sql, params))

// ------------------------------------------------------------- the report --

describe('the stale list says which model each row is written in', () => {
  it('leaves a structured row at the current version out of it entirely', async () => {
    const defId = await save('struct-current')
    expect(await staleRow('struct-current')).toBeUndefined()
    // Nothing was touched by asking, either: the report is a read.
    expect((await stored(defId)).structured_schema_version).toBe(STRUCTURED_SCHEMA_VERSION)
  })

  it('reports one below the current schema version, and says that is what is wrong', async () => {
    const defId = await save('struct-behind')
    // The whole document moves back, not only the column: 0019 checks the two
    // against each other, and a row where they disagree is a different defect.
    await behindTheCommand(
      `
      UPDATE section_def_versions
         SET structured_schema_version = 1,
             structured_doc = jsonb_set(structured_doc, '{schemaVersion}', '1')
       WHERE section_def_id = $1`,
      [defId],
    )

    const row = await staleRow('struct-behind')
    expect(row).toBeDefined()
    expect(row!.definition_kind).toBe('structured')
    expect(row!.structured_schema_version).toBe(1)
    expect(row!.defect).toContain(`structured schema version 1`)
    expect(row!.defect).toContain(`requires version ${STRUCTURED_SCHEMA_VERSION}`)
  })

  it('reports one whose document the current gates refuse, and says which gate', async () => {
    const defId = await save('struct-refused')
    // An `iframe` is not a tag `app.structured_node_defect` will take, and the
    // row is at the current version — so the sentence has to be about the
    // document rather than about a stamp, or the operator repairs the wrong
    // thing.
    await behindTheCommand(
      `
      UPDATE section_def_versions
         SET structured_doc = jsonb_set(structured_doc, '{nodes}',
               '[{"type":"element","tag":"iframe"}]')
       WHERE section_def_id = $1`,
      [defId],
    )

    const row = await staleRow('struct-refused')
    expect(row).toBeDefined()
    expect(row!.structured_schema_version).toBe(STRUCTURED_SCHEMA_VERSION)
    expect(row!.defect).toContain('iframe')
    expect(row!.defect).not.toContain('requires version')
  })

  it('carries the discriminator for a structured row that is stale about its CSS', async () => {
    // The defect 0027 closes. This row's document is perfect and its stylesheet
    // stamp is not, so it is listed by a gate that has never heard of
    // `definition_kind` — and before the column travelled with it, the repair
    // tool read its empty `source_html`, recompiled an empty legacy template
    // and stamped a legacy render hash onto a structured row.
    const defId = await save('struct-cssstale')
    await behindTheCommand('UPDATE section_def_versions SET css_policy_version = $2 WHERE section_def_id = $1', [
      defId,
      CSS_POLICY_VERSION - 1,
    ])

    const row = await staleRow('struct-cssstale')
    expect(row).toBeDefined()
    expect(row!.definition_kind).toBe('structured')
    expect(row!.css_policy_version).toBe(CSS_POLICY_VERSION - 1)
  })

  it('is read by the revalidation tool only: the list spans every site, so the admin app cannot read it (migration 0109)', async () => {
    // Until October 6 any signed-in person could list every site's stale
    // definitions. No admin screen uses the list; the tool connects as the owner.
    await expect(
      db.asUser(s.superAdmin, c => c.query('SELECT * FROM app.section_definitions_needing_revalidation()')),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      db.as('owner', c => c.query('SELECT * FROM app.section_definitions_needing_revalidation()')),
    ).resolves.toBeDefined()
  })
})

// ------------------------------------------------------------ the ceiling --

describe('the command cannot carry a row past the version this database implements', () => {
  it('refuses a stamp above the current one even when the document agrees with it', async () => {
    const defId = await save('struct-ahead')
    const before = await stored(defId)
    await expectSqlState(
      revalidate(defId, 'struct-ahead', {
        doc: document({ schemaVersion: STRUCTURED_SCHEMA_VERSION + 1 }),
        schemaVersion: STRUCTURED_SCHEMA_VERSION + 1,
        renderHash: 'hash-ahead',
      }),
      'CMS04',
    )
    // A refusal that changed nothing. A stamp is a claim that some reader here
    // vouched for the document, and there is no reader here for a version this
    // build does not know.
    expect(await stored(defId)).toEqual(before)
    expect(await auditRows(defId)).toEqual([])
  })

  it('refuses a stamp that is not there at all, rather than storing an unvouched-for row', async () => {
    const defId = await save('struct-nostamp')
    const before = await stored(defId)
    await expectSqlState(
      revalidate(defId, 'struct-nostamp', { schemaVersion: null, renderHash: 'hash-nostamp' }),
      'CMS04',
    )
    expect(await stored(defId)).toEqual(before)
  })

  it('carries one up to the current version, which is the repair it exists for', async () => {
    const defId = await save('struct-forward')
    await behindTheCommand(
      `
      UPDATE section_def_versions
         SET structured_schema_version = 1,
             structured_doc = jsonb_set(structured_doc, '{schemaVersion}', '1')
       WHERE section_def_id = $1`,
      [defId],
    )

    const written = await revalidate(defId, 'struct-forward', { renderHash: 'hash-forward' })
    expect(written.rows[0]!.audit_id).not.toBeNull()

    const after = await stored(defId)
    expect(after.structured_schema_version).toBe(STRUCTURED_SCHEMA_VERSION)
    expect(after.structured_doc['schemaVersion']).toBe(STRUCTURED_SCHEMA_VERSION)
    expect(after.render_hash).toBe('hash-forward')
    expect(await staleRow('struct-forward')).toBeUndefined()
  })
})

// -------------------------------------------------------------- the gates --

describe('the command re-runs every gate on what it is about to store', () => {
  it('refuses a document the current node grammar will not take, and rewrites nothing', async () => {
    const defId = await save('struct-gate-doc')
    const before = await stored(defId)
    await expectSqlState(
      revalidate(defId, 'struct-gate-doc', {
        doc: document({ nodes: [{ type: 'element', tag: 'iframe' }] }),
        renderHash: 'hash-gate-doc',
      }),
      'CMS04',
    )
    expect(await stored(defId)).toEqual(before)
    expect(await auditRows(defId)).toEqual([])
  })

  it('refuses a stylesheet that escapes this section, the way the authoring command does', async () => {
    const defId = await save('struct-gate-css')
    const before = await stored(defId)
    await expectSqlState(
      revalidate(defId, 'struct-gate-css', {
        compiledCss: 'body{display:none}',
        renderHash: 'hash-gate-css',
      }),
      'CMS04',
    )
    expect(await stored(defId)).toEqual(before)
  })

  it('refuses a compiled template with nodes in it, rather than leaving that to the constraint', async () => {
    // 0019's CHECK would also refuse it, with 23514 and no sentence. A caller
    // handing over a populated template has made a mistake a person has to
    // read, so the command names it.
    const defId = await save('struct-gate-ast')
    await expectSqlState(
      revalidate(defId, 'struct-gate-ast', {
        compiledAst: JSON.stringify({
          nodes: [{ kind: 'html', value: '<p>' }],
          policyVersion: SANITIZER_POLICY_VERSION,
          cssPolicyVersion: CSS_POLICY_VERSION,
        }),
        renderHash: 'hash-gate-ast',
      }),
      'CMS04',
    )
  })

  it('refuses to make a legacy row structured, which is the 0019 overwrite in the other direction', async () => {
    await expectSqlState(revalidate(s.heroDefId, 'hero', { renderHash: 'hash-hero-2' }), 'CMS04')
    const after = await stored(s.heroDefId)
    expect(after.definition_kind).toBe('legacy')
    expect(after.structured_doc).toBeNull()
  })

  it('refuses a section definition that is not there', async () => {
    await expectSqlState(revalidate('00000000-0000-0000-0000-0000000000ff', 'struct-missing'), 'CMS03')
  })
})

// --------------------------------------------------------------- the audit --

describe('a rewrite is a change with a history, and a no-op is not a change', () => {
  let defId = ''

  beforeAll(async () => {
    defId = await save('struct-audited')
    await behindTheCommand(
      `
      UPDATE section_def_versions
         SET structured_schema_version = 1,
             structured_doc = jsonb_set(structured_doc, '{schemaVersion}', '1')
       WHERE section_def_id = $1`,
      [defId],
    )
  })

  it('writes exactly one audit row, naming what it changed and what it changed from', async () => {
    const written = await revalidate(defId, 'struct-audited', { renderHash: 'hash-audited' })
    expect(written.rows[0]!.audit_id).not.toBeNull()

    const rows = await auditRows(defId)
    expect(rows).toHaveLength(1)
    // Not a product user: there is none. The audit_log shape constraint only
    // lets a 'user' row name an actor, so an operator act has to say it is one.
    expect(rows[0]!.actor_type).toBe('migration')
    expect(rows[0]!.actor_id).toBeNull()
    expect(rows[0]!.detail).toMatchObject({
      slug: 'struct-audited',
      version: 1,
      before: { render_hash: 'hash', structured_schema_version: 1 },
      after: { render_hash: 'hash-audited', structured_schema_version: STRUCTURED_SCHEMA_VERSION },
    })
  })

  it('refuses the second run rather than recording it, so a repeated repair is provably silent', async () => {
    const before = await stored(defId)
    const written = await revalidate(defId, 'struct-audited', { renderHash: 'hash-audited' })
    // NULL, not an id: there was nothing to record because nothing moved.
    expect(written.rows[0]!.audit_id).toBeNull()
    expect(await stored(defId)).toEqual(before)
    expect(await auditRows(defId)).toHaveLength(1)
  })

  it('refuses a no-op on a row that was never stale in the first place', async () => {
    const fresh = await save('struct-noop')
    const written = await revalidate(fresh, 'struct-noop')
    expect(written.rows[0]!.audit_id).toBeNull()
    expect(await auditRows(fresh)).toEqual([])
  })
})

// --------------------------------------------------------------- the grant --

describe('no application role may rewrite an immutable version', () => {
  // Rewriting the derived artifacts of a stored version is an operator act
  // carried out with the migration credential. An editor changes a section by
  // saving a new one, which is what `upsert_section_def_version` is for — and
  // that command is reachable by the admin app, so a role that could reach this
  // one too would have a second way to change a published section that leaves a
  // different kind of trail.
  const call = (role: 'authenticated' | 'public' | 'worker') =>
    db.as(role, c =>
      c.query('SELECT app.revalidate_structured_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        s.heroDefId,
        1,
        JSON.stringify(document()),
        STRUCTURED_SCHEMA_VERSION,
        NO_TEMPLATE,
        compiledCssFor('hero'),
        'hash',
        SANITIZER_POLICY_VERSION,
        CSS_POLICY_VERSION,
      ]),
    )

  it('refuses the admin application', async () => {
    await expectSqlState(call('authenticated'), '42501')
  })
  it('refuses the public renderer', async () => {
    await expectSqlState(call('public'), '42501')
  })
  it('refuses the worker', async () => {
    await expectSqlState(call('worker'), '42501')
  })
})
