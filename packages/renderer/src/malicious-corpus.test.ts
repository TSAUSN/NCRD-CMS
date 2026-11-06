// Drive the whole malicious corpus through every sink (SPEC §9, M2 exit:
// "malicious HTML/CSS fixtures fail").
//
// The organising idea is cross-application: a payload written against rich text
// is also tried as a URL, as a CSS value, and as a section template. Most of
// those pairings are boring. The interesting ones are the pairings nobody would
// have written by hand — a CSS escape pasted into a template, an SVG polyglot
// used as a link — and those are exactly the ones a corpus finds and a
// hand-written test does not.
//
// Every case is checked against one shared list of forbidden output rather than
// a per-case expectation, because a per-case expectation can only fail in a way
// its author already imagined.
import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_ANYWHERE,
  FORBIDDEN_IN_ATTRIBUTES,
  FORBIDDEN_IN_CSS,
  FORBIDDEN_TAGS,
  MALICIOUS_CASES,
  type MaliciousCase,
} from './fixtures/malicious.ts'
import { compileSection } from './compile.ts'
import { CSS_POLICY_VERSION, scopeCss } from './css.ts'
import { safeUrl } from './escape.ts'
import { renderPage, type RenderManifest, type SiteShell } from './render.ts'
import { sanitizeRichText } from './richtext.ts'

/**
 * The fragment with every attribute *value* blanked out.
 *
 * Tag-shaped markers are judged against this rather than the raw text, because
 * `title="&lt;img onerror=x&gt;"` contains the characters of an event handler
 * and none of its meaning. Escaping is what success looks like here; a check
 * that cannot tell escaped text from live markup reports every success as a
 * failure, and a suite that cries wolf is a suite people stop reading.
 */
