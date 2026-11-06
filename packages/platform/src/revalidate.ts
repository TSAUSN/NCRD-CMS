// Recompile stored section definitions under the current policies.
//
// A policy bump is only half a change. The other half is the rows already in
// the database, compiled under the old one — and the stored policy-version
// columns exist precisely so a bump can "report which definitions need
// revalidation instead of silently changing live output" (SPEC §6.5).
//
// So this reports first and rewrites only when told to. Recompiling a legacy
// definition is a deterministic re-derivation from `source_html` and
// `source_css`, using the same scope selector the original compilation used —
// anything else would scope already-scoped CSS a second time, which is not a
// recompile but a quiet rewrite of what readers see.
//
// A structured definition (ADR 0007) has neither of those halves: its markup is
// `structured_doc` and its `source_html` is empty, so the interpolation compiler
// re-derives an empty template from it and calls that a repair. Migration 0019
// said structured rows were kept out of the stale list for exactly that reason,
// but nothing in the list ever read `definition_kind` — so a structured row
// whose CSS policy stamp went stale was listed among the legacy ones and
// overwritten with a legacy render hash over an empty template, which is the
// overwrite 0019 named, carried out under a defect message about CSS. Migration
// 0027 makes the list say which model each row is written in, and this file
// dispatches on it rather than on which artifact looks populated.
//
// A row whose authored CSS cannot be told apart from its compiled form is
// reported and left alone. That is every row created before migration 0013,
// when the two shared one column: `source_css` may hold either, and there is no
// way to tell by looking. Guessing would mean either double-scoping a
// definition or publishing unscoped CSS into a shared stylesheet, and both are
// worse than saying so.
//
// THREE THINGS THIS FILE HAS TO GET RIGHT, AND ONCE DID NOT
//
// The rewrite is auditable. `compiled_ast`, `compiled_css`, `render_hash` and
// the two policy stamps are the whole security decision about a section, and
// they belong to a version that is otherwise immutable. Changing them with a
// bare UPDATE left no answer to "why does this version's render hash differ
// from the one in the release notes". They now go through
// `app.revalidate_section_def_version` (migration 0018), which re-runs both
// gates on the recompiled artifacts and writes the audit row in the same
// transaction — the pattern every other command in 0003 follows, and the reason
// `app.write_audit` can go on being the only writer of audit_log.
//
// Each definition is its own transaction. A run over a hundred definitions
// where the eleventh is unrepairable must repair the other ninety-nine, and
// must not leave the eleventh with a new AST and an old stylesheet.
//
// Partial failure is reported as failure. A run that could not do what it was
// asked has to say so in what it prints and in what it exits with; a summary
// that counts only successes is how a broken deploy looks green.
import type { Pool, PoolClient } from 'pg'
import {
  compileSection,
  compileStructuredSection,
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  sectionScopeSelector,
} from '@cms/renderer'
import { STRUCTURED_SCHEMA_VERSION, upgradeStructuredDocument, type SlotDef } from '@cms/schema'

/**
 * The empty compiled section a structured version stores.
 *
 * `compiled_ast` is NOT NULL from migration 0001 and every existing gate reads
 * it, so a structured row carries the one artifact that means "there is no
 * interpolated template here", and 0019's CHECK constraint makes that a rule
 * rather than a habit. It is still a stored artifact carrying its own
 * `policyVersion`, which is why a structured repair has to re-stamp it: a row
 * left with an older one is refused by `app.render_ast_defect` exactly as a
 * legacy row would be.
 *
 * Spelled out here rather than imported from @cms/seeds, which has the same
 * constant for the same reason: seeds are development fixtures and nothing that
 * runs against a real deployment may depend on them. The two policy numbers come
 * from the renderer either way, so neither copy can drift from the compiler.
 */
const NO_COMPILED_TEMPLATE = {
  nodes: [],
  policyVersion: SANITIZER_POLICY_VERSION,
  cssPolicyVersion: CSS_POLICY_VERSION,
}

export type StaleDefinition = {
  sectionDefId: string
  slug: string
  version: number
  /**
   * Which model this version is written in, as the row spells it.
   *
   * Carried rather than inferred, and carried as the raw column value: it is
   * what decides which recompile may run, and 0019 added the column precisely
   * so that decision is never made by looking at which artifact is populated.
   */
  definitionKind: string
  storedPolicyVersion: number
  storedCssPolicyVersion: number | null
  /**
   * The structured schema version the row carries, or null for a legacy one.
   *
   * Its own field rather than a second meaning for `storedPolicyVersion`. A
   * structured repair moves this stamp and does not move the sanitizer one, so
   * a report that folded the two together would name the number the repair does
   * not touch.
   */
  storedStructuredSchemaVersion: number | null
  /** Why the database refused it. */
  defect: string
  /** False when this row predates the authored/compiled split. */
  authoredCssRecoverable: boolean
}

