// Custom CSS policy.
//
// Two things this has to get right, and version 2 of the policy got only the
// first one.
//
// It has to understand CSS. Hand-written tokenizers fail on the constructs
// nobody writes by hand but everybody's attacker does: a `}` inside a string, a
// comment splitting a keyword, an unterminated block. PostCSS is the parser
// used here instead — see the note on the dependency below.
//
// And it has to remember where the result *goes*. Scoped CSS is emitted into a
// `<style>` element, which is HTML raw text: nothing inside it is markup, and
// exactly one sequence ends it — `</style`. A stylesheet that contains that
// sequence stops being a stylesheet at that point and the rest becomes
// document. So the invariant here is blunt and checkable: **the emitted CSS
// never contains a `<` at all.** Declaration values get theirs escaped as
// `\3c`, which renders identically; anything else containing one is refused.
// That closes the raw-text breakout completely, including the forms that only
// appear after comment removal joins text together (`</sty/**/le>`).
//
// WHY A SECOND PARSER FOR VALUES
//
// PostCSS gives structure — rules, at-rules, declarations — and stops at the
// declaration value, which it hands over as a string. Inspecting that string
// with a regular expression is how `u\72l(https://evil.test/x)` shipped: to a
// regex looking for `url(` it is not a url, and to a browser it is, because CSS
// resolves escapes inside identifiers before deciding what a function is.
//
// @csstools/css-tokenizer is the CSS Syntax Level 3 tokenizer, and it resolves
// those escapes the way the specification says to: `u\72l(...)`, `U\52 L(...)`
// and `url(...)` all tokenize to a url-token whose value is the URL. The
// security decision is made on the tokens, so there is nothing left for a
// pattern to miss.
//
// WHY POSTCSS
//
// It was already resolvable in this workspace as a transitive dependency of
// Next.js, so declaring it adds a name to package.json and nothing to the
// install. It is the parser underneath most of the CSS toolchain, it tracks the
// CSS syntax specification, and — the property that matters most here — it
// *throws* on unclosed strings, blocks and brackets rather than returning a
// best-effort partial parse. Failing closed on malformed input is a policy
// decision this file wants to make, and a parser that guesses would take that
// decision away.
import postcss, { type AtRule, type Root, type Rule } from 'postcss'
import { tokenize, TokenType, type CSSToken } from '@csstools/css-tokenizer'
import { narrowScopedSelector, scopeSelectorList, selectorIsScoped } from './selector.ts'

export const CSS_POLICY_VERSION = 6

/** At-rules that fetch or redefine the document. Never allowed. */
const LOADING_AT_RULES = new Set(['import', 'charset', 'namespace', 'document'])
/** At-rules that wrap ordinary rules; their contents are scoped and kept. */
const CONDITIONAL_AT_RULES = new Set(['media', 'supports', 'container', 'layer'])

