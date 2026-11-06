// The CSS compiler and the two gates that check its output, held against each
// other on the same stylesheets.
//
// There are three implementations of "is this compiled CSS confined to its
// section": `scopeCss`, which produces it; `validateCompiledCss`, which is the
// check that actually holds because it has a parser; and
// `app.compiled_css_defect`, which has no parser and checks what SQL can see so
// that a row written by a restore, a migration or a hand edit is still refused.
// Three implementations of one rule drift, and they have drifted twice:
//
//   * CMS-DB-04 — SQL split selector lists on every comma, so
//     `.cms-section--d .a:is(.b, .c)` became two branches and the second was
//     "outside its section". Fixed in 0016 by `app.selector_branches`.
//   * The same shape one layer down — SQL found rule preludes with a regular
//     expression that could not tell a `{` inside a string from one that opens
//     a block, so `.a[data-tpl="{"]` and `content:"{"` threw the scan out of
//     phase and every later prelude was a fragment of a declaration. Fixed in
//     0018 by `app.css_rule_preludes`.
//
// Both were found by asking the question this file asks, and neither was
// visible from inside a single package: @cms/renderer depends on @cms/schema,
// so the schema suite cannot import the compiler, and the renderer suite has no
// database. This is the one place both are reachable.
//
// The direction of blame is fixed, and the failure messages say so. If SQL
// refuses a stylesheet `scopeCss` emitted and `validateCompiledCss` accepted,
// the gate is wrong — a compiled artifact is not made unsafe by the fact that a
// scanner without a tokenizer cannot follow it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import {
  CSS_POLICY_VERSION,
  compiledCssProblems,
  scopeCss,
  sectionScopeSelector,
  validateCompiledCss,
} from '@cms/renderer'
import { ScratchDatabase } from './database.ts'

const SLUG = 'conformance'
const SCOPE = `.cms-section--${SLUG}`

let db: ScratchDatabase
let pool: Pool

beforeAll(async () => {
  db = await ScratchDatabase.create('cssconf')
  pool = db.pool()
}, 60_000)
afterAll(async () => {
  await db?.close()
})

/** What the database says about a compiled stylesheet, using its own check. */
async function sqlDefect(css: string, version: number | null = CSS_POLICY_VERSION): Promise<string | null> {
  const { rows } = await pool.query<{ defect: string | null }>('SELECT app.compiled_css_defect($1, $2, $3) AS defect', [
    css,
    version,
    SCOPE,
  ])
  return rows[0]!.defect
}

/**
 * Authored CSS a section author is entitled to write, and which the compiler
 * therefore has to be able to ship.
 *
 * Every entry is a construct the policy documents as supported — the
 * combinators, the functional pseudo-classes, the conditional at-rules, custom
 * properties, same-origin urls, and the `&` form per-block custom CSS is
 * written in. Adding one here is how a future construct gets held to the same
 * agreement.
 */
const ACCEPTED: readonly [string, string][] = [
  ['a plain class rule', '.a{color:red}'],
  ['a descendant combinator', '.a .b{color:red}'],
  ['a subsequent-sibling combinator', '.a ~ .b{color:red}'],
  ['a compound on the scope itself', '&.is-active{color:red}'],
  ['a compound on the scope with a descendant', '&.is-active .b{color:red}'],
  ['declarations on the scope itself', '&{padding:1rem}'],
  ['a selector list', '.a, .b{color:red}'],
  ['a selector list where one branch is the scope', '&, .b{color:red}'],
  [':is() containing a comma', '.a:is(.b, .c){color:red}'],
  [':where() containing a comma', '.a:where(.b, .c){color:red}'],
  [':not() containing a comma', '.a:not(.b, .c){color:red}'],
  [':has() containing a comma', '.a:has(.b, .c){color:red}'],
  ['an attribute selector containing a comma', '.a[data-list="x,y"]{color:red}'],
  ['an attribute selector quoted with apostrophes', `.a[data-list='x,y']{color:red}`],
  ['an attribute selector containing an opening brace', '.a[data-tpl="{"]{color:red}'],
  ['an attribute selector containing a whole brace pair', '.a[data-tpl="{x}"]{color:red}'],
  ['an attribute selector on the scope itself', '&[data-tpl="{"]{color:red}'],
  ['a brace in an attribute string followed by another rule', '.a[data-tpl="{"]{color:red} .b{color:blue}'],
  ['an attribute selector and a functional pseudo-class in one list', '.a[data-tpl="{,}"], .b:is(.c, .d){color:red}'],
  ['a declaration value containing a brace', `.a::before{content:"{"}`],
  ['a declaration value containing a comma and a brace pair', `.a::before{content:"a,b{c}"}`],
  ['a declaration value containing an unmatched closing brace', `.a::before{content:"}"}`],
  ['a brace in a declaration string followed by another rule', `.a::before{content:"{"} .b{color:blue}`],
  ['@media', '@media (min-width: 600px){.a{color:red}}'],
  ['@supports', '@supports (display: grid){.a{display:grid}}'],
  ['@container', '@container (min-width: 20rem){.a{color:red}}'],
  ['@layer', '@layer utilities{.a{color:red}}'],
  ['@supports nested inside @media', '@media (min-width: 600px){@supports (display: grid){.a{display:grid}}}'],
  ['@media nested inside @supports', '@supports (display: grid){@media (min-width: 600px){.a{display:grid}}}'],
  ['a braced string inside a conditional at-rule', `@media (min-width: 600px){.a::before{content:"{"}}`],
  ['a same-origin url() in a declaration', '.a{background-image:url(/media/x.png)}'],
  ['a same-origin url() already quoted', `.a{background-image:url("/media/x.png")}`],
  ['a custom property and its use', '.a{--gap: 1rem; gap: var(--gap)}'],
  ['a custom property on the scope itself', '&{--gap: 1rem}'],
]