export type RevalidationStatus =
  /** Recompiled and stored, with an audit row to show for it. */
  | 'rewritten'
  /** Only a person can fix this one; nothing was touched. */
  | 'needs-an-author'
  /** Nothing was written, either because this is a report or because the stored artifacts already match. */
  | 'unchanged'
  /** The attempt was made and the database refused it, or the connection did. */
  | 'failed'

export type RevalidationOutcome = StaleDefinition & {
  status: RevalidationStatus
  /** Problems the recompile found that a script cannot fix, or why it failed. */
  blocking: string[]
  /**
   * The audit row this rewrite wrote.
   *
   * Null for every status but `rewritten`, and also for a `rewritten` row whose
   * artifacts turned out to be identical to the stored ones — the command
   * refuses to record a change it did not make, which is what makes a second
   * run provably silent rather than merely quiet.
   */
  auditId: string | null
}

/**
 * What the database says needs attention, using its own check.
 *
 * Including structured rows, since migration 0027: one whose stored
 * `structured_schema_version` is not the one this database implements, and one
 * whose stored document no longer passes `app.structured_shape_defect`,
 * `app.structured_node_defect` or `app.structured_attribute_defect`. The defect
 * sentence says which, because those are different repairs — the first is a
 * stamp a script may move, the second is a document only a person may change.
 */
export async function findStaleDefinitions(pool: Pool): Promise<StaleDefinition[]> {
  const { rows } = await pool.query<{
    section_def_id: string
    slug: string
    version: number
    definition_kind: string
    sanitizer_policy_version: number
    css_policy_version: number | null
    structured_schema_version: number | null
    defect: string
    authored_css_recoverable: boolean
  }>('SELECT * FROM app.section_definitions_needing_revalidation()')
  return rows.map(row => ({
    sectionDefId: row.section_def_id,
    slug: row.slug,
    version: row.version,
    definitionKind: row.definition_kind,
    storedPolicyVersion: row.sanitizer_policy_version,
    storedCssPolicyVersion: row.css_policy_version,
    storedStructuredSchemaVersion: row.structured_schema_version,
    defect: row.defect,
    authoredCssRecoverable: row.authored_css_recoverable,
  }))
}

/** JSON with object keys in one order, as Postgres returns jsonb in its own. */
function canonical(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, inner]) => [key, sort(inner)]),
          )
        : item
  return JSON.stringify(sort(value))
}

/**
 * Legacy versions the current compiler would style differently without any
 * policy change: their template recompiles to the stored AST exactly, but
 * their stylesheet does not — a compiler improvement inside the same CSS
 * policy, such as keeping Tailwind's `@property` starting values (October 5).
 * The database does not list them, because nothing about them is unsafe; this
 * is how an operator finds and, with `--apply`, re-styles them, through the
 * same audited command. A version whose template would change is not one.
 */
export async function findRestyleCandidates(pool: Pool): Promise<StaleDefinition[]> {
  const { rows } = await pool.query<{
    section_def_id: string
    slug: string
    version: number
    sanitizer_policy_version: number
    css_policy_version: number
    source_html: string
    source_css: string
    slots: SlotDef[] | null
    compiled_ast: unknown
    compiled_css: string
  }>(
    `SELECT d.id AS section_def_id, d.slug, v.version, v.sanitizer_policy_version, v.css_policy_version,
       v.source_html, v.source_css, v.slots, v.compiled_ast, v.compiled_css
     FROM section_def_versions v JOIN section_defs d ON d.id = v.section_def_id
    WHERE v.definition_kind = 'legacy' AND v.css_policy_version = $1 AND COALESCE(v.source_css, '') <> ''
      AND app.render_ast_defect(v.compiled_ast, v.sanitizer_policy_version) IS NULL
    ORDER BY d.slug, v.version`,
    [CSS_POLICY_VERSION],
  )
  const candidates: StaleDefinition[] = []
  for (const row of rows) {
    const scope = sectionScopeSelector(row.slug)
    if (scope === null) continue
    const compiled = compileSection({
      sourceHtml: row.source_html,
      sourceCss: row.source_css,
      slots: row.slots ?? [],
      scopeSelector: scope,
    })
    if (
      compiled.blocking.length ||
      compiled.css === row.compiled_css ||
      canonical(compiled.ast) !== canonical(row.compiled_ast)
    )
      continue
    candidates.push({
      sectionDefId: row.section_def_id,
      slug: row.slug,
      version: row.version,
      definitionKind: 'legacy',
      storedPolicyVersion: row.sanitizer_policy_version,
      storedCssPolicyVersion: row.css_policy_version,
      storedStructuredSchemaVersion: null,
      defect: 'its stylesheet compiles differently under the current compiler',
      authoredCssRecoverable: true,
    })
  }
  return candidates
}