const ACTIVE_VALUES =
  /(expression\s*\(|javascript\s*:|vbscript\s*:|behaviou?r\s*:|-moz-binding|@import|@charset|@namespace)/i

/**
 * A registered custom property (`@property`). Tailwind v4 composes its shadow,
 * ring, border-style, gradient and transform utilities from custom properties
 * whose starting values only `@property` provides: dropping it left
 * `box-shadow: var(--tw-shadow), …` with nothing to substitute, so cards lost
 * their shadow and ring and `border` lost its style. The registration itself is
 * not kept (it is document-wide); its starting value is declared inside the
 * section instead, on every element when the property does not inherit — the
 * same fallback Tailwind ships for browsers without `@property`.
 */
type RegisteredProperty = { name: string; initial: string; inherits: boolean }
const CUSTOM_PROPERTY = /^--[A-Za-z_][A-Za-z0-9_-]{0,100}$/

function registeredProperty(at: AtRule): RegisteredProperty | null {
  const name = at.params.trim()
  if (!CUSTOM_PROPERTY.test(name)) return null
  let initial = '',
    inherits = true,
    syntax = ''
  for (const node of at.nodes ?? []) {
    if (node.type !== 'decl') continue
    const prop = node.prop.toLowerCase()
    if (prop === 'initial-value') initial = normalize(node.value)
    else if (prop === 'inherits') inherits = node.value.trim().toLowerCase() === 'true'
    else if (prop === 'syntax') syntax = node.value.trim().toLowerCase()
  }
  // A registered property is typed: `<length>` with initial value `0` computes
  // to `0px`, so `calc(1px + var(--tw-ring-offset-width))` works. Unregistered,
  // the bare `0` would make that calc — and the whole box-shadow — invalid.
  if (/^-?0(\.0+)?$/.test(initial)) {
    const unit = syntax.includes('<length')
      ? 'px'
      : syntax.includes('<percentage')
        ? '%'
        : syntax.includes('<angle')
          ? 'deg'
          : syntax.includes('<time')
            ? 's'
            : ''
    initial = `0${unit}`
  }
  if (
    initial.includes('<') ||
    /[;{}\\]/.test(initial) ||
    /url\s*\(/i.test(initial) ||
    ACTIVE_VALUES.test(initial) ||
    initial.length > 500
  )
    return null
  return { name, initial, inherits }
}

/** The starting values, inside the section only, before every other rule so any rule that sets them wins. */
function propertyDefaults(properties: readonly RegisteredProperty[], scope: string): string {
  const byName = new Map(
    properties.filter(property => property.initial !== '').map(property => [property.name, property]),
  )
  const declare = (list: RegisteredProperty[]) => list.map(property => `${property.name}:${property.initial}`).join(';')
  const own = [...byName.values()].filter(property => !property.inherits),
    inherited = [...byName.values()].filter(property => property.inherits)
  return (
    (own.length ? `${scope},${scope} *,${scope} ::before,${scope} ::after{${declare(own)}}` : '') +
    (inherited.length ? `${scope}{${declare(inherited)}}` : '')
  )
}

export type CssResult = {
  css: string
  /** Things the author should know about, whether or not anything shipped. */
  violations: string[]
  /**
   * Violations that make the stylesheet unusable rather than partly usable.
   *
   * Malformed CSS is here: a stylesheet with an unclosed block has no
   * well-defined meaning, and emitting the part that happened to parse is a
   * guess about intent dressed up as a result.
   */
  blocking: string[]
}

/**
 * Resolve CSS escapes the way a browser's tokenizer does: `\` plus one to six
 * hex digits (with an optional single trailing whitespace) is a code point, and
 * `\` plus anything else is that character literally.
 *
 * Used only to decide whether a value is active. The original text is what
 * ships, so a legitimate `content:"\201C"` still renders a quotation mark.
 */
export function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|(.))/gs,
    (_all, hex: string | undefined, literal: string | undefined) => {
      if (hex === undefined) return literal ?? ''
      const code = Number.parseInt(hex, 16)
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return '�'
      }
      return String.fromCodePoint(code)
    },
  )
}

/** The form a value is judged in: escapes resolved, spacing collapsed. */
function normalize(text: string): string {
  return decodeCssEscapes(text).replace(/\s+/g, ' ')
}

/**
 * Escape every `<` as a CSS hex escape.
 *
 * `\3c` is `<` to a CSS parser and four inert characters to an HTML tokenizer,
 * so a `content:"</style>"` string keeps its meaning and loses its teeth. The
 * trailing space is part of the escape syntax and is consumed by it.
 */
function escapeStrings(value: string): string {
  return value.replace(/"[^"]*"|'[^']*'/g, literal => literal.replaceAll('<', '\\3c '))
}

/** A refusal is always reported; blocking ones also stop the stylesheet. */
function refuse(violations: string[], blocking: string[], message: string): void {
  violations.push(message)
  blocking.push(message)
}

/**
 * Functions whose argument is fetched. `url()` is the obvious one; the others
 * take urls too, and an image-set full of off-site sources is the same request
 * by a longer route.
 */
const URL_BEARING_FUNCTIONS = new Set([
  'url',
  'src',
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  'element',
  'paint',
])

/** A path this site serves, as opposed to somewhere else's server. */
function isSameOrigin(url: string): boolean {
  const trimmed = url.trim()
  return trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')
}

type UrlFinding = {
  /** The span to replace, which is not always the span the URL occupies. */
  start: number
  end: number
  url: string
  sameOrigin: boolean
  /** How the normalised form should be written back. */
  as: 'url' | 'string'
}

