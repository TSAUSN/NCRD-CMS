// Preview instrumentation must not decide how a section lays out (SPEC §9).
//
// THE DEFECT. Both renderers wrap an editable region in `<cms-slot data-cms-slot>`
// so the canvas has something to select, outline and type into. For a link or
// an image field the wrapper box was the
// bug: the rendered form is a single `<a>` or `<img>`, so when the definition's
// own stylesheet made that position a flex or grid item — `display:flex` and a
// `gap` on the parent, `flex:1` or a `grid-template-columns` track on the child
// — the *span* became the item and the `<a>` or `<img>` became an ordinary
// in-flow child of it. The canvas then laid the section out differently from the
// published page, in preview only, which is the one place the two paths must
// agree because it is the place an author decides the page is finished.
//
// WHAT THIS FILE PROVES, AND WHAT IT DOES NOT. Layout is a browser's opinion and
// no assertion here asks for it; `e2e/specs/preview-layout.spec.ts` puts both
// documents into Chromium and compares the rectangles, and that spec is the
// oracle. This file holds the two structural facts the fix rests on, because
// both are the kind that rot silently: that every kind whose rendered form is a
// single element is declared `display:contents`, and that every affordance
// expressed on `[data-cms-slot]` is also expressed on the child of a wrapper
// that, generating no box, can paint none of them itself.
import { describe, expect, it } from 'vitest'
import { SLOT_KINDS, STRUCTURED_FIELD_TYPES, STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import { CSS_POLICY_VERSION } from './css.ts'
import { SANITIZER_POLICY_VERSION, compileSection } from './compile.ts'
import { renderSection, type ManifestSection } from './render.ts'
import { PREVIEW_RUNTIME, PREVIEW_STYLES } from './preview-runtime.ts'

type Rule = { selector: string; declarations: string }

/**
 * `PREVIEW_STYLES` read as rules rather than as a string.
 *
 * A substring search would pass on a stylesheet that mentioned `display:contents`
 * in a comment and on one whose mirrored rule carried different declarations
 * from the rule it mirrors, and both of those are the failure this file exists
 * to catch. The sheet has no at-rules and no nesting, so a flat scan for
 * `selector{declarations}` is the whole grammar it needs — and a rule added
 * inside an `@media` block would simply not be seen here, which the last
 * assertion below turns into a failure rather than a silent gap.
 */
function rulesOf(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
    selector: match[1]!.trim(),
    declarations: match[2]!.trim(),
  }))
}

const RULES = rulesOf(PREVIEW_STYLES)

/** Rules that make a wrapper generate no box. */
const CONTENTS_RULES = RULES.filter(rule => /(^|;)\s*display\s*:\s*contents\s*(;|$)/.test(rule.declarations))

/** Kinds named by a `display:contents` rule, as the stylesheet actually spells them. */
const DECLARED_CONTENTS_KINDS = new Set(
  CONTENTS_RULES.flatMap(rule => [...rule.selector.matchAll(/\[data-cms-kind="([a-z]+)"\]/g)].map(m => m[1]!)),
)

/**
 * The compound that matches a wrapper generating no box.
 *
 * The fallback matches nothing and says why in its own text. Deleting the
 * `display:contents` rule should fail the assertions about that rule *and* the
 * mirroring assertions below, each with a sentence naming what is missing;
 * reading the selector off an absent rule instead crashed the file before a
 * single one of them ran, and a suite that cannot load reports the shape of the
 * test rather than the shape of the defect.
 */
const CONTENTS_SELECTOR = CONTENTS_RULES[0]?.selector ?? '[data-cms-slot]#no-display-contents-rule'

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/**
 * The names of the nodes a fragment contributes to its parent, outermost only.
 *
 * `#text` for loose text, the tag name for an element. This is what decides
 * whether removing the wrapper's box leaves exactly one thing behind to take its
 * place in the parent's layout, and it is deliberately a scan of the renderer's
 * own output rather than a DOM parse: the renderer escapes text and quotes
 * attributes, so no `<` reaches here except one that opens a tag.
 */