function structureOf(html: string): string {
  // Only the tags, with their values blanked. Text between tags is dropped
  // entirely: an escaped payload sitting in a paragraph is characters, not
  // markup, and judging it as markup marks correct escaping as a failure.
  return (html.match(/<\/?[a-zA-Z][^>]*>/g) ?? []).map(tag => tag.replace(/=\s*(?:"[^"]*"|'[^']*')/g, '=""')).join('')
}

/**
 * Attribute values that are fetched or navigated, paired with their name.
 *
 * `href="javascript:..."` executes; `title="javascript:..."` is a tooltip. Only
 * the first kind is a finding, so only the first kind is judged.
 */
const URL_BEARING = /^(href|src|srcset|action|formaction|data|poster|style|xlink:href|background)$/i
function fetchedValues(html: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  for (const tag of html.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      const name = m[1]!
      if (URL_BEARING.test(name)) out.push({ name, value: m[2] ?? m[3] ?? m[4] ?? '' })
    }
  }
  return out
}

/** Fail with the name of the marker, not just a boolean. */
function expectInert(output: string, context: string): void {
  const tags = FORBIDDEN_TAGS.filter(f => f.pattern.test(structureOf(output)))
  expect(
    tags.map(f => f.name),
    `${context} produced: ${output.slice(0, 300)}`,
  ).toEqual([])

  const dangerous = FORBIDDEN_IN_ATTRIBUTES.filter(f => f.name !== 'off-site fetch')
  for (const { name, value } of fetchedValues(output)) {
    const found = dangerous.filter(f => f.pattern.test(value))
    expect(
      found.map(f => f.name),
      `${context} ${name}=${JSON.stringify(value)}`,
    ).toEqual([])
  }
}

/** Generated CSS, judged by what can escape a <style> element. */
function expectCssInert(css: string, context: string): void {
  const found = FORBIDDEN_IN_CSS.filter(f => f.pattern.test(css))
  expect(
    found.map(f => f.name),
    `${context} produced: ${css.slice(0, 300)}`,
  ).toEqual([])
}

/**
 * A whole document, which legitimately contains the shell's own <style> and
 * <meta>. The body is held to the full standard; the document is held to the
 * markers that are never legitimate anywhere.
 */
function expectPageInert(html: string, context: string): void {
  const bodyAt = html.indexOf('<body')
  expect(bodyAt, `${context}: no body`).toBeGreaterThan(-1)
  expectInert(html.slice(bodyAt), `${context} body`)

  const found = FORBIDDEN_ANYWHERE.filter(f => f.pattern.test(structureOf(html)))
  expect(
    found.map(f => f.name),
    `${context} document: ${html.slice(0, 300)}`,
  ).toEqual([])
}

/** Every tag the sanitizer emitted, lowercased. */
function tagsIn(html: string): string[] {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map(m => m[1]!.toLowerCase())
}
const RICHTEXT_ALLOWLIST = new Set([
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h2',
  'h3',
  'h4',
  'a',
])

const SHELL: SiteShell = {
  site: { id: 'site', name: 'Site', slug: 'site' },
  theme: {},
  navigation: [],
  canonical_host: null,
  staging_host: null,
}

function manifestWith(
  values: Record<string, unknown>,
  template: string,
  slotKind: 'text' | 'richtext' | 'link',
): RenderManifest {
  const compiled = compileSection({
    sourceHtml: template,
    slots: [{ id: 'value', kind: slotKind, label: 'Value', constraints: {} }],
  })
  return {
    page: { id: 'p', version_id: 'v', title: 'Title', path: '/p' },
    meta: {},
    sections: [
      {
        def: {
          section_def_id: 'd',
          version: 1,
          slug: 'd',
          compiled_ast: compiled.ast,
          css: compiled.css,
          slots: [{ id: 'value', kind: slotKind, label: 'Value', constraints: {} }],
          render_hash: 'h',
          sanitizer_policy_version: 1,
          css_policy_version: CSS_POLICY_VERSION,
        },
        instance: { label: 'S', hidden: false, hidden_at: [], values },
      },
    ],
  } as unknown as RenderManifest
}

const cases = MALICIOUS_CASES as readonly MaliciousCase[]
const label = (c: MaliciousCase) => `${c.id} (${c.intent})`

describe('the corpus is a corpus', () => {
  it('has broad coverage across every sink', () => {
    const bySink = new Map<string, number>()
    for (const c of cases) bySink.set(c.sink, (bySink.get(c.sink) ?? 0) + 1)
    for (const sink of ['html', 'richtext', 'url', 'css']) {
      expect(bySink.get(sink) ?? 0, `${sink} fixtures`).toBeGreaterThan(5)
    }
  })

  it('gives every case a stable id and a stated intent', () => {
    const ids = cases.map(c => c.id)
    expect(new Set(ids).size, 'ids are unique').toBe(ids.length)
    for (const c of cases) expect(c.intent.length, `${c.id} states an intent`).toBeGreaterThan(10)
  })
})

// ------------------------------------------------------------------- URLs

describe('every payload, as a URL', () => {
  it.each(cases.map(c => [label(c), c] as const))('%s', (_l, c) => {
    const url = safeUrl(c.payload)
    // Judged as an attribute value, which is where it lands. An off-site https
    // link is legitimate — an author may link anywhere — so what matters is
    // only that the scheme cannot execute.
    expectInert(`<a href="${url}">x</a>`, `safeUrl(${c.id})`)
    // Anything not recognised as inert must degrade to a dead link, never to
    // "pass it through and hope the attribute escaping saves us".
    const inert =
      url === '#' ||
      url.startsWith('/') ||
      url.startsWith('#') ||
      url.startsWith('?') ||
      /^(https?:|mailto:|tel:)/i.test(url)
    expect(inert, `safeUrl returned ${JSON.stringify(url)}`).toBe(true)
  })
})

// -------------------------------------------------------------- rich text

describe('every payload, as rich text', () => {
  it.each(cases.map(c => [label(c), c] as const))('%s', (_l, c) => {
    expectInert(sanitizeRichText(c.payload), `sanitizeRichText(${c.id})`)
  })

  it.each(cases.map(c => [label(c), c] as const))('%s emits only allowlisted tags', (_l, c) => {
    // The stronger property than "no forbidden markers": the output is built
    // from a closed set, so a tag nobody anticipated cannot appear either.
    //
    // Deliberately not an idempotence check. sanitizeRichText takes authored
    // text and returns HTML — running it on its own output double-escapes, and
    // that is correct. Requiring a fixed point would mean the sanitizer had to
    // treat its own escaping as markup, which is the decode-then-re-parse step
    // that mutation-XSS relies on.
    const unexpected = [...new Set(tagsIn(sanitizeRichText(c.payload)))].filter(t => !RICHTEXT_ALLOWLIST.has(t))
    expect(unexpected, `${c.id} emitted tags outside the allowlist`).toEqual([])
  })
})

// -------------------------------------------------------------------- CSS

describe('every payload, as section CSS', () => {
  it.each(cases.map(c => [label(c), c] as const))('%s', (_l, c) => {
    // Both as a whole stylesheet and as a declaration inside a block: the
    // parser has different paths for each.
    expectCssInert(scopeCss(c.payload, '.scope').css, `scopeCss(${c.id})`)
    expectCssInert(scopeCss(`.a{content:"x";background:${c.payload}}`, '.scope').css, `scopeCss(declaration ${c.id})`)
    expectCssInert(scopeCss(`.a{color:red}${c.payload}`, '.scope').css, `scopeCss(appended ${c.id})`)
  })

  it.each(cases.filter(c => c.sink === 'css').map(c => [label(c), c] as const))(
    '%s: anything dropped is reported, never silently discarded',
    (_l, c) => {
      const { css, violations } = scopeCss(c.payload, '.scope')
      // Either it shipped, or the author is told why it did not. Silence with
      // no output is the outcome that leaves someone debugging for an hour.
      expect(css !== '' || violations.length > 0, `${c.id} produced no CSS and no violation`).toBe(true)
    },
  )

  it('keeps every selector inside its own scope', () => {
    // Split on braces that are not inside a string: `a[title="}"]` is one
    // selector, and a naive split turns it into two, one of which looks
    // unscoped. The check has to understand what it is reading.
    const preludes = (css: string): string[] => {
      const out: string[] = []
      let quote: string | null = null
      let start = 0
      let depth = 0
      for (let i = 0; i < css.length; i += 1) {
        const ch = css[i]!
        if (quote) {
          if (ch === quote) quote = null
          continue
        }
        if (ch === '"' || ch === "'") {
          quote = ch
          continue
        }
        if (ch === '{') {
          if (depth === 0) out.push(css.slice(start, i))
          depth += 1
        } else if (ch === '}') {
          depth -= 1
          if (depth === 0) start = i + 1
        }
      }
      return out.map(p => p.trim()).filter(Boolean)
    }

    for (const c of cases) {
      const { css } = scopeCss(c.payload, '.scope')
      for (const selector of preludes(css)) {
        if (selector.startsWith('@')) continue
        expect(selector, `${c.id}: unscoped selector`).toContain('.scope')
      }
    }
  })
})

// -------------------------------------------------- section templates (parser)

describe('every payload, as a section template', () => {
  it.each(cases.map(c => [label(c), c] as const))('%s', (_l, c) => {
    const result = compileSection({ sourceHtml: c.payload, slots: [] })
    // Active markup is not silently accepted: either the compiler refuses it
    // outright, or it marks the definition as trusted code, which cannot be
    // published without a super admin (SPEC §6.5, §8).
    // Deliberately not a copy of the compiler's own ACTIVE_MARKUP. An oracle
    // copied from the thing it is checking agrees with it by construction, and
    // that is exactly how `<img/onerror=…>` passed this suite while the
    // compiler's regex missed it — both required whitespace before the
    // handler. This one over-approximates on purpose: it may call something
    // active that is not, and the compiler then has to be at least as
    // suspicious as the test is.
    const activeMarkup =
      /<[^>]*\bon[a-z]+\s*=|<\s*(script|iframe|object|embed|form|input|link|meta|base)\b|(javascript|vbscript)\s*:/i.test(
        c.payload,
      )
    if (activeMarkup) {
      expect(
        result.carriesTrustedCode || result.problems.length > 0,
        `${c.id}: active markup accepted without a marker or a problem`,
      ).toBe(true)
    }
    // Whatever it decided, the compiled CSS is still policed.
    expectInert(result.css, `compileSection(${c.id}).css`)
  })

  it.each(cases.map(c => [label(c), c] as const))('%s as authored CSS beside a template', (_l, c) => {
    const result = compileSection({
      sourceHtml: '<section>{{value}}</section>',
      sourceCss: c.payload,
      slots: [{ id: 'value', kind: 'text', label: 'Value', constraints: {} }],
    })
    expectInert(result.css, `compileSection(css ${c.id})`)
  })
})

// ------------------------------------------------------- the whole page

describe('every payload, rendered into a published page', () => {
  it.each(cases.map(c => [label(c), c] as const))('%s in a text slot', (_l, c) => {
    const { html } = renderPage({
      manifest: manifestWith({ value: c.payload }, '<section>{{value}}</section>', 'text'),
      shell: SHELL,
      isStaging: false,
    })
    expectPageInert(html, `renderPage(text ${c.id})`)
  })

  it.each(cases.map(c => [label(c), c] as const))('%s in a rich text slot', (_l, c) => {
    const { html } = renderPage({
      manifest: manifestWith({ value: c.payload }, '<section>{{value}}</section>', 'richtext'),
      shell: SHELL,
      isStaging: false,
    })
    expectPageInert(html, `renderPage(richtext ${c.id})`)
  })

  it.each(cases.map(c => [label(c), c] as const))('%s in a link slot', (_l, c) => {
    const { html } = renderPage({
      manifest: manifestWith({ value: { url: c.payload, label: c.payload } }, '<section>{{value}}</section>', 'link'),
      shell: SHELL,
      isStaging: false,
    })
    expectPageInert(html, `renderPage(link ${c.id})`)
  })

  it.each(cases.map(c => [label(c), c] as const))('%s in an attribute position', (_l, c) => {
    // The slot sits inside an attribute, which is the position where a value
    // that is safe as text can still break out.
    const { html } = renderPage({
      manifest: manifestWith({ value: c.payload }, '<section title="{{value}}">x</section>', 'text'),
      shell: SHELL,
      isStaging: false,
    })
    expectPageInert(html, `renderPage(attribute ${c.id})`)
    // The section element still has exactly one title attribute. A second one
    // on that element would mean the stored value closed the first and opened
    // its own — which is the whole point of this position. Counted on the
    // section tag alone, because the payload's own text may legitimately
    // contain `title=` as escaped content.
    const sectionTag = /<section[^>]*>/.exec(structureOf(html))?.[0] ?? ''
    expect((sectionTag.match(/title=/g) ?? []).length, `${c.id}: ${sectionTag}`).toBeLessThanOrEqual(1)
  })
})