/**
 * Every URL a declaration value would fetch, found by tokenizing rather than by
 * matching text.
 *
 * Returns `null` when the value cannot be tokenized cleanly — a bad-url token,
 * an unclosed function, a `url()` with nothing in it — because a value a browser
 * will recover from in its own way is not one this policy should be guessing
 * about.
 */
function findUrls(value: string): UrlFinding[] | null {
  let tokens: CSSToken[]
  try {
    tokens = tokenize({ css: value })
  } catch {
    return null
  }

  const findings: UrlFinding[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    const [type, , start, end, extra] = token

    if (type === TokenType.BadURL || type === TokenType.BadString) return null

    if (type === TokenType.URL) {
      const url = String((extra as { value?: unknown })?.value ?? '')
      findings.push({ start, end, url, sameOrigin: isSameOrigin(url), as: 'url' })
      continue
    }

    if (type !== TokenType.Function) continue
    // The tokenizer has already resolved escapes in the name, so `u\72l`, `URL`
    // and `url` are the same string by the time they reach here.
    const name = String((extra as { value?: unknown })?.value ?? '').toLowerCase()
    if (!URL_BEARING_FUNCTIONS.has(name)) continue

    // Find this function's matching close paren.
    let depth = 1
    let close = -1
    const strings: CSSToken[] = []
    for (let j = i + 1; j < tokens.length; j += 1) {
      const inner = tokens[j]!
      if (inner[0] === TokenType.Function || inner[0] === TokenType.OpenParen) depth += 1
      else if (inner[0] === TokenType.CloseParen) {
        depth -= 1
        if (depth === 0) {
          close = j
          break
        }
      } else if (depth === 1 && inner[0] === TokenType.String) strings.push(inner)
    }
    if (close === -1) return null

    if (name === 'url' || name === 'src') {
      // `url( "…" )`: the whole call is one URL, so the whole call is what gets
      // replaced. Replacing only the string left the original `url(` wrapper in
      // place and produced `url( url("…") )`.
      const argument = strings[0]
      if (!argument || strings.length > 1) return null
      const url = String((argument[4] as { value?: unknown })?.value ?? '')
      findings.push({
        start,
        end: tokens[close]![3],
        url,
        sameOrigin: isSameOrigin(url),
        as: 'url',
      })
      i = close
      continue
    }

    // image-set() and friends take bare strings as sources, and any nested
    // url() inside them is found by the outer loop on its own.
    for (const argument of strings) {
      const url = String((argument[4] as { value?: unknown })?.value ?? '')
      findings.push({
        start: argument[2],
        end: argument[3],
        url,
        sameOrigin: isSameOrigin(url),
        as: 'string',
      })
    }
  }
  return findings
}

/** Same-origin paths only: published CSS must not be able to phone home. */
function checkUrls(declarations: string): { text: string; offSite: boolean; malformed: boolean } {
  const findings = findUrls(declarations)
  if (findings === null) return { text: declarations, offSite: false, malformed: true }
  if (findings.some(f => !f.sameOrigin)) return { text: declarations, offSite: true, malformed: false }

  // Normalised on the way out, from the back so earlier offsets stay valid. The
  // author's escaping is replaced by the resolved path in a quoted `url()`,
  // which is the same request in a form nothing downstream has to decode again.
  let text = declarations
  for (const finding of [...findings].sort((a, b) => b.start - a.start)) {
    const safe = finding.url.trim().split('\\').join('\\\\').split('"').join('\\"')
    const replacement = finding.as === 'url' ? `url("${safe}")` : `"${safe}"`
    text = `${text.slice(0, finding.start)}${replacement}${text.slice(finding.end + 1)}`
  }
  return { text, offSite: false, malformed: false }
}