describe('every stylesheet the compiler emits is accepted by both gates', () => {
  it.each(ACCEPTED)('%s', async (label, source) => {
    const compiled = scopeCss(source, SCOPE)
    expect(
      compiled.blocking,
      `scopeCss refused authored CSS this suite holds to be legitimate (${label}). Either the ` +
        'construct is genuinely unsupported and does not belong in ACCEPTED, or the compiler is wrong.',
    ).toEqual([])

    expect(
      validateCompiledCss(compiled.css, SCOPE),
      `validateCompiledCss refused CSS that scopeCss itself emitted for ${label}. The compiler and ` +
        `its own validator disagree, which is a defect in @cms/renderer: ${compiled.css}`,
    ).toEqual([])

    expect(
      await sqlDefect(compiled.css),
      `app.compiled_css_defect refused CSS that scopeCss emitted and validateCompiledCss accepted ` +
        `(${label}). That is a defect in the SQL gate, not in this stylesheet — the gate refusing ` +
        `its own compiler's output is CMS-DB-04. Compiled form: ${compiled.css}`,
    ).toBeNull()
  })

  it('covers every construct the policy says it supports', () => {
    // A cheap tripwire. The value of this table is its breadth, and a table
    // that quietly loses rows in a merge stops being evidence of anything.
    expect(ACCEPTED.length).toBeGreaterThanOrEqual(34)
  })

  it('derives the same scope in both layers, so they are answering one question', async () => {
    const { rows } = await pool.query<{ scope: string }>(`SELECT '.cms-section--' || $1::text AS scope`, [SLUG])
    expect(sectionScopeSelector(SLUG)).toBe(rows[0]!.scope)
    expect(sectionScopeSelector(SLUG)).toBe(SCOPE)
  })
})