function topLevelNodes(html: string): string[] {
  const nodes: string[] = []
  let depth = 0
  let index = 0
  while (index < html.length) {
    const open = html.indexOf('<', index)
    const text = html.slice(index, open === -1 ? html.length : open)
    if (depth === 0 && text.trim() !== '') nodes.push('#text')
    if (open === -1) break
    const close = html.indexOf('>', open)
    if (close === -1) throw new Error(`unterminated tag in ${JSON.stringify(html)}`)
    const tag = html.slice(open + 1, close)
    if (tag.startsWith('/')) depth -= 1
    else {
      const name = tag.split(/[\s/]/)[0]!.toLowerCase()
      if (depth === 0) nodes.push(name)
      if (!VOID_TAGS.has(name) && !tag.endsWith('/')) depth += 1
    }
    index = close + 1
  }
  return nodes
}

/**
 * What a field of each kind can render to, chosen so the answer is about the
 * kind rather than about one lucky value.
 *
 * Rich text carries two paragraphs *and* one, because a single-paragraph value
 * is indistinguishable from a link at the shape level and it is the two-block
 * case that proves rich text has no single child to promote. Link and image
 * carry an absent value, because a field nobody filled in renders nothing at
 * all — which is not a reason to withhold `display:contents` from the kind, and
 * `atMostOneElement` below says why.
 */
const SAMPLES: Record<string, readonly unknown[]> = {
  text: ['A heading', ''],
  richtext: ['<p>One</p><p>Two</p>', '<p>Only one</p>'],
  link: [{ url: '/about', label: 'About' }, { url: 'https://example.org/', label: 'Away' }, undefined],
  button: [{ url: '/buy', label: 'Buy' }, undefined],
  image: [{ src: '/a.png', alt: 'A photograph' }, { src: '/a.png', alt: '' }, undefined],
  repeat: [[{ a: 1 }], undefined],
  // A site menu fills only the frame (ADR 0010); inside a section it is empty.
  navigation: ['<a href="/x">stored values are ignored</a>', undefined],
}

/** The section wrapper `renderSection` puts around whatever the body rendered to. */
const SECTION = /^<div id="s0"[^>]*>([\s\S]*)<\/div>$/

function bodyOf(html: string): string {
  const match = SECTION.exec(html)
  if (match === null) throw new Error(`not a rendered section: ${JSON.stringify(html)}`)
  return match[1]!
}