/** Split a selector list on commas outside strings and brackets. */
function splitSelectors(prelude: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < prelude.length; i += 1) {
    const ch = prelude[i]!
    if (quote) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) {
      out.push(prelude.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(prelude.slice(start).trim())
  return out.filter(Boolean)
}

/**
 * Scope a selector list, or refuse it.
 *
 * String replacement put the scope next to characters an author chose, and CSS
 * identifiers do not end where the characters suggest — `&\\65 vil` concatenated
 * into `.cms-section--d\\65 vil`, which is the class `cms-section--devil`. This
 * builds the selector in a parsed tree and then re-reads it, so the answer is
 * about identifiers rather than about text (selector.ts).
 */
function scopeSelectors(prelude: string, scopeSelector: string): string | null {
  return scopeSelectorList(prelude, scopeSelector)
}

/**
 * Scope every selector under `scopeSelector`.
 *
 * A block that tries to escape — through an at-rule that loads a resource, an
 * off-site url(), an active value, or markup aimed at the surrounding `<style>`
 * element — is dropped and reported rather than quietly rewritten, because an
 * author who wrote it deserves to be told it did not ship.
 */
export function scopeCss(source: string, scopeSelector: string): CssResult {
  const violations: string[] = []
  const blocking: string[] = []
  if (source.trim() === '') return { css: '', violations, blocking }

  let root: Root
  try {
    root = postcss.parse(source)
  } catch (error) {
    // Unclosed string, block or bracket. There is no honest partial answer:
    // where the author intended each construct to end is exactly the
    // information that is missing.
    const reason = (error as { reason?: string }).reason ?? (error as Error).message
    return {
      css: '',
      violations: [`this CSS could not be parsed: ${reason}`],
      blocking: [`this CSS could not be parsed: ${reason}`],
    }
  }

  const properties: RegisteredProperty[] = []
  const rules = emit(root, scopeSelector, violations, blocking, properties)
  const css = propertyDefaults(properties, scopeSelector) + rules

  // The invariant, checked on the way out rather than assumed on the way in: a
  // `<` in a `<style>` element is the only character that can end it early, so
  // nothing that ships may contain one.
  if (css.includes('<')) {
    return {
      css: '',
      violations: [...new Set([...violations, 'this CSS could not be made safe to embed in a page'])],
      blocking: [...new Set([...blocking, 'this CSS could not be made safe to embed in a page'])],
    }
  }

  return { css, violations: [...new Set(violations)], blocking: [...new Set(blocking)] }
}

/** Stored CSS is already governed. Only its selector roots are narrowed here;
 * declarations and conditional rules remain intact. :where contributes zero
 * specificity, preserving the precedence of per-block custom CSS. */
export function narrowCompiledCss(css: string, scope: string, indices: readonly number[]): string | null {
  if (validateCompiledCss(css, scope).length) return null
  try {
    const root = postcss.parse(css)
    let valid = true
    root.walkRules(rule => {
      const selector = narrowScopedSelector(rule.selector, scope, indices)
      if (selector === null) valid = false
      else rule.selector = selector
    })
    const output = root.toString()
    // The parser may serialize escapes. Preserve the HTML raw-text invariant.
    // The stored-artifact size cap is not reapplied to generated selector ID
    // lists; the overall manifest already bounds the number of blocks.
    return valid && !output.includes('<') ? output : null
  } catch {
    return null
  }
}

function emit(
  container: Root | AtRule,
  scopeSelector: string,
  violations: string[],
  blocking: string[],
  properties: RegisteredProperty[] = [],
): string {
  let css = ''
  for (const node of container.nodes ?? []) {
    if (node.type === 'atrule') {
      const at = node as AtRule
      const name = at.name.toLowerCase()

      if (LOADING_AT_RULES.has(name)) {
        violations.push('at-rules that load external resources are not allowed')
        continue
      }
      if (name === 'property') {
        const property = registeredProperty(at)
        if (property) properties.push(property)
        else
          violations.push(`@property ${normalize(at.params).slice(0, 60)} has a starting value this policy cannot keep`)
        continue
      }
      if (!CONDITIONAL_AT_RULES.has(name)) {
        violations.push(`@${at.name} is not supported in section CSS`)
        continue
      }
      // The prelude is a sink too. `@media </style><script>…{…}` parses fine —
      // PostCSS is happy to treat that whole string as a media query — and used
      // to ship verbatim, which put the raw sequence straight into the page.
      const prelude = normalize(at.params)
      if (prelude.includes('<')) {
        refuse(violations, blocking, 'an at-rule condition cannot contain markup')
        continue
      }
      if (ACTIVE_VALUES.test(prelude)) {
        violations.push('active CSS values are not allowed')
        continue
      }
      const inner = emit(at, scopeSelector, violations, blocking, properties)
      if (inner !== '') css += `@${at.name} ${at.params.trim()}{${inner}}`
      continue
    }

    if (node.type !== 'rule') continue
    const rule = node as Rule
    const selector = rule.selector

    // A selector cannot contain markup. Something that does is either a
    // template pasted into the CSS field by mistake, or an attempt to close the
    // <style> element the result ships inside.
    //
    // `<` only. Refusing `>` as well meant this compiler could not emit a child
    // combinator at all — `.a > .b` was blocking — while `selectorIsScoped`
    // names `>` in DESCENDING_COMBINATORS on purpose and both validators accept
    // it. Three layers disagreed about ordinary CSS, and the one doing the
    // refusing was the only one that could not say why: `>` cannot end a
    // `<style>` element. The at-rule prelude above had the same problem, where
    // it refused Media Queries Level 4 range syntax, `@media (width > 600px)`.
    if (normalize(selector).includes('<')) {
      refuse(violations, blocking, 'a selector cannot contain markup')
      continue
    }
    if (ACTIVE_VALUES.test(normalize(selector))) {
      violations.push('active CSS values are not allowed')
      continue
    }

    const declarations: string[] = []
    let dropped = false
    for (const child of rule.nodes ?? []) {
      // A comment is the author's note, not a rule: it is left out of the
      // output like every other comment, and is no reason to warn anyone.
      if (child.type === 'comment') continue
      if (child.type !== 'decl') {
        // A nested rule or at-rule inside a rule is not something this policy
        // supports; dropping it silently would change the layout without a word.
        violations.push('nested rules are not supported in section CSS')
        dropped = true
        continue
      }
      const declaration = `${child.prop}:${child.value}`
      if (ACTIVE_VALUES.test(normalize(declaration))) {
        violations.push('active CSS values are not allowed')
        dropped = true
        continue
      }
      const { text, offSite, malformed } = checkUrls(declaration)
      if (malformed) {
        refuse(violations, blocking, 'a declaration value could not be parsed')
        dropped = true
        continue
      }
      if (offSite) {
        violations.push('url() may only reference this site')
        dropped = true
        continue
      }

      // A bare off-site location outside url() and outside a string. Not the
      // URL boundary — findUrls above is, and it works on tokens — but a
      // `background:https://…` that never loads is worth telling an author
      // about rather than shipping as dead text.
      const outsideStrings = decodeCssEscapes(text)
        .replace(/"[^"]*"|'[^']*'/g, '""')
        .replace(/url\([^)]*\)/gi, 'url()')
      if (/(:\/\/|(^|[:\s,])\/\/|(^|[:\s,])\\+[a-zA-Z])/.test(outsideStrings)) {
        violations.push('a declaration may not name an off-site location')
        dropped = true
        continue
      }

      // `<` inside a string is escaped and keeps its meaning; `<` anywhere
      // else in a value is markup that wandered into a stylesheet, and there is
      // nothing to preserve.
      if (/[<]/.test(text.replace(/"[^"]*"|'[^']*'/g, '""'))) {
        refuse(violations, blocking, 'a declaration cannot contain markup')
        dropped = true
        continue
      }
      declarations.push(`${escapeStrings(text)}${child.important ? ' !important' : ''}`)
    }

    if (declarations.length === 0) {
      if (!dropped) violations.push('a rule with no declarations was dropped')
      continue
    }
    // Joined, not appended: a trailing semicolon is legal but it is not what
    // the golden output has said for two milestones, and a cosmetic diff in
    // every stored render hash is a poor way to ship a security fix.
    const scoped = scopeSelectors(selector, scopeSelector)
    if (scoped === null || scoped === '') {
      // The scope could not be inserted so that it means what it says. `&\\65 vil`
      // is the case: replacing the nesting node produces text that re-parses as
      // a different class, so there is no honest way to ship it.
      refuse(violations, blocking, 'a selector could not be confined to this section')
      continue
    }
    css += `${scoped}{${declarations.join(';')}}`
  }
  return css
}

// ================================================= compiled-artifact checks ==

/**
 * Check CSS that claims to have come from this policy already.
 *
 * `scopeCss` compiles authored CSS; this validates the *result*, and the
 * difference matters because compiled CSS arrives from a database row. A row
 * can say `css_policy_version = 5` and contain anything, and the SQL gate can
 * only check what SQL can see — it has no tokenizer, so `@media all{body{…}}`
 * and `.cms-section .safe,body{…}` both looked scoped to it. This is the check
 * that actually holds, and the renderer runs it before emitting a stylesheet.
 *
 * Deliberately validating rather than re-scoping: running the compiler again
 * would prefix an already-prefixed selector and quietly change what the page
 * looks like, which is a different failure from the one being prevented.
 */
export function validateCompiledCss(css: string, scopeSelector: string): string[] {
  if (css.trim() === '') return []
  const violations: string[] = []

  if (css.includes('<')) {
    return ['compiled CSS contains markup, so it did not come from the CSS policy']
  }

  let root: Root
  try {
    root = postcss.parse(css)
  } catch (error) {
    const reason = (error as { reason?: string }).reason ?? (error as Error).message
    return [`compiled CSS could not be parsed: ${reason}`]
  }

  inspect(root, scopeSelector, violations)
  return [...new Set(violations)]
}

function inspect(container: Root | AtRule, scopeSelector: string, violations: string[]): void {
  for (const node of container.nodes ?? []) {
    if (node.type === 'atrule') {
      const at = node as AtRule
      const name = at.name.toLowerCase()
      if (LOADING_AT_RULES.has(name)) {
        violations.push('compiled CSS contains an at-rule that loads an external resource')
        continue
      }
      if (!CONDITIONAL_AT_RULES.has(name)) {
        violations.push(`compiled CSS contains @${at.name}, which the policy does not emit`)
        continue
      }
      if (normalize(at.params).includes('<') || ACTIVE_VALUES.test(normalize(at.params))) {
        violations.push('compiled CSS has an at-rule condition the policy would not emit')
        continue
      }
      // The rules inside a conditional wrapper are rules, and every one of them
      // has to be scoped. Beginning with `@` used to be enough to skip the
      // check entirely, which is how `@media all{body{…}}` passed.
      inspect(at, scopeSelector, violations)
      continue
    }

    if (node.type !== 'rule') {
      violations.push('compiled CSS contains something the policy does not emit')
      continue
    }

    const rule = node as Rule
    // One call, because the selector list is parsed as a list: every branch is
    // checked, and each branch's first compound has to carry the scope's own
    // class or id *as an identifier*. A character-after-the-scope test passed
    // `.cms-section--d\\65 vil`, which is a different class entirely.
    if (!selectorIsScoped(rule.selector, scopeSelector)) {
      violations.push(`compiled CSS has a selector outside its section: ${rule.selector}`)
    }

    for (const child of rule.nodes ?? []) {
      if (child.type !== 'decl') {
        violations.push('compiled CSS contains a nested rule the policy does not emit')
        continue
      }
      const declaration = `${child.prop}:${child.value}`
      if (ACTIVE_VALUES.test(normalize(declaration))) {
        violations.push('compiled CSS contains an active value')
        continue
      }
      // The same URL policy, on the same tokenizer. A compiled artifact is not
      // exempt from it just because something upstream says it was checked.
      const found = findUrls(declaration)
      if (found === null) {
        violations.push('compiled CSS has a declaration value that could not be parsed')
      } else if (found.some(url => !url.sameOrigin)) {
        violations.push('compiled CSS fetches from another site')
      }
    }
  }
}

/** Rewrite only parsed CSS resource references. Used by private canvas paths;
 * selectors, animation rules and non-resource strings keep their meaning. */
export function mapCssResourceUrls(css: string, map: (url: string) => string): string {
  const root = postcss.parse(css)
  root.walkDecls(declaration => {
    const findings = findUrls(declaration.value)
    if (!findings) throw new Error('The stylesheet has an invalid resource reference.')
    let value = declaration.value
    for (const finding of [...findings].sort((a, b) => b.start - a.start)) {
      const mapped = map(finding.url)
      if (mapped === finding.url) continue
      const quoted = JSON.stringify(mapped).replaceAll('<', '\\3c ')
      value =
        value.slice(0, finding.start) +
        (finding.as === 'url' ? `url(${quoted})` : quoted) +
        value.slice(finding.end + 1)
    }
    declaration.value = value
  })
  return root.toString()
}