describe('both gates still refuse what the policy does not emit', () => {
  it('refuses a branch that is not scoped at all', async () => {
    const css = `${SCOPE} .a,body{display:none}`
    expect(validateCompiledCss(css, SCOPE).join(' ')).toContain('outside its section')
    expect(await sqlDefect(css)).toContain('outside its section')
  })

  it('refuses a branch scoped to a different definition', async () => {
    const css = '.cms-section--somebody-else .a{color:red}'
    expect(validateCompiledCss(css, SCOPE).join(' ')).toContain('outside its section')
    expect(await sqlDefect(css)).toContain('outside its section')
  })

  it('refuses a stale css_policy_version even though the stylesheet itself is fine', async () => {
    // The artifact is exactly what the current policy would emit. What is stale
    // is the claim about which policy checked it, and neither layer is allowed
    // to shrug that off because the bytes look familiar.
    const css = scopeCss('.a{color:red}', SCOPE).css
    expect(validateCompiledCss(css, SCOPE)).toEqual([])
    expect(
      compiledCssProblems({
        section_def_id: '00000000-0000-0000-0000-000000000001',
        version: 1,
        slug: SLUG,
        compiled_ast: { nodes: [], policyVersion: 4, cssPolicyVersion: CSS_POLICY_VERSION - 1 },
        css,
        css_policy_version: CSS_POLICY_VERSION - 1,
      }).join(' '),
    ).toContain(`policy version ${CSS_POLICY_VERSION - 1}`)
    expect(await sqlDefect(css, CSS_POLICY_VERSION - 1)).toContain('CSS policy version')
  })

  it('refuses compiled CSS whose policy version is unknown', async () => {
    // NULL is what every row from before the authored/compiled split carries.
    const css = scopeCss('.a{color:red}', SCOPE).css
    expect(await sqlDefect(css, null)).toContain('no CSS policy version')
  })

  it('refuses an @import', async () => {
    const css = '@import url(/other.css);'
    expect(validateCompiledCss(css, SCOPE).join(' ')).toContain('external resource')
    expect(await sqlDefect(css)).toContain('at-rule the CSS policy removes')
  })

  it('refuses markup in the CSS', async () => {
    const css = `${SCOPE} .a{content:"</style><script>alert(1)</script>"}`
    expect(validateCompiledCss(css, SCOPE).join(' ')).toContain('markup')
    expect(await sqlDefect(css)).toContain('markup')
  })

  it('refuses a stylesheet whose string is never closed', async () => {
    // String-awareness is what lets the gate read `content:"} body{…} "` as one
    // declaration instead of a hidden rule. The same reading would let an
    // unterminated string swallow the rest of the stylesheet, so SQL says it
    // cannot tell rather than saying nothing is wrong.
    const css = `${SCOPE} .a{content:"} body{display:none} `
    expect(validateCompiledCss(css, SCOPE).join(' ')).toContain('could not be parsed')
    expect(await sqlDefect(css)).toContain('never closed')
  })
})

describe('a construct the compiler refuses that both validators accept', () => {
  // FINDING for the lead, left as a test rather than a fix because it is in
  // packages/renderer/src/css.ts, outside the scope of this test.
  //
  // `emit()` refuses any selector containing `>`:
  //
  //     if (/[<>]/.test(normalize(selector))) {
  //       refuse(violations, blocking, 'a selector cannot contain markup')
  //
  // so a child combinator cannot be compiled at all. Nothing else in the system
  // agrees: `selector.ts` names `>` in DESCENDING_COMBINATORS on purpose,
  // `validateCompiledCss` accepts `.cms-section--d .a > .b`, and so does
  // `app.compiled_css_defect`. Only `<` can end the `<style>` element the
  // result ships inside — `>` is inert there, and `scopeCss` already re-checks
  // the whole emitted stylesheet for `<` on the way out. The same line in the
  // at-rule branch refuses Media Queries Level 4 range syntax,
  // `@media (width > 600px)`, for the same non-reason.
  //
  // These assert what the code does today. When the check is narrowed to `<`,
  // both flip and the two cases move into ACCEPTED above.
  it('compiles a child combinator, and all three layers agree on it', async () => {
    // This documented a disagreement: the compiler refused any selector
    // containing `>` as "markup", while selectorIsScoped names `>` in
    // DESCENDING_COMBINATORS deliberately and both validators accepted it. Only
    // `<` can end the <style> element the result ships inside, so the compiler's
    // test was narrowed to that character.
    const compiled = scopeCss('.a > .b{color:red}', SCOPE)
    expect(compiled.blocking).toEqual([])
    expect(compiled.css).toBe(`${SCOPE} .a > .b{color:red}`)
    expect(validateCompiledCss(compiled.css, SCOPE)).toEqual([])
    expect(await sqlDefect(compiled.css)).toBeNull()
  })

  it('still refuses the character that can actually close the element', async () => {
    expect(scopeCss('.a</style>x{color:red}', SCOPE).blocking).toContain('a selector cannot contain markup')
    expect(scopeCss('.a{content:"</style><script>"}', SCOPE).css).not.toContain('</style>')
  })

  it('compiles a media query written in range syntax', async () => {
    // Media Queries Level 4. Refused by the same over-broad `[<>]` test.
    const compiled = scopeCss('@media (width > 600px){.a{color:red}}', SCOPE)
    expect(compiled.blocking).toEqual([])
    expect(compiled.css).toBe(`@media (width > 600px){${SCOPE} .a{color:red}}`)
    expect(await sqlDefect(compiled.css)).toBeNull()
  })
})