/** One interpolation section whose entire template is the slot. */
function interpolated(kind: string, value: unknown): ManifestSection {
  const slots = [{ id: 'value', kind, label: 'V', constraints: {} }]
  const compiled = compileSection({ sourceHtml: '{{value}}', slots: slots as never })
  expect(compiled.blocking, `${kind} template`).toEqual([])
  return {
    def: {
      section_def_id: 'd',
      version: 1,
      slug: 'd',
      compiled_ast: compiled.ast,
      css: '',
      slots,
      render_hash: 'h',
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { label: 'S', hidden: false, hidden_at: [], values: { value } },
  } as unknown as ManifestSection
}

/** The same section on the structured path, where the field node is the document. */
function structured(type: string, value: unknown): ManifestSection {
  return {
    def: {
      section_def_id: 'd',
      version: 1,
      slug: 'd',
      definition_kind: 'structured',
      structured_doc: {
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        fields: [{ name: 'value', type, label: 'V' }],
        nodes: [{ type, field: 'value' }],
      },
      structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      compiled_ast: { nodes: [], policyVersion: SANITIZER_POLICY_VERSION, cssPolicyVersion: CSS_POLICY_VERSION },
      css: '',
      slots: [],
      render_hash: 'h',
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { label: 'S', hidden: false, hidden_at: [], values: { value } },
  } as unknown as ManifestSection
}

/**
 * Whether removing this kind's wrapper box always leaves exactly one element in
 * its place — the precondition `display:contents` needs to be safe.
 *
 * "At most one" rather than "exactly one": a field nobody filled in renders
 * nothing, and a wrapper with nothing in it should contribute nothing to the
 * parent's layout, because public output contributes nothing there either. Loose
 * text disqualifies a kind outright, since a bare text node in a flex container
 * becomes an anonymous item whose box the stylesheet cannot name. A kind that
 * never renders an element at all — `repeat`, until collections land in M4 — is
 * not a single-element kind and must not be given the rule on the strength of an
 * emptiness that is going to stop being true.
 */
function alwaysOneElement(render: (value: unknown) => string, samples: readonly unknown[]): boolean {
  let sawElement = false
  for (const value of samples) {
    const nodes = topLevelNodes(render(value))
    if (nodes.length > 1 || nodes.includes('#text')) return false
    if (nodes.length === 1) sawElement = true
  }
  return sawElement
}

describe('every kind whose rendered form is a single element generates no wrapper box', () => {
  it('the stylesheet declares display:contents for exactly those interpolation slot kinds', () => {
    const single = SLOT_KINDS.filter(kind =>
      alwaysOneElement(value => bodyOf(renderSection(interpolated(kind, value), 0)), SAMPLES[kind]!),
    )

    // Spelled out so a failure names the kind rather than the set difference:
    // whichever way this drifts, the message says which kind the stylesheet and
    // the renderer disagree about.
    expect([...single].sort()).toEqual(['button', 'image', 'link'])
    for (const kind of SLOT_KINDS) {
      expect(DECLARED_CONTENTS_KINDS.has(kind), `${kind} declares display:contents`).toBe(single.includes(kind))
    }
  })

  it('and for exactly those structured field types, which the same wrapper wraps', () => {
    const single = STRUCTURED_FIELD_TYPES.filter(
      type =>
        type !== 'repeat' &&
        alwaysOneElement(value => bodyOf(renderSection(structured(type, value), 0)), SAMPLES[type]!),
    )

    expect([...single].sort()).toEqual(['image', 'link'])
    for (const type of STRUCTURED_FIELD_TYPES.filter(type => type !== 'repeat')) {
      expect(DECLARED_CONTENTS_KINDS.has(type), `${type} declares display:contents`).toBe(single.includes(type))
    }
  })

  it('names no kind neither renderer can produce', () => {
    // `button` exists on the interpolation path only, so the union of both
    // renderers is the right bound; a rule for a kind outside it is a rule
    // nothing matches, which is a mistake that would otherwise cost nothing and
    // therefore never be found.
    const known = new Set<string>([...SLOT_KINDS, ...STRUCTURED_FIELD_TYPES, 'icon'])
    for (const kind of DECLARED_CONTENTS_KINDS) expect(known.has(kind), kind).toBe(true)
  })

  it('does it with one rule, so there is one place to read the answer', () => {
    expect(CONTENTS_RULES).toHaveLength(2)
    expect(CONTENTS_RULES.every(rule => rule.declarations === 'display:contents')).toBe(true)
    expect(CONTENTS_RULES.some(rule => rule.selector === '.cms-repeat-preview')).toBe(true)
  })
})

describe('every affordance survives the wrapper losing its box', () => {
  /**
   * The mirror of a wrapper rule: the same compound narrowed to the wrappers
   * that generate no box, then its child.
   *
   * A `display:contents` element paints nothing — no outline, no background — so
   * an affordance left only on the wrapper is an affordance a link or an image
   * slot no longer has, and the author loses sight of what is selected.
   */
  const mirrorSelector = (selector: string): string => `${selector.replace('[data-cms-slot]', CONTENTS_SELECTOR)}>*`

  /**
   * A wrapper rule that can apply to a slot whose wrapper generates no box.
   *
   * `[contenteditable]` rules are excluded, and the exclusion is *derived* from
   * the runtime rather than asserted here: the canvas sets that attribute in
   * exactly one place, guarded on a kind, and that kind keeps its box. Mirroring
   * those two rules would add selectors nothing can ever match, which is a
   * mistake that costs nothing at runtime and is therefore never found.
   */
  const canApplyToBoxless = (selector: string): boolean => !selector.includes('[contenteditable]')

  const wrapperRules = RULES.filter(
    rule =>
      rule.selector.includes('[data-cms-slot]') &&
      !rule.selector.endsWith('>*') &&
      !CONTENTS_RULES.includes(rule) &&
      canApplyToBoxless(rule.selector),
  )

  it('has a wrapper rule to mirror in the first place', () => {
    // Guards the loop below against passing because the parse found nothing.
    // Three: the resting outline, the hover feedback and the selection outline.
    // The two `[contenteditable]` rules are deliberately not among them.
    expect(wrapperRules.length).toBe(3)
  })

  it('only ever makes a slot editable in place on a kind that keeps its box', () => {
    // What licenses the exclusion above, read off the runtime's own source. If
    // the canvas ever sets `contenteditable` on a link or an image slot, this
    // fails and the two excluded rules stop being dead.
    const guard =
      /const editPlainText = \(slot, event\) => \{\s*if \(slot.getAttribute\('data-cms-kind'\) !== 'text'\) return;\s*slot.setAttribute\('contenteditable'/
    expect(PREVIEW_RUNTIME).toMatch(guard)
    expect(DECLARED_CONTENTS_KINDS.has('text')).toBe(false)
    // One place only: a second call site could be guarded differently.
    expect(PREVIEW_RUNTIME.split("setAttribute('contenteditable'").length - 1).toBe(2)
    expect(PREVIEW_RUNTIME).toContain("frameEditing === frame.getAttribute('data-cms-frame') && menuItem")
    expect(PREVIEW_RUNTIME).toContain("event.target.closest('[data-cms-menu-path]')")
  })

  it('ships a syntactically valid standalone canvas runtime', () => {
    expect(() => new Function(PREVIEW_RUNTIME)).not.toThrow()
  })

  it.each(
    RULES.filter(
      rule =>
        rule.selector.includes('[data-cms-slot]') &&
        !rule.selector.endsWith('>*') &&
        !CONTENTS_RULES.includes(rule) &&
        canApplyToBoxless(rule.selector),
    ).map(rule => [rule.selector, rule] as const),
  )('%s is mirrored onto the child of a boxless wrapper', (_selector, rule) => {
    const wanted = mirrorSelector(rule.selector)
    const mirror = RULES.find(candidate => candidate.selector === wanted)
    expect(mirror, `no rule for ${wanted}`).toBeDefined()
    // Identical declarations, not merely a rule with the same selector: a
    // mirror that dropped the background or softened the outline is an
    // affordance that looks different depending on which kind of field it is
    // attached to, which is the same defect in a quieter form.
    expect(mirror!.declarations, wanted).toBe(rule.declarations)
  })

  it('mirrors nothing that has no wrapper rule behind it', () => {
    // The other direction. A child rule whose wrapper half was deleted would
    // otherwise sit there styling links and images alone, and the two halves
    // would drift apart from the side this file was not watching.
    for (const rule of RULES.filter(
      candidate => candidate.selector.includes('[data-cms-slot]') && candidate.selector.endsWith('>*'),
    )) {
      expect(
        wrapperRules.map(wrapper => mirrorSelector(wrapper.selector)),
        rule.selector,
      ).toContain(rule.selector)
    }
  })

  it('mirrors repeat affordances onto every repeated root without inline style', () => {
    for (const suffix of ['', ':hover', '[data-cms-selected]']) {
      const wrapper = RULES.find(rule => rule.selector === `[data-cms-slot]${suffix}`)
      const child = RULES.find(rule => rule.selector === `.cms-repeat-preview${suffix}>*`)
      expect(wrapper, suffix || 'resting repeat').toBeDefined()
      expect(child, suffix || 'resting repeat child').toBeDefined()
      expect(child!.declarations).toBe(wrapper!.declarations)
    }
    expect(PREVIEW_STYLES).not.toMatch(/\.cms-repeat-preview[^{}]*\{[^}]*style=/)
  })

  it('mirrors only paint, so the mirror cannot reintroduce the divergence', () => {
    // `outline`, `background` and `cursor` reserve no space. A mirrored
    // `padding`, `border` or `display` would move the child that the wrapper
    // stopped moving, and the fix would have travelled one element inwards
    // rather than gone away.
    // `background-image` rather than `background`: a flat linear-gradient tints
    // without replacing an author's own background colour, which the shorthand
    // does the moment the rule moves off the wrapper and onto the element.
    const PAINT = /^(outline|outline-color|outline-offset|background-image|cursor)$/
    for (const rule of RULES.filter(candidate => candidate.selector.endsWith('>*'))) {
      for (const declaration of rule.declarations.split(';').filter(Boolean)) {
        const property = declaration.slice(0, declaration.indexOf(':')).trim()
        expect(property, `${rule.selector} { ${declaration} }`).toMatch(PAINT)
      }
    }
  })
})

describe('the stylesheet stays the shape this file can read', () => {
  it('has no at-rule and no nesting, so no rule escapes the scan above', () => {
    expect(PREVIEW_STYLES).not.toContain('@')
    // One `{` per `}`, and every `{` closed before the next opens: nesting would
    // put rules where `rulesOf` cannot see them and every assertion above would
    // start passing vacuously.
    const braces = PREVIEW_STYLES.replace(/[^{}]/g, '')
    expect(braces).toBe('{}'.repeat(RULES.length))
  })
})

it('lets editor-owned card and menu controls handle native clicks before page selection', () => {
  expect(PREVIEW_RUNTIME).toContain(
    "event.target.closest('[data-cms-editor-ghost],[data-cms-editor-list-ghost],[data-cms-menu-add]')",
  )
})