/** Whatever a thrown thing has to say for itself, as one line. */
function reasonFor(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Recompile each stale definition from its stored source.
 *
 * `apply: false` (the default) changes nothing and tells you what would happen.
 * A definition that recompiles with blocking problems, or whose authored CSS is
 * unrecoverable, is reported as `needs-an-author` and left exactly as it was —
 * including its old AST, which the renderer and the publish path both already
 * refuse, so leaving it is safe and losing it would not be.
 *
 * One definition failing is not the run failing. Each is attempted on its own
 * connection state and its own transaction, so a refusal is recorded against
 * the definition that caused it and the rest of the list still gets its repair.
 */
export async function revalidateDefinitions(
  pool: Pool,
  options: { apply?: boolean; restyle?: boolean } = {},
): Promise<RevalidationOutcome[]> {
  const stale = options.restyle ? await findRestyleCandidates(pool) : await findStaleDefinitions(pool)
  const outcomes: RevalidationOutcome[] = []

  for (const definition of stale) {
    try {
      outcomes.push(await revalidateOne(pool, definition, options.apply ?? false))
    } catch (error) {
      // The database refused this one, or the connection did. Recorded against
      // the definition and moved past: the alternative is that the first
      // unrepairable row in an alphabetical list decides how much of the rest of
      // the estate gets repaired.
      outcomes.push({ ...definition, status: 'failed', auditId: null, blocking: [reasonFor(error)] })
    }
  }

  return outcomes
}

/**
 * One definition, in one transaction.
 *
 * The source is read and the derived artifacts are written inside the same
 * transaction, with the row locked, because the compile in between turns one
 * into the other: a save landing between the read and the write would leave
 * derived columns describing a source that no longer exists. In report mode
 * nothing is locked and nothing is written — a report should not make the
 * editor wait on a row.
 */
async function revalidateOne(pool: Pool, definition: StaleDefinition, apply: boolean): Promise<RevalidationOutcome> {
  const unchanged = { ...definition, auditId: null } as const

  // Asked of both models, though only one can honestly be guilty of it: the
  // structured model arrived in 0019, six migrations after the split, so every
  // structured row a command created has a CSS policy version. One without has
  // been edited by hand, and refusing a row whose stylesheet provenance nothing
  // can establish is the right answer whichever model it is written in.
  if (!definition.authoredCssRecoverable) {
    return {
      ...unchanged,
      status: 'needs-an-author',
      blocking: [
        'this version predates the authored/compiled CSS split, so its ' +
          'source_css may hold compiled output; re-save it from the editor with the ' +
          'CSS a person actually wrote',
      ],
    }
  }

  // No fallback. `?? undefined` sent an out-of-grammar slug to the compiler's
  // default `.cms-section`, which recompiled the definition against the
  // *shared* scope, stamped it current, wrote no audit, and left a row that
  // still cannot publish — a repair that reported success and made things
  // worse.
  const scope = sectionScopeSelector(definition.slug)
  if (scope === null) {
    return {
      ...unchanged,
      status: 'needs-an-author',
      blocking: [
        `slug ${JSON.stringify(definition.slug)} cannot be a section scope, so this ` +
          'version cannot be recompiled; rename it from the editor',
      ],
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Which recompile, decided by the column. Two branches and not three
    // because 0019's CHECK constraint admits exactly `legacy` and `structured`,
    // so a row carrying anything else cannot be stored to be dispatched on;
    // that constraint is what makes the `else` here safe rather than lucky.
    const outcome =
      definition.definitionKind === 'structured'
        ? await recompileStructured(client, definition, apply)
        : await recompileLegacy(client, definition, scope, apply)
    if (apply) await client.query('COMMIT')
    else await client.query('ROLLBACK')
    return outcome
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function recompileLegacy(
  client: PoolClient,
  definition: StaleDefinition,
  scope: string,
  apply: boolean,
): Promise<RevalidationOutcome> {
  const unchanged = { ...definition, auditId: null } as const

  const { rows } = await client.query<{ source_html: string; source_css: string; slots: SlotDef[] }>(
    `SELECT source_html, source_css, slots FROM section_def_versions
      WHERE section_def_id = $1 AND version = $2${apply ? ' FOR UPDATE' : ''}`,
    [definition.sectionDefId, definition.version],
  )
  const source = rows[0]
  if (!source) {
    // Reported as a failure rather than as "unchanged". The row was listed as
    // stale moments ago and is not there now, which means something else is
    // writing this table while a repair runs — a fact an operator needs, not a
    // line that reads like a clean no-op.
    return {
      ...unchanged,
      status: 'failed',
      blocking: ['the stored version disappeared between being listed and being read'],
    }
  }

  const compiled = compileSection({
    sourceHtml: source.source_html,
    sourceCss: source.source_css,
    slots: source.slots ?? [],
    // The same selector the original compilation used. Leaving it to the
    // default happened to be right, and "happened to be right" is not a thing
    // to leave implicit in the one function whose job is reproducing a
    // previous compilation exactly.
    scopeSelector: scope,
  })

  if (compiled.blocking.length > 0) {
    return { ...unchanged, status: 'needs-an-author', blocking: compiled.blocking }
  }
  if (!apply) return { ...unchanged, status: 'unchanged', blocking: [] }

  // Rewritten in place rather than as version N+1. A recompile is not an
  // editorial change: the source is identical and the rendered output is
  // identical, so a new version would put a meaningless entry in every
  // definition's history and unpin nothing.
  //
  // Through the command rather than by UPDATE. Every derived column moves
  // together, both gates are re-run on the new artifacts before they are
  // stored, and the audit row is written in this same transaction — so a
  // rewrite that the gates refuse leaves the row exactly as it was, rather than
  // half-migrated and passing one of the two.
  const written = await client.query<{ audit_id: string | null }>(
    'SELECT app.revalidate_section_def_version($1,$2,$3,$4,$5,$6,$7) AS audit_id',
    [
      definition.sectionDefId,
      definition.version,
      JSON.stringify(compiled.ast),
      compiled.css,
      compiled.renderHash,
      compiled.ast.policyVersion,
      CSS_POLICY_VERSION,
    ],
  )
  return { ...unchanged, status: 'rewritten', blocking: [], auditId: written.rows[0]!.audit_id }
}

/**
 * One structured definition, in one transaction.
 *
 * The re-derivation is `compileStructuredSection` — the function the seeds and
 * the importer already use — over the stored document and the stored authored
 * CSS. It produces the compiled stylesheet, the render hash and the policy
 * stamps, and it produces them from what is already in the row.
 *
 * WHAT THIS DELIBERATELY WILL NOT DO
 *
 * It will not reinterpret the document. The only change a repair may make to a
 * stored document is the number saying which grammar it was written against,
 * and `upgradeStructuredDocument` is the one function allowed to make it: the
 * whole upgrade is the version number, and it returns null rather than adopting
 * a v1 node that already carries the key v2 added. A document the current
 * version refuses is `needs-an-author` and is left exactly as it was.
 *
 * That refusal is the entire point of storing `structured_schema_version`.
 * Quietly rewriting somebody's document to fit a newer grammar would be reading
 * an author's intent out of a document that never expressed it — and a repair
 * script would do it to every stored definition at once, with nobody watching,
 * under a defect message about a version number. Leaving the row alone is safe:
 * the manifest builder already refuses it, so it neither previews nor publishes
 * and nothing renders half of it.
 */
async function recompileStructured(
  client: PoolClient,
  definition: StaleDefinition,
  apply: boolean,
): Promise<RevalidationOutcome> {
  const unchanged = { ...definition, auditId: null } as const

  const { rows } = await client.query<{ source_css: string; structured_doc: unknown }>(
    `SELECT source_css, structured_doc FROM section_def_versions
      WHERE section_def_id = $1 AND version = $2${apply ? ' FOR UPDATE' : ''}`,
    [definition.sectionDefId, definition.version],
  )
  const source = rows[0]
  if (!source) {
    // The same reading as the legacy path: listed as stale moments ago and gone
    // now means something else is writing this table while a repair runs, which
    // an operator needs told rather than folded into a clean-looking no-op.
    return {
      ...unchanged,
      status: 'failed',
      blocking: ['the stored version disappeared between being listed and being read'],
    }
  }

  const document = upgradeStructuredDocument(source.structured_doc)
  if (document === null) {
    // Compiled a second time purely to say why, and nothing from this compile
    // is ever stored: `upgradeStructuredDocument` has already refused the
    // document, and this is the only thing in reach that turns that one-word
    // refusal into the sentences an author can act on.
    const refused = compileStructuredSection({
      slug: definition.slug,
      document: source.structured_doc,
      sourceCss: source.source_css ?? '',
    })
    return {
      ...unchanged,
      status: 'needs-an-author',
      // The fallback exists because `blocking` is what the report prints and
      // the exit status counts, and an outcome that needs an author while
      // saying nothing is one an operator cannot act on.
      blocking:
        refused.blocking.length > 0
          ? refused.blocking
          : [
              `this document is at structured schema version ` +
                `${definition.storedStructuredSchemaVersion ?? 'unknown'} and cannot be carried to ` +
                `${STRUCTURED_SCHEMA_VERSION} without changing what it says; re-save it from the editor`,
            ],
    }
  }

  const compiled = compileStructuredSection({
    slug: definition.slug,
    document,
    // Authored, not compiled. `compileStructuredSection` derives the scope from
    // the slug and scopes this itself, which is why the compiled column is
    // never the input: handing it back would scope an already-scoped stylesheet
    // a second time, the defect the legacy path names in its own comment.
    sourceCss: source.source_css ?? '',
  })
  if (compiled.blocking.length > 0) {
    return { ...unchanged, status: 'needs-an-author', blocking: compiled.blocking }
  }
  if (!apply) return { ...unchanged, status: 'unchanged', blocking: [] }

  // Through `app.revalidate_structured_def_version` (migration 0027) for
  // 0018's reason: the document, the stylesheet, the render hash and the three
  // stamps are the whole security decision about a structured section, they
  // belong to a version that is otherwise immutable, and a bare UPDATE would
  // leave no answer to "why does this version's render hash differ from the one
  // the release notes quote". The command re-runs the structured gate and both
  // artifact gates on what it is about to store, and writes the audit row in
  // this same transaction.
  const written = await client.query<{ audit_id: string | null }>(
    'SELECT app.revalidate_structured_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9) AS audit_id',
    [
      definition.sectionDefId,
      definition.version,
      JSON.stringify(compiled.document),
      STRUCTURED_SCHEMA_VERSION,
      JSON.stringify(NO_COMPILED_TEMPLATE),
      compiled.css,
      compiled.renderHash,
      SANITIZER_POLICY_VERSION,
      CSS_POLICY_VERSION,
    ],
  )
  return { ...unchanged, status: 'rewritten', blocking: [], auditId: written.rows[0]!.audit_id }
}

/**
 * The exit status a command carries away from these outcomes.
 *
 * Non-zero when a definition still needs a person: one that failed, and one
 * that needs an author. `unchanged` is zero, because a report that found work
 * to do has done its job — and so is an empty list.
 */
export function revalidationExitCode(outcomes: readonly RevalidationOutcome[]): number {
  return outcomes.some(o => o.status === 'failed' || o.status === 'needs-an-author') ? 1 : 0
}

/** One line per definition, for a person reading a terminal. */
export function formatRevalidation(
  outcomes: readonly RevalidationOutcome[],
  options: { restyle?: boolean } = {},
): string {
  if (outcomes.length === 0)
    return options.restyle
      ? 'every section definition is styled as the current compiler writes it.'
      : 'every section definition is current.'
  const lines = outcomes.map(o => {
    const audited = o.auditId === null ? '' : ` (audit ${o.auditId})`
    // The stamps this row's repair would actually move. A structured row's
    // sanitizer version describes the empty template it stores and says nothing
    // about the document, so printing it beside a structured defect invited the
    // reader to check the number that was never the problem.
    const stamps =
      o.definitionKind === 'structured'
        ? `structured schema ${o.storedStructuredSchemaVersion ?? 'unknown'}, ` +
          `css ${o.storedCssPolicyVersion ?? 'unknown'}`
        : `sanitizer ${o.storedPolicyVersion}, css ${o.storedCssPolicyVersion ?? 'unknown'}`
    const head = `${o.slug} v${o.version} (${stamps}) — ${o.status}${audited}`
    return o.blocking.length > 0 ? `${head}\n    ${o.blocking.join('\n    ')}` : head
  })
  const count = (status: RevalidationStatus) => outcomes.filter(o => o.status === status).length
  // Failures are counted in the summary and not only in the lines above,
  // because the summary is the part that gets pasted into a deploy log.
  const summary = [
    `${count('rewritten')} rewritten`,
    `${count('needs-an-author')} need an author`,
    `${count('failed')} failed`,
  ]
  const untouched = count('unchanged')
  if (untouched > 0) summary.push(`${untouched} left alone`)
  return [
    ...lines,
    '',
    `${outcomes.length} definition(s) ${options.restyle ? 'styled differently by the current compiler' : 'below the current policy'}; ${summary.join(', ')}.`,
  ].join('\n')
}
