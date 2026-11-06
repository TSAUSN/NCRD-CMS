// The structured section model (ADR 0007), and the frozen interpolation model
// beside it.
//
// The property under test is narrower and stronger than "the output is
// escaped". In the interpolation model a value's meaning depends on where its
// token sat in a template, so the corpus has to be driven through every sink a
// value might land in and each sink checked separately. Here a value has one
// sink, decided by the node that holds it, and there is no stored byte that
// moves it: attributes are static, tags come from a closed list, and neither
// accepts a field. So the corpus is driven through every *field type* and the
// assertion is the same one every time — nothing became structure.
//
// The other half is failing closed. A document this renderer cannot read in
// full renders nothing at all, rather than the part of it that happened to
// parse: a section that silently drops a node is a page nobody reviewed.
import { describe, expect, it } from 'vitest'
import {
  STRUCTURED_ARIA_CURRENT_STATES,
  STRUCTURED_IMAGE_DECODINGS,
  STRUCTURED_IMAGE_FETCH_PRIORITIES,
  STRUCTURED_IMAGE_LOADINGS,
  STRUCTURED_LINK_RELS,
  STRUCTURED_SCHEMA_VERSION,
  upgradeStructuredDocument,
  type StructuredFieldDef,
  type StructuredNode,
} from '@cms/schema'
import { compileSection, SANITIZER_POLICY_VERSION } from './compile.ts'
import { CSS_POLICY_VERSION } from './css.ts'
import { FORBIDDEN_IN_ATTRIBUTES, FORBIDDEN_TAGS, MALICIOUS_CASES } from './fixtures/malicious.ts'
import {
  renderPage,
  renderSection,
  type ManifestSection,
  type RenderManifest,
  type SectionDefView,
  type SiteShell,
} from './render.ts'
import { compileStructuredSection, renderStructuredBody, structuredSectionProblems } from './structured.ts'

const SHELL: SiteShell = {
  site: { id: 'site', name: 'Site', slug: 'site' },
  theme: {},
  navigation: [],
  canonical_host: null,
  staging_host: null,
}

/** The empty compiled template every structured row stores (migration 0019). */
const NO_TEMPLATE = { nodes: [], policyVersion: SANITIZER_POLICY_VERSION, cssPolicyVersion: CSS_POLICY_VERSION }

function structuredDef(
  fields: StructuredFieldDef[],
  nodes: StructuredNode[],
  overrides: Partial<SectionDefView> = {},
): SectionDefView {
  return {
    section_def_id: 'd',
    version: 1,
    slug: 'structured',
    compiled_ast: NO_TEMPLATE,
    definition_kind: 'structured',
    structured_doc: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields, nodes },
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    ...overrides,
  }
}

/** One field of one type, inside a section element. */
function oneField(
  type: Exclude<StructuredFieldDef['type'], 'repeat'>,
  overrides: Partial<SectionDefView> = {},
): SectionDefView {
  return structuredDef(
    [{ name: 'value', type, label: 'Value' }],
    [{ type: 'element', tag: 'section', children: [{ type: type, field: 'value' }] }],
    overrides,
  )
}

function render(def: SectionDefView, values: Record<string, unknown>, preview = false): string {
  const section = { def, instance: { section_def_id: 'd', section_def_version: 1, values } } as ManifestSection
  return renderSection(section, 0, preview ? { preview: true } : {})
}

/** The tags in a fragment, with every attribute value blanked out. */
function structureOf(html: string): string {
  return (html.match(/<\/?[a-zA-Z][^>]*>/g) ?? []).map(tag => tag.replace(/=\s*(?:"[^"]*"|'[^']*')/g, '=""')).join('')
}

const URL_BEARING = /^(href|src|srcset|action|formaction|data|poster|style|xlink:href|background)$/i
function fetchedValues(html: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  for (const tag of html.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      if (URL_BEARING.test(m[1]!)) out.push({ name: m[1]!, value: m[2] ?? m[3] ?? m[4] ?? '' })
    }
  }
  return out
}

/**
 * Nothing in this fragment is markup that was not authored, and nothing it
 * fetches or navigates to can execute.
 *
 * Judged on the structure rather than the raw text, because
 * `title="&lt;img onerror=x&gt;"` contains the characters of an event handler
 * and none of its meaning — escaping is what success looks like, and a check
 * that cannot tell the two apart reports every success as a failure.
 */
function expectInert(html: string, context: string): void {
  const tags = FORBIDDEN_TAGS.filter(f => f.pattern.test(structureOf(html)))
  expect(
    tags.map(f => f.name),
    `${context} produced: ${html.slice(0, 300)}`,
  ).toEqual([])

  const dangerous = FORBIDDEN_IN_ATTRIBUTES.filter(f => f.name !== 'off-site fetch')
  for (const { name, value } of fetchedValues(html)) {
    expect(
      dangerous.filter(f => f.pattern.test(value)).map(f => f.name),
      `${context} ${name}=${JSON.stringify(value)}`,
    ).toEqual([])
  }
}

const label = (c: (typeof MALICIOUS_CASES)[number]) => `${c.id} (${c.intent})`
const cases = MALICIOUS_CASES.map(c => [label(c), c] as const)

// ------------------------------------------------------------ coexistence

describe('the two models coexist, and the row says which is which', () => {
  const legacy = (): SectionDefView => {
    const compiled = compileSection({
      sourceHtml: '<section><p>{{value}}</p></section>',
      slots: [{ id: 'value', kind: 'text', label: 'Value', constraints: {} }],
    })
    return {
      section_def_id: 'legacy',
      version: 1,
      slug: 'legacy',
      compiled_ast: compiled.ast,
      definition_kind: 'legacy',
    }
  }

  it('renders an interpolated section and a structured one on the same page', () => {
    const manifest = {
      page: { id: 'p', version_id: 'v', title: 'T', path: '/p' },
      meta: {},
      sections: [
        { def: legacy(), instance: { values: { value: 'from a template' } } },
        { def: oneField('text'), instance: { values: { value: 'from a document' } } },
      ],
    } as unknown as RenderManifest

    const { html } = renderPage({ manifest, shell: SHELL, isStaging: false })
    expect(html).toContain('from a template')
    expect(html).toContain('from a document')
  })

  it('reads a definition with no discriminator as the interpolated one it is', () => {
    // The column arrived NOT NULL DEFAULT 'legacy' in migration 0019 precisely
    // because every row that predates it is legacy, so absence says exactly
    // what the column says. Manifests built before 0019 — and every hand-built
    // one in this suite — depend on it.
    const def = { ...legacy(), definition_kind: undefined }
    expect(render(def, { value: 'still here' })).toContain('still here')
  })

  it('renders nothing for a discriminator it does not recognise', () => {
    // The opposite case, and it is not symmetrical with the one above. A
    // present-but-unknown kind is a row written by a build that knew something
    // this one does not, and reading it with the nearest path that happens to
    // accept it is how a definition gets rendered by the half of the system it
    // was not written for.
    expect(render({ ...legacy(), definition_kind: 'holographic' }, { value: 'x' })).toBe('')
    expect(render(oneField('text', { definition_kind: 'structured-v2' }), { value: 'x' })).toBe('')
  })

  it('will not render a structured document through the interpolation path', () => {
    // A structured row stores the empty compiled template, so a reader that
    // ignored the discriminator would emit an empty section rather than
    // something wrong. Asserted so the failure mode stays the harmless one.
    const def = { ...oneField('text'), definition_kind: 'legacy', structured_schema_version: null }
    expect(render(def, { value: 'never rendered' })).not.toContain('never rendered')
  })
})

// -------------------------------------------------- values are never syntax

describe('every corpus payload, in a structured text field', () => {
  it.each(cases)('%s stays text', (_l, c) => {
    const html = render(oneField('text'), { value: c.payload })
    expectInert(html, `text field / ${c.id}`)
    // The section element the document authored is still exactly one element.
    expect((structureOf(html).match(/<section/g) ?? []).length, c.id).toBe(1)
  })
})

describe('every corpus payload, in a structured rich text field', () => {
  const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'a'])

  it.each(cases)('%s passes the one rich-text sanitizer', (_l, c) => {
    const html = render(oneField('richtext'), { value: c.payload })
    expectInert(html, `richtext field / ${c.id}`)
    const inside = html.slice(html.indexOf('<section>') + '<section>'.length, html.lastIndexOf('</section>'))
    const unexpected = [
      ...new Set([...inside.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map(m => m[1]!.toLowerCase())),
    ].filter(tag => !ALLOWED.has(tag))
    expect(unexpected, `${c.id} emitted tags outside the allowlist`).toEqual([])
  })
})

describe('every corpus payload, in a structured link field', () => {
  it.each(cases)('%s is not a URL this renderer emits', (_l, c) => {
    const html = render(oneField('link'), { value: { url: c.payload, label: c.payload } })
    expectInert(html, `link field / ${c.id}`)
    const href = /<a href="([^"]*)"/.exec(html)?.[1] ?? ''
    const inert =
      href === '' ||
      href === '#' ||
      href.startsWith('/') ||
      href.startsWith('#') ||
      href.startsWith('?') ||
      /^(https?:|mailto:|tel:)/i.test(href)
    expect(inert, `${c.id} produced href=${JSON.stringify(href)}`).toBe(true)
  })
})

describe('every corpus payload, in a structured image field', () => {
  it.each(cases)('%s is not a source this renderer emits', (_l, c) => {
    const html = render(oneField('image'), { value: { src: c.payload, alt: c.payload } })
    expectInert(html, `image field / ${c.id}`)
    const src = /<img src="([^"]*)"/.exec(html)?.[1] ?? ''
    const inert = src === '' || src.startsWith('/') || /^(https?:)/i.test(src)
    expect(inert, `${c.id} produced src=${JSON.stringify(src)}`).toBe(true)
  })
})

describe('every corpus payload, stored as a static attribute', () => {
  it.each(cases)('%s makes the whole definition unreadable rather than an attribute', (_l, c) => {
    // The case that has no analogue in the interpolation model. An attribute is
    // not a field, so a payload can only get into one by being written into the
    // document itself — and that is refused, whole, rather than escaped into
    // something that renders. `class` is the attribute with the loosest
    // grammar, so it is the one worth asking about.
    const def = structuredDef(
      [{ name: 'value', type: 'text', label: 'Value' }],
      [
        {
          type: 'element',
          tag: 'section',
          attributes: { class: c.payload },
          children: [{ type: 'text', field: 'value' }],
        },
      ],
    )
    const html = render(def, { value: 'x' })
    expect(html, c.id).toBe('')
  })
})

// ------------------------------------------ definition-owned element attributes
//
// ADR 0009. An element node's attribute map is the older half of this model and
// the one that has never been widened, so the tests below are about the widening
// itself as much as about the name it added: what a closed allowlist does with a
// name it has never heard of, and what a document that predates the addition
// renders afterwards.

/** One element node carrying whatever attributes the case is about. */
const elementDef = (attributes: unknown, tag = 'span') =>
  structuredDef(
    [{ name: 'value', type: 'text', label: 'Value' }],
    [{ type: 'element', tag, attributes, children: [{ type: 'text', field: 'value' }] } as unknown as StructuredNode],
  )

const elementMarkup = (attributes: unknown) => renderStructuredBody(elementDef(attributes), { value: 'Reports' })

describe('an element node carries the ARIA state its definition chose', () => {
  it.each(STRUCTURED_ARIA_CURRENT_STATES)('emits aria-current="%s", which is a state the attribute has', state => {
    expect(elementMarkup({ 'aria-current': state })).toBe(`<span aria-current="${state}">Reports</span>`)
  })

  it('emits it beside the attributes an element node already carried, in the document’s own order', () => {
    // Insertion order, which is the only order an element node's attributes have
    // ever had. Nothing sorts them, so the emitted markup can be read against
    // the V1 markup a definition was converted from — the same reason a field
    // node's class list is emitted in the order it was written.
    expect(elementMarkup({ class: 'crumb', 'aria-current': 'page' })).toBe(
      '<span class="crumb" aria-current="page">Reports</span>',
    )
    expect(elementMarkup({ 'aria-current': 'page', class: 'crumb' })).toBe(
      '<span aria-current="page" class="crumb">Reports</span>',
    )
  })

  it('is a state and not an accessible name, so it says nothing about the author’s value', () => {
    // The distinction ADR 0008 drew when it refused `aria-label` on a field
    // node: a name describes the content, which is the author's, while a state
    // describes the element, which is the definition's. Changing the value
    // changes neither the text nor anything else about it.
    expect(elementMarkup({ 'aria-current': 'page' })).toContain('>Reports<')
    expect(elementMarkup({ 'aria-current': 'false' })).toContain('>Reports<')
  })
})

describe('an aria-current that is not a state makes the whole definition unreadable', () => {
  // Refused whole rather than dropped, which is the property the element-node
  // path shares with the field-node one: a section that renders without the
  // attribute a stylesheet matches is markup that parses and looks wrong, and a
  // visibly absent section is the better of the two failures.
  it.each([
    ['a state that does not exist', 'section'],
    ['the empty string, which is not the default said out loud', ''],
    ['a state in the wrong case, because ARIA keywords are lowercase', 'Page'],
    ['a state with surrounding space, which nothing here trims', ' page'],
    ['two states, because this attribute holds one', 'page step'],
    ['a state carrying an HTML escape', '&#112;age'],
    ['a value shaped like markup', '<script>alert(1)</script>'],
    ['a value that closes the attribute it is in', 'page" onclick="alert(1)'],
    ['a value carrying a single quote', "page' onclick='alert(1)"],
    ['a value carrying an angle bracket', 'page><img src=x onerror=alert(1)'],
    ['a value carrying punctuation a selector would read', 'page.step#one'],
    ['a value carrying a control character', 'pa ge'],
    ['a value carrying a newline', 'page\nstep'],
    ['a value longer than any attribute may be', 'p'.repeat(513)],
    ['a number where a keyword should be', 1],
    ['a boolean where a keyword should be', true],
    ['a null where a keyword should be', null],
    ['a list of the right keywords', ['page']],
    ['an object', { state: 'page' }],
  ])('refuses %s', (_l, value) => {
    expect(elementMarkup({ 'aria-current': value })).toBeNull()
    expect(render(elementDef({ 'aria-current': value }), { value: 'Reports' })).toBe('')
  })
})

describe('every corpus payload, stored as an element node’s aria-current', () => {
  it.each(cases)('%s makes the whole definition unreadable rather than an attribute', (_l, c) => {
    // The same assertion the `class` corpus makes, against the narrowest grammar
    // in the allowlist rather than the loosest. A keyword set cannot be escaped
    // into and cannot be split, so the only interesting question is whether a
    // payload is ever *accepted* — and none is.
    expect(elementMarkup({ 'aria-current': c.payload }), c.id).toBeNull()
  })
})

describe('an element attribute nobody listed cannot be written down at all', () => {
  // The half of "closed" that matters: not that an unlisted name is escaped into
  // something inert, but that the document carrying one is refused. The first
  // five rows are the names the V1 census actually found on elements this model
  // keeps, so this is the list ADR 0009 refused rather than a list of things
  // nobody has ever written.
  it.each([
    [
      'the V1 CMS section marker, which is an identity rather than an attribute',
      { 'data-cms-section': 'home-divider' },
    ],
    ['a V1 slot marker on an element that is not an editable region', { 'data-block-id': 'crumb-1' }],
    ['a V1 editor label, whose v2 spelling is a field declaration', { 'data-cms-label': 'Programme name' }],
    ['a V1 behaviour hook with an empty value', { 'data-visually-hidden': '' }],
    ['a V1 build marker', { 'data-fe-block': 'hero' }],
    ['an inline declaration list, which is the second CSS sink', { style: 'background:url(//evil.test/x)' }],
    ['an event handler', { onclick: 'alert(1)' }],
    ['an animation handler, which needs no interaction at all', { onanimationstart: 'alert(1)' }],
    ['srcdoc, which is a whole document in an attribute', { srcdoc: '<script>alert(1)</script>' }],
    ['an href, because an element node is never a link', { href: 'https://evil.test/' }],
    ['a src, because an element node never fetches', { src: 'https://evil.test/pixel.gif' }],
    ['an ARIA state this build does not implement', { 'aria-pressed': 'true' }],
    ['a name that differs only in case, because attribute names here are literal', { 'ARIA-CURRENT': 'page' }],
    ['a name with a space in it', { 'aria-current x': 'page' }],
    ['an empty name', { '': 'page' }],
  ])('refuses %s', (_l, attributes) => {
    expect(elementMarkup(attributes)).toBeNull()
  })

  it('renders nothing at all rather than the element without the attribute', () => {
    // The failure this whole model is built to refuse, asserted directly: a
    // reader that stripped what it did not recognise would emit a `<span>` that
    // parses, renders, and no longer matches the rule that styles it. The
    // renderer's own emission loop skips an unlisted name, and the reason that
    // is not the behaviour anybody sees is that `renderStructuredBody` refuses
    // the document first. This is the test that keeps the gate in front of it.
    expect(elementMarkup({ 'data-cms-section': 'home-divider' })).toBeNull()
    expect(elementMarkup({ class: 'crumb', 'data-cms-section': 'home-divider' })).toBeNull()
    expect(render(elementDef({ class: 'crumb', 'data-cms-section': 'home-divider' }), { value: 'Reports' })).toBe('')
  })
})

describe('an element node’s attributes fail closed on a document that is not one', () => {
  it.each([
    ['attributes that are a list', []],
    ['attributes that are a string', 'class'],
    ['attributes that are a number', 7],
    ['attributes that are a boolean', true],
    ['an attribute whose value is a number', { id: 4 }],
    ['an attribute whose value is a list', { class: ['crumb'] }],
    ['an attribute whose value is an object', { class: { toString: 'crumb' } }],
    ['an attribute whose value is null', { class: null }],
    ['an attribute whose value is undefined', { class: undefined }],
  ])('returns null for %s without throwing', (_l, attributes) => {
    let markup: unknown
    expect(() => {
      markup = elementMarkup(attributes)
    }).not.toThrow()
    expect(markup).toBeNull()
  })

  it('says what is wrong rather than showing an author an empty page', () => {
    expect(structuredSectionProblems(elementDef({ 'aria-current': 'section' })).join(' ')).toContain('aria-current')
  })

  it('refuses a corrupted document carrying the new name without walking it', () => {
    // The preflight runs before Zod, so a document that is too deep to parse is
    // refused on its shape and the attribute is never reached. A build that
    // reversed the order would overflow inside the parse that the depth bound
    // exists to make survivable.
    let node: unknown = { type: 'text', field: 'value' }
    for (let i = 0; i < 5_000; i += 1) {
      node = { type: 'element', tag: 'div', attributes: { 'aria-current': 'page' }, children: [node] }
    }
    const def = structuredDef([{ name: 'value', type: 'text', label: 'Value' }], [node as StructuredNode])
    let markup: unknown
    expect(() => {
      markup = renderStructuredBody(def, { value: 'x' })
    }).not.toThrow()
    expect(markup).toBeNull()
  })
})

describe('a document written before ADR 0009 renders the bytes it already rendered', () => {
  // Every attribute an element node could carry before the addition, with the
  // exact bytes each produced. Adding a name to a closed allowlist cannot change
  // what a document that does not use the name emits — and a promise about bytes
  // is asserted in bytes, because a test that re-derived them from the current
  // renderer would agree with whatever the current renderer does.
  const BEFORE_0009: [string, Record<string, string>, string][] = [
    ['no attributes at all', {}, '<span>Reports</span>'],
    ['a class', { class: 'crumb' }, '<span class="crumb">Reports</span>'],
    ['a class list', { class: 'crumb is-current' }, '<span class="crumb is-current">Reports</span>'],
    ['an id', { id: 'crumbs' }, '<span id="crumbs">Reports</span>'],
    ['a role', { role: 'doc-subtitle' }, '<span role="doc-subtitle">Reports</span>'],
    ['a language tag', { lang: 'en-GB' }, '<span lang="en-GB">Reports</span>'],
    ['a direction', { dir: 'rtl' }, '<span dir="rtl">Reports</span>'],
    ['an accessible name', { 'aria-label': 'Breadcrumb' }, '<span aria-label="Breadcrumb">Reports</span>'],
    ['a labelledby reference', { 'aria-labelledby': 'crumbs' }, '<span aria-labelledby="crumbs">Reports</span>'],
    [
      'a describedby reference',
      { 'aria-describedby': 'crumbs note' },
      '<span aria-describedby="crumbs note">Reports</span>',
    ],
    ['an aria-hidden', { 'aria-hidden': 'true' }, '<span aria-hidden="true">Reports</span>'],
    [
      'every one of them at once',
      {
        class: 'crumb',
        id: 'crumbs',
        role: 'doc-subtitle',
        lang: 'en-GB',
        dir: 'ltr',
        'aria-label': 'Breadcrumb',
        'aria-labelledby': 'crumbs',
        'aria-describedby': 'note',
        'aria-hidden': 'false',
      },
      '<span class="crumb" id="crumbs" role="doc-subtitle" lang="en-GB" dir="ltr"' +
        ' aria-label="Breadcrumb" aria-labelledby="crumbs" aria-describedby="note"' +
        ' aria-hidden="false">Reports</span>',
    ],
  ]

  it.each(BEFORE_0009)('renders %s exactly as it did', (_l, attributes, expected) => {
    expect(elementMarkup(attributes)).toBe(expected)
  })

  it.each(BEFORE_0009)(
    'renders %s identically in preview, apart from the instrumentation',
    (_l, attributes, expected) => {
      // The preview path adds a wrapper around a *field*, never anything inside an
      // element's start tag, so stripping the wrapper has to give back the public
      // bytes character for character.
      const preview = renderStructuredBody(elementDef(attributes), { value: 'Reports' }, { preview: true })
      expect(preview?.replace(/<cms-slot data-cms-slot="[^"]*" data-cms-kind="[^"]*">(.*?)<\/cms-slot>/g, '$1')).toBe(
        expected,
      )
    },
  )

  it('stores the document it was given, so the identity a page pins does not move', () => {
    // `renderHash` is a sha256 over the document, the compiled CSS and the CSS
    // policy version. None of the three is touched by adding a name to the
    // allowlist, and the way to say that without pinning a literal hash — which
    // would move whenever the CSS policy legitimately does — is to assert that
    // the compiler hands back the same document it was given, byte for byte, and
    // that two compiles of it agree.
    const document = {
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      fields: [{ name: 'value', type: 'text', label: 'Value' }],
      nodes: [
        { type: 'element', tag: 'span', attributes: { class: 'crumb' }, children: [{ type: 'text', field: 'value' }] },
      ],
    }
    const compile = () => compileStructuredSection({ slug: 'crumbs', document, sourceCss: '.crumb{color:red}' })
    expect(compile().blocking).toEqual([])
    expect(JSON.stringify(compile().document)).toBe(JSON.stringify(document))
    expect(compile().renderHash).toBe(compile().renderHash)
  })
})

// ------------------------------------------------------------- the policies

describe('the URL, rich text and image policies are the ones that already existed', () => {
  it('sends an off-site link out with rel="noopener" and keeps a relative one bare', () => {
    expect(render(oneField('link'), { value: { url: 'https://example.test/a', label: 'Out' } })).toContain(
      '<a href="https://example.test/a" rel="noopener">Out</a>',
    )
    expect(render(oneField('link'), { value: { url: '/about', label: 'About' } })).toContain(
      '<a href="/about">About</a>',
    )
  })

  it('degrades an executable link URL to a dead one and escapes its label', () => {
    const html = render(oneField('link'), { value: { url: 'javascript:alert(1)', label: '<b>x</b>' } })
    expect(html).toContain('<a href="#">&lt;b&gt;x&lt;/b&gt;</a>')
  })

  it('renders nothing for a link whose value is a bare string', () => {
    // A link is two values. The interpolation renderer accepts one and uses it
    // as both, which puts a raw href on the page as visible text every time an
    // editor pastes one.
    expect(render(oneField('link'), { value: 'https://example.test/a' })).toBe(
      '<div id="s0" class="cms-section cms-section--structured"><section></section></div>',
    )
  })

  it('keeps allowlisted rich-text formatting and drops the rest', () => {
    const html = render(oneField('richtext'), { value: '<p>keep <strong>this</strong></p><script>no</script>' })
    expect(html).toContain('<p>keep <strong>this</strong></p>')
    expect(html).not.toContain('<script')
  })

  it('emits an image only when it is described or explicitly decorative', () => {
    expect(render(oneField('image'), { value: { src: '/a.png', alt: 'A photograph' } })).toContain(
      '<img src="/a.png" alt="A photograph">',
    )
    expect(render(oneField('image'), { value: { src: '/a.png', decorative: true } })).toContain(
      '<img src="/a.png" alt="" role="presentation">',
    )
    // Neither. Guessing "decorative" hides content from a screen reader and
    // guessing "meaningful" invents a description, so it renders nothing and
    // the readiness policy reports an empty region.
    expect(render(oneField('image'), { value: { src: '/a.png' } })).not.toContain('<img')
    expect(render(oneField('image'), { value: { src: '/a.png', alt: '' } })).not.toContain('<img')
  })

  it('renders no image at all when the source is refused', () => {
    // safeUrl degrades to '#', which is a fine dead link and a terrible image
    // source: `src="#"` re-requests the current document and renders it broken.
    expect(render(oneField('image'), { value: { src: 'javascript:alert(1)', alt: 'x' } })).not.toContain('<img')
  })
})

// ------------------------------------------- definition-owned static attributes

// Schema v2 (ADR 0008). A `link` or `image` field node renders its own element,
// so until v2 there was nowhere to say anything about that element: the 240 link
// and 86 image field elements in the V1 catalogue lost their class, their
// dimensions and their loading hints, and a class is the styling.
//
// The property every test below is really about is the boundary. These
// attributes are chosen by whoever authored the definition and are fixed in the
// stored document; the author's value — the URL, the label, the alt text — comes
// from `values` and keeps the policies it already had. Nothing in `values` can
// reach an attribute, and nothing in the document can reach a URL.

/** One link field node, with whatever the definition wanted to say about it. */
function linkDef(staticAttributes?: unknown): SectionDefView {
  const node =
    staticAttributes === undefined
      ? { type: 'link', field: 'value' }
      : { type: 'link', field: 'value', staticAttributes }
  return structuredDef([{ name: 'value', type: 'link', label: 'Value' }], [node as unknown as StructuredNode])
}

/** One image field node, likewise. */
function imageDef(staticAttributes?: unknown): SectionDefView {
  const node =
    staticAttributes === undefined
      ? { type: 'image', field: 'value' }
      : { type: 'image', field: 'value', staticAttributes }
  return structuredDef([{ name: 'value', type: 'image', label: 'Value' }], [node as unknown as StructuredNode])
}

const linkMarkup = (staticAttributes?: unknown, url = '/about') =>
  renderStructuredBody(linkDef(staticAttributes), { value: { url, label: 'About' } })

const imageMarkup = (
  staticAttributes?: unknown,
  value: Record<string, unknown> = { src: '/a.png', alt: 'A photograph' },
) => renderStructuredBody(imageDef(staticAttributes), { value })

describe('a link field node carries the class its definition chose', () => {
  it('emits one token', () => {
    expect(linkMarkup({ class: ['btn'] })).toBe('<a href="/about" class="btn">About</a>')
  })

  it('emits several tokens in the order the definition wrote them', () => {
    // Written order, not sorted. The conversion of a V1 definition is reviewed
    // by reading the emitted markup against V1's own, and a reordered class list
    // makes that comparison a diff nobody can dismiss at a glance.
    expect(linkMarkup({ class: ['btn', 'btn-primary', 'is_large'] })).toBe(
      '<a href="/about" class="btn btn-primary is_large">About</a>',
    )
  })

  it('joins them with the one separator the renderer owns', () => {
    // The token list is the stored form and the string is the emitted form, so
    // there is no stored string for anything downstream to split. The element
    // node's `class` is the other way round — one string, split on a single
    // space here and matched by a repeated-token pattern in SQL — and the two
    // spellings only agree because somebody went and found `a  b`, `a ` and ''.
    const markup = linkMarkup({ class: ['a', 'b'] })
    expect(markup).toContain('class="a b"')
    expect(markup).not.toContain('  ')
  })
})

describe('a class token that is not one makes the whole definition unreadable', () => {
  // Refused rather than dropped, and refused whole. A definition that renders
  // without the class that lays it out is markup that parses and looks wrong,
  // which is the failure the import policy exists to refuse — so it is better
  // for the section to be visibly absent than quietly misshapen.
  it.each([
    ['an empty list, which is not the same as no class at all', []],
    ['a repeated token', ['btn', 'btn']],
    ['a token longer than sixty-four characters', ['a'.repeat(65)]],
    ['a token with a space in it, which nothing here will split', ['btn primary']],
    ['a token carrying an HTML escape', ['btn&amp;']],
    ['a token with a dot, which is a selector rather than a name', ['btn.primary']],
    ['a token with a colon, the framework-utility prefix grammar', ['sm:hidden']],
    ['a token with brackets, the framework arbitrary-value grammar', ['w-[32px]']],
    ['a framework utility with a slash opacity suffix', ['hover:bg-blue-500/50']],
    ['a token shaped like markup', ['<script>']],
    ['a token that closes the attribute it is in', ['a" onclick="alert(1)']],
    ['a token carrying a single quote', ["a' onclick='alert(1)"]],
    ['a token carrying an angle bracket', ['a><img src=x onerror=alert(1)']],
    ['a token that does not start with a letter', ['1bad']],
    ['a token that is empty', ['']],
    ['a string rather than a list, which is the schema v1 spelling', 'btn'],
    ['a number where a token should be', [1]],
    ['a null where a token should be', [null]],
    ['a nested list', [['btn']]],
    ['an object rather than a list', { 0: 'btn' }],
  ])('refuses %s', (_l, value) => {
    expect(render(linkDef({ class: value }), { value: { url: '/a', label: 'A' } })).toBe('')
    expect(render(imageDef({ class: value }), { value: { src: '/a.png', alt: 'A' } })).toBe('')
  })
})

describe('every corpus payload, stored as a field node’s static attribute', () => {
  it.each(cases)('%s makes the whole definition unreadable rather than an attribute', (_l, c) => {
    // The element-node case above, one node type along. A field node's
    // attributes are a token list rather than a string, so the payload is tried
    // as a whole token — which is the only way it could arrive, since nothing
    // splits anything here.
    expect(render(linkDef({ class: [c.payload] }), { value: { url: '/a', label: 'A' } }), c.id).toBe('')
    expect(render(imageDef({ class: [c.payload] }), { value: { src: '/a.png', alt: 'A' } }), c.id).toBe('')
  })

  it.each(cases)('%s is not a rel or a target either', (_l, c) => {
    expect(render(linkDef({ rel: [c.payload] }), { value: { url: '/a', label: 'A' } }), c.id).toBe('')
    expect(render(linkDef({ target: c.payload }), { value: { url: '/a', label: 'A' } }), c.id).toBe('')
  })
})

describe('a static attribute nobody listed cannot be written down at all', () => {
  // The list is closed, and this is the half of "closed" that matters: not that
  // an unlisted name is escaped into something inert, but that a document
  // carrying one is refused. An author's value can never reach an attribute
  // because attributes are static; a definition cannot reach a URL because
  // `href`, `src` and `alt` are not on the list.
  it.each([
    ['a style declaration list', { style: 'background:url(//evil.test/x)' }],
    ['an event handler', { onclick: 'alert(1)' }],
    ['an error handler', { onerror: 'alert(1)' }],
    ['an animation handler, which needs no interaction at all', { onanimationstart: 'alert(1)' }],
    ['srcdoc', { srcdoc: '<script>alert(1)</script>' }],
    ['an href, which is the author’s value', { href: 'https://evil.test/' }],
    ['a src, which is the author’s value', { src: 'https://evil.test/pixel.gif' }],
    ['an alt, which is the author’s value', { alt: 'not what the author wrote' }],
    ['a srcset, which is a candidate grammar rather than a URL', { srcset: '/a.png 1x, //evil.test/x 2x' }],
    ['a sizes list to go with it', { sizes: '100vw' }],
    ['an id, which is a name shared with the whole page', { id: 'cta' }],
    ['a ping beacon', { ping: 'https://evil.test/collect' }],
    ['a referrer policy', { referrerpolicy: 'unsafe-url' }],
    ['a download instruction', { download: 'invoice.pdf' }],
    ['an arbitrary data hook', { 'data-tone': 'brand' }],
    ['an arbitrary ARIA attribute', { 'aria-label': 'Read more' }],
    ['a title, which is free text with no grammar', { title: 'Read more' }],
    ['an attribute whose name is itself markup', { '<img': 'x' }],
  ])('refuses %s on a link', (_l, staticAttributes) => {
    expect(render(linkDef(staticAttributes), { value: { url: '/a', label: 'A' } })).toBe('')
  })

  it.each([
    ['a rel, which is a link relationship', { rel: ['nofollow'] }],
    ['a target, which is a browsing context', { target: '_blank' }],
  ])('refuses %s on an image, because an image navigates nowhere', (_l, staticAttributes) => {
    expect(render(imageDef(staticAttributes), { value: { src: '/a.png', alt: 'A' } })).toBe('')
  })

  it.each([
    ['a width, which an anchor has no intrinsic size for', { width: 320 }],
    ['a loading hint, which an anchor does not load', { loading: 'lazy' }],
    ['a decoding hint', { decoding: 'async' }],
  ])('refuses %s on a link', (_l, staticAttributes) => {
    expect(render(linkDef(staticAttributes), { value: { url: '/a', label: 'A' } })).toBe('')
  })

  it.each([
    ['text', 'text'],
    ['richtext', 'richtext'],
  ])('refuses static attributes on a %s field, which has no element of its own', (_l, type) => {
    // The element around a text field is an element node the author already
    // wrote, so there is nothing here for an attribute to attach to. A key that
    // was accepted and ignored would be the half of a document somebody believes
    // is doing something.
    const def = structuredDef(
      [{ name: 'value', type: type as 'text', label: 'Value' }],
      [{ type, field: 'value', staticAttributes: { class: ['a'] } } as unknown as StructuredNode],
    )
    expect(render(def, { value: 'x' })).toBe('')
  })

  it('refuses static attributes on an element node, which has its own attribute map', () => {
    const def = structuredDef(
      [],
      [{ type: 'element', tag: 'div', staticAttributes: { class: ['a'] } } as unknown as StructuredNode],
    )
    expect(render(def, {})).toBe('')
  })

  it.each([
    ['a list', []],
    ['a string', 'class'],
    ['a number', 1],
    ['null', null],
    ['true', true],
  ])('refuses static attributes that are %s rather than an object', (_l, staticAttributes) => {
    expect(render(linkDef(staticAttributes), { value: { url: '/a', label: 'A' } })).toBe('')
  })
})

describe('the rel a link ships with is assembled by the renderer, not trusted from the definition', () => {
  it('adds noopener to an off-site link exactly as it always did', () => {
    // The schema v1 behaviour, unchanged and byte for byte. Every document that
    // predates static attributes goes through the new assembly and comes out the
    // same, which is the only reason the assembly is allowed to exist.
    expect(linkMarkup(undefined, 'https://example.test/a')).toBe(
      '<a href="https://example.test/a" rel="noopener">About</a>',
    )
    expect(linkMarkup(undefined, '/about')).toBe('<a href="/about">About</a>')
  })

  it('adds noopener to a same-site link opened in a new tab', () => {
    // The case the URL test above cannot reach and the reason the guarantee
    // moved into the renderer: a `_blank` link hands the opened document a live
    // `window.opener` back to this page whether or not it left the site.
    expect(linkMarkup({ target: '_blank' })).toBe('<a href="/about" rel="noopener" target="_blank">About</a>')
  })

  it('does not repeat noopener when the definition asked for it too', () => {
    // The one duplicate this design creates, and therefore the one it has to
    // answer for: two sources contribute to one attribute.
    expect(linkMarkup({ rel: ['noopener'], target: '_blank' })).toBe(
      '<a href="/about" rel="noopener" target="_blank">About</a>',
    )
  })

  it('collapses a token the definition asked for twice', () => {
    expect(linkMarkup({ rel: ['nofollow', 'nofollow'] })).toBe('<a href="/about" rel="nofollow">About</a>')
  })

  it('emits the same bytes whatever order the definition wrote the tokens in', () => {
    // A set has to be put in some order before it can be bytes, and two
    // definitions asking for the same relationships have to produce the same
    // page — otherwise the render hash moves for a change that is not one.
    const forwards = linkMarkup({ rel: ['nofollow', 'noreferrer', 'external'] })
    const backwards = linkMarkup({ rel: ['noreferrer', 'external', 'nofollow'] })
    expect(forwards).toBe(backwards)
    expect(forwards).toBe('<a href="/about" rel="external nofollow noreferrer">About</a>')
  })

  it('merges what the definition asked for with what it guarantees', () => {
    expect(linkMarkup({ rel: ['nofollow'] }, 'https://example.test/a')).toBe(
      '<a href="https://example.test/a" rel="nofollow noopener">About</a>',
    )
  })

  it.each(STRUCTURED_LINK_RELS.map(rel => [rel] as const))('accepts the keyword %s', rel => {
    expect(linkMarkup({ rel: [rel] })).toBe(`<a href="/about" rel="${rel}">About</a>`)
  })

  it.each([
    ['opener, whose only effect is to undo the guarantee above', ['opener']],
    ['preload, which turns an anchor into a request', ['preload']],
    ['prefetch', ['prefetch']],
    ['preconnect', ['preconnect']],
    ['dns-prefetch', ['dns-prefetch']],
    ['prerender', ['prerender']],
    ['modulepreload', ['modulepreload']],
    ['stylesheet, which would make the anchor load CSS', ['stylesheet']],
    ['icon', ['icon']],
    ['manifest', ['manifest']],
    ['a keyword with the right prefix and the wrong spelling', ['noopener2']],
    ['a keyword in the wrong case', ['NOFOLLOW']],
    ['a whole rel value as one token', ['noopener noreferrer']],
    ['an empty token', ['']],
    ['an empty list', []],
    ['a string rather than a list', 'nofollow'],
    ['a number', [1]],
  ])('refuses %s', (_l, rel) => {
    expect(render(linkDef({ rel }), { value: { url: '/a', label: 'A' } })).toBe('')
  })
})

describe('the browsing context a link may name is a closed set', () => {
  it('emits _self, which is the default said out loud', () => {
    expect(linkMarkup({ target: '_self' })).toBe('<a href="/about" target="_self">About</a>')
  })

  it.each([
    ['_parent, which is a context the section does not own', '_parent'],
    ['_top, which navigates the editor out from under the canvas', '_top'],
    ['a named context shared with the whole page', 'results'],
    ['the right keyword in the wrong case', '_BLANK'],
    ['an empty target', ''],
    ['a list of targets', ['_blank']],
    ['a number', 1],
  ])('refuses %s', (_l, target) => {
    expect(render(linkDef({ target }), { value: { url: '/a', label: 'A' } })).toBe('')
  })
})

describe('an image field node reserves the box its definition declared', () => {
  it('emits the class, the dimensions and the hints in one fixed order', () => {
    // Fixed so that two documents asking for the same thing are the same bytes,
    // and so that the author's own values — the source and the description —
    // come first and the definition's follow.
    expect(
      imageMarkup({
        class: ['media', 'media-wide'],
        width: 640,
        height: 360,
        decoding: 'async',
        loading: 'lazy',
        fetchpriority: 'high',
      }),
    ).toBe(
      '<img src="/a.png" alt="A photograph" class="media media-wide" width="640" height="360"' +
        ' decoding="async" loading="lazy" fetchpriority="high">',
    )
  })

  it('keeps them on a decorative image too, after the role that declares it', () => {
    expect(imageMarkup({ width: 640, height: 360 }, { src: '/a.png', decorative: true })).toBe(
      '<img src="/a.png" alt="" role="presentation" width="640" height="360">',
    )
  })

  it.each([
    ['the smallest dimension there is', 1, 1],
    ['the largest', 8192, 8192],
    ['one inside each end', 2, 8191],
  ])('accepts %s', (_l, width, height) => {
    expect(imageMarkup({ width, height })).toBe(
      `<img src="/a.png" alt="A photograph" width="${width}" height="${height}">`,
    )
  })

  it.each([
    ['zero, which is conforming HTML and reserves no box at all', 0],
    ['a negative dimension', -1],
    ['negative zero', -0],
    ['one past the upper bound', 8193],
    ['a dimension with a fraction', 12.5],
    ['a dimension that is very nearly an integer', 8191.999999],
    ['a string of digits, which is how HTML writes it and not how this stores it', '120'],
    ['a string with a unit', '120px'],
    ['a string with a leading zero', '0120'],
    ['exponent notation as a string', '1e3'],
    ['a huge number', 1e9],
    ['a number past what a double can distinguish', Number.MAX_SAFE_INTEGER + 2],
    ['infinity', Number.POSITIVE_INFINITY],
    ['not a number', Number.NaN],
    ['null', null],
    ['a list', [640]],
    ['a boolean', true],
  ])('refuses %s', (_l, width) => {
    expect(render(imageDef({ width, height: 360 }), { value: { src: '/a.png', alt: 'A' } })).toBe('')
    expect(render(imageDef({ width: 640, height: width }), { value: { src: '/a.png', alt: 'A' } })).toBe('')
  })

  it.each([
    ['a width with no height', { width: 640 }],
    ['a height with no width', { height: 360 }],
  ])('refuses %s, because one alone reserves the wrong box', (_l, staticAttributes) => {
    expect(render(imageDef(staticAttributes), { value: { src: '/a.png', alt: 'A' } })).toBe('')
  })
})

describe('every loading hint an image field node may carry', () => {
  it.each(STRUCTURED_IMAGE_DECODINGS.map(v => [v] as const))('accepts decoding=%s', decoding => {
    expect(imageMarkup({ decoding })).toBe(`<img src="/a.png" alt="A photograph" decoding="${decoding}">`)
  })

  it.each(STRUCTURED_IMAGE_LOADINGS.map(v => [v] as const))('accepts loading=%s', loading => {
    expect(imageMarkup({ loading })).toBe(`<img src="/a.png" alt="A photograph" loading="${loading}">`)
  })

  it.each(STRUCTURED_IMAGE_FETCH_PRIORITIES.map(v => [v] as const))('accepts fetchpriority=%s', fetchpriority => {
    expect(imageMarkup({ fetchpriority })).toBe(
      `<img src="/a.png" alt="A photograph" fetchpriority="${fetchpriority}">`,
    )
  })

  it.each([
    ['a decoding value that is not one', { decoding: 'fast' }],
    ['decoding in the wrong case', { decoding: 'ASYNC' }],
    ['loading=auto, which loading does not have', { loading: 'auto' }],
    ['loading with surrounding space', { loading: ' lazy' }],
    ['a fetchpriority that is not one', { fetchpriority: 'urgent' }],
    ['a hint that is a list', { decoding: ['async'] }],
    ['a hint that is a number', { loading: 1 }],
    ['a hint that is null', { fetchpriority: null }],
    ['a hint that is empty', { decoding: '' }],
  ])('refuses %s', (_l, staticAttributes) => {
    expect(render(imageDef(staticAttributes), { value: { src: '/a.png', alt: 'A' } })).toBe('')
  })
})

describe('the author’s value and the definition’s attributes stay on their own sides', () => {
  it('keeps the URL policy on the href while the definition styles the anchor', () => {
    const markup = linkMarkup({ class: ['btn'] }, 'javascript:alert(1)')
    expect(markup).toBe('<a href="#" class="btn">About</a>')
  })

  it('emits no image at all when the source is refused, however much the definition said', () => {
    expect(imageMarkup({ class: ['media'], width: 640, height: 360 }, { src: 'javascript:alert(1)', alt: 'A' })).toBe(
      '',
    )
  })

  it('still requires a description or an explicit decorative declaration', () => {
    expect(imageMarkup({ width: 640, height: 360 }, { src: '/a.png' })).toBe('')
  })

  it('cannot be reached by a stored value, because a value is never an attribute', () => {
    // The stored value is an object, and an object with the right keys is still
    // just a value: the node decides what is read out of it.
    const markup = linkMarkup({ class: ['btn'] }, '/about')
    expect(
      renderStructuredBody(linkDef({ class: ['btn'] }), {
        value: { url: '/about', label: 'About', class: ['evil'], rel: ['opener'], target: '_top', onclick: 'alert(1)' },
      }),
    ).toBe(markup)
  })
})

describe('a v1 document renders the bytes it rendered under schema v1', () => {
  // Recorded from this repository at commit 718e8d0, which is schema v1. The
  // whole promise of the version bump is that nothing already stored changes
  // what it puts on the page, and a promise about bytes has to be asserted in
  // bytes: a test that re-derived them from the current renderer would agree
  // with whatever the current renderer does.
  const V1_BYTES: [string, unknown, Record<string, unknown>, string][] = [
    [
      'a relative link',
      { type: 'link', field: 'value' },
      { value: { url: '/about', label: 'About' } },
      '<a href="/about">About</a>',
    ],
    [
      'an off-site link',
      { type: 'link', field: 'value' },
      { value: { url: 'https://example.test/a', label: 'Out' } },
      '<a href="https://example.test/a" rel="noopener">Out</a>',
    ],
    [
      'a refused link URL',
      { type: 'link', field: 'value' },
      { value: { url: 'javascript:alert(1)', label: '<b>x</b>' } },
      '<a href="#">&lt;b&gt;x&lt;/b&gt;</a>',
    ],
    [
      'a described image',
      { type: 'image', field: 'value' },
      { value: { src: '/a.png', alt: 'A photograph' } },
      '<img src="/a.png" alt="A photograph">',
    ],
    [
      'a decorative image',
      { type: 'image', field: 'value' },
      { value: { src: '/a.png', decorative: true } },
      '<img src="/a.png" alt="" role="presentation">',
    ],
  ]

  it.each(V1_BYTES)('renders %s exactly as it did', (_l, node, values, expected) => {
    const type = (node as { type: 'link' | 'image' }).type
    const document = upgradeStructuredDocument({
      schemaVersion: 1,
      fields: [{ name: 'value', type, label: 'Value' }],
      nodes: [node],
    })
    expect(document).not.toBeNull()
    const def = oneField(type, { structured_doc: document })
    expect(renderStructuredBody(def, values)).toBe(expected)
  })
})

describe('a document written against schema v1 is carried forward without being reinterpreted', () => {
  const v1 = () => ({
    schemaVersion: 1,
    fields: [{ name: 'value', type: 'link', label: 'Value' }],
    nodes: [{ type: 'element', tag: 'section', children: [{ type: 'link', field: 'value' }] }],
  })

  it('changes the version and nothing else', () => {
    // Not "adds empty attributes": a v1 node has no static attributes, which is
    // a different statement from a definition author having considered the
    // question and answered "none". The importer's evidence is that V1 wrote
    // classes on 91 of those anchors, so an upgrade that invented an answer
    // would be inventing it for the whole catalogue at once.
    expect(upgradeStructuredDocument(v1())).toEqual({ ...v1(), schemaVersion: STRUCTURED_SCHEMA_VERSION })
    expect(JSON.stringify(upgradeStructuredDocument(v1()))).not.toContain('staticAttributes')
  })

  it('is the same document when it runs twice', () => {
    const once = upgradeStructuredDocument(v1())
    expect(upgradeStructuredDocument(once)).toEqual(once)
  })

  it('leaves a document already at the current version alone', () => {
    const current = { ...v1(), schemaVersion: STRUCTURED_SCHEMA_VERSION }
    expect(upgradeStructuredDocument(current)).toEqual(current)
  })

  it('carries a v2 document’s static attributes through untouched', () => {
    const withAttributes = {
      ...v1(),
      schemaVersion: STRUCTURED_SCHEMA_VERSION,
      nodes: [
        {
          type: 'element',
          tag: 'section',
          children: [{ type: 'link', field: 'value', staticAttributes: { class: ['btn'], target: '_blank' } }],
        },
      ],
    }
    expect(upgradeStructuredDocument(withAttributes)).toEqual(withAttributes)
  })

  it('refuses a v1 document whose nodes already carry static attributes', () => {
    // A key v1 refused, in a document claiming to be v1. Re-stamping the version
    // would hand it the provenance of a document that had been through a v2
    // gate, which it has not.
    expect(
      upgradeStructuredDocument({
        ...v1(),
        nodes: [
          {
            type: 'element',
            tag: 'section',
            children: [{ type: 'link', field: 'value', staticAttributes: { class: ['btn'] } }],
          },
        ],
      }),
    ).toBeNull()
  })

  it.each([
    ['a version from before the column existed', 0],
    ['a version this build has never heard of', 99],
    ['a version that is a string', '1'],
    ['no version at all', undefined],
    ['a null version', null],
  ])('refuses %s rather than guessing what it meant', (_l, schemaVersion) => {
    expect(upgradeStructuredDocument({ ...v1(), schemaVersion })).toBeNull()
  })

  it.each([
    ['a value that is not a document', 'nodes'],
    ['null', null],
    ['a list', []],
    ['a document with no node list', { schemaVersion: 1, fields: [] }],
    ['a document whose nodes are not nodes', { schemaVersion: 1, fields: [], nodes: [7] }],
  ])('returns null for %s rather than throwing', (_l, document) => {
    expect(() => upgradeStructuredDocument(document)).not.toThrow()
    expect(upgradeStructuredDocument(document)).toBeNull()
  })

  it('refuses a hostile v1 document without walking it, and without throwing', () => {
    let node: unknown = { type: 'text', field: 'value' }
    for (let i = 0; i < 5_000; i += 1) node = { type: 'element', tag: 'div', children: [node] }
    const document = { schemaVersion: 1, fields: [{ name: 'value', type: 'text', label: 'V' }], nodes: [node] }
    let result: unknown
    expect(() => {
      result = upgradeStructuredDocument(document)
    }).not.toThrow()
    expect(result).toBeNull()
  })
})

describe('the stylesheet goes through the policy that already existed', () => {
  it('scopes authored CSS to the definition’s own section class', () => {
    const compiled = compileStructuredSection({
      slug: 'quote',
      document: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [] },
      sourceCss: '.a{color:red}',
    })
    expect(compiled.blocking).toEqual([])
    expect(compiled.css).toBe('.cms-section--quote .a{color:red}')
  })

  it('refuses authored CSS that leaves the section, and emits none of it', () => {
    const compiled = compileStructuredSection({
      slug: 'quote',
      document: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [] },
      sourceCss: '@import url(//evil.test/x.css);.a{background:url(https://evil.test/pixel.gif)}',
    })
    expect(compiled.problems.length).toBeGreaterThan(0)
    expect(compiled.css).not.toContain('evil.test')
  })

  it('drops a structured section whose stored compiled CSS is not one the policy produced', () => {
    // The same rule the interpolation path has: markup without the stylesheet
    // that was approved with it is a different page, and a silent one.
    const def = oneField('text', {
      css: '.cms-section--structured .a,body{display:none}',
      css_policy_version: CSS_POLICY_VERSION,
    })
    expect(render(def, { value: 'x' })).toBe('')
  })

  it('refuses a slug that cannot become a scope rather than compiling under a bare one', () => {
    const compiled = compileStructuredSection({
      slug: 'a,body',
      document: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [] },
      sourceCss: '.a{color:red}',
    })
    expect(compiled.blocking.join(' ')).toContain('cannot be a section scope')
    expect(compiled.css).toBe('')
  })
})

// -------------------------------------------------------------- fail closed

describe('an unknown schema version renders nothing', () => {
  it.each([
    ['a version this renderer does not implement', { structured_schema_version: STRUCTURED_SCHEMA_VERSION + 1 }],
    ['no version at all', { structured_schema_version: null }],
    ['a version from before the column existed', { structured_schema_version: 0 }],
  ])('refuses %s', (_l, overrides) => {
    expect(render(oneField('text', overrides), { value: 'x' })).toBe('')
  })

  it('refuses a document whose own version disagrees with its row', () => {
    // The column is what the database vouched for; the number inside is what
    // the compiler wrote. A row where they differ is one somebody rewrote half
    // of, and half a rewrite is the interesting half.
    const def = oneField('text')
    const document = def.structured_doc as { schemaVersion: number }
    expect(render({ ...def, structured_doc: { ...document, schemaVersion: 99 } }, { value: 'x' })).toBe('')
  })
})

describe('an unknown node or field type renders nothing', () => {
  it.each([
    ['an unknown widget node', { type: 'unknown-widget', field: 'value' }],
    ['a repeat node, which is not in this slice', { type: 'repeat', field: 'value' }],
    ['a node type nobody has heard of', { type: 'embed', field: 'value' }],
    ['a node with no type at all', { field: 'value' }],
    ['an interpolation node smuggled into a structured document', { kind: 'html', value: '<script>alert(1)</script>' }],
  ])('refuses %s', (_l, node) => {
    const def = structuredDef([{ name: 'value', type: 'text', label: 'Value' }], [node as unknown as StructuredNode])
    expect(render(def, { value: 'x' })).toBe('')
  })

  it.each([
    ['a tag that can execute', 'script'],
    ['a tag that can fetch', 'iframe'],
    ['a tag that can submit', 'form'],
    ['an anchor, which is the link field’s job', 'a'],
    ['an image, which is the image field’s job', 'img'],
    ['a tag that changes how the document parses', 'svg'],
  ])('refuses an element node with %s', (_l, tag) => {
    const def = structuredDef([], [{ type: 'element', tag, children: [] } as unknown as StructuredNode])
    expect(render(def, {})).toBe('')
  })

  it.each([
    ['an event handler', { onclick: 'alert(1)' }],
    ['a style declaration list', { style: 'background:url(//evil.test/x)' }],
    ['a URL attribute', { href: '/somewhere' }],
    ['srcdoc', { srcdoc: '<script>alert(1)</script>' }],
    ['an attribute name that is not one', { 'data-anything': 'x' }],
  ])('refuses an element node carrying %s', (_l, attributes) => {
    const def = structuredDef(
      [],
      [{ type: 'element', tag: 'div', attributes, children: [] } as unknown as StructuredNode],
    )
    expect(render(def, {})).toBe('')
  })

  it.each([
    ['a doubled space', 'a  b'],
    ['a trailing space', 'a '],
    ['a leading space', ' a'],
    ['nothing at all', ''],
    ['a token that does not start with a letter', '1bad'],
  ])('refuses a class list containing %s, the same as the database does', (_l, value) => {
    // The grammar is a split-and-check here and one repeated-token pattern in
    // `app.is_structured_attribute_value`, so the two are only equivalent if the
    // awkward cases agree. Each of these produces an empty token on this side
    // and fails the pattern on the other.
    const def = structuredDef([], [{ type: 'element', tag: 'div', attributes: { class: value } }])
    expect(render(def, {})).toBe('')
  })

  it('refuses a field node whose declared type is not the type it is used as', () => {
    // The editor would offer a plain box for a value the renderer sanitizes as
    // markup, and neither half is wrong enough to be the one that gets fixed.
    const def = structuredDef([{ name: 'value', type: 'text', label: 'Value' }], [{ type: 'richtext', field: 'value' }])
    expect(render(def, { value: 'x' })).toBe('')
  })

  it('refuses a field node the document never declares', () => {
    expect(render(structuredDef([], [{ type: 'text', field: 'value' }]), { value: 'x' })).toBe('')
  })
})

describe('a malformed document renders nothing', () => {
  it.each([
    ['no document at all', undefined],
    ['a null document', null],
    ['a string', 'not a document'],
    ['a list', []],
    ['no node list', { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [] }],
    ['no field list', { schemaVersion: STRUCTURED_SCHEMA_VERSION, nodes: [] }],
    [
      'a key this schema version does not define',
      { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [], behaviour: 'run' },
    ],
    [
      'a field declared twice',
      {
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        fields: [
          { name: 'a', type: 'text', label: 'A' },
          { name: 'a', type: 'richtext', label: 'A' },
        ],
        nodes: [],
      },
    ],
    [
      'a field name that is not one',
      {
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        fields: [{ name: 'a}}<div ', type: 'text', label: 'A' }],
        nodes: [],
      },
    ],
    [
      'a void element with children',
      {
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        fields: [],
        nodes: [{ type: 'element', tag: 'br', children: [{ type: 'element', tag: 'p' }] }],
      },
    ],
    [
      'children that are not a list',
      {
        schemaVersion: STRUCTURED_SCHEMA_VERSION,
        fields: [],
        nodes: [{ type: 'element', tag: 'div', children: 'x' }],
      },
    ],
  ])('refuses %s', (_l, document) => {
    expect(render(oneField('text', { structured_doc: document }), { value: 'x' })).toBe('')
  })

  it('refuses a document that nests deeper than the walkers will go', () => {
    let node: StructuredNode = { type: 'text', field: 'value' }
    for (let i = 0; i < 40; i += 1) node = { type: 'element', tag: 'div', children: [node] }
    const def = structuredDef([{ name: 'value', type: 'text', label: 'Value' }], [node])
    expect(render(def, { value: 'x' })).toBe('')
  })

  it('names what is wrong, so an author is told rather than shown an empty page', () => {
    const problems = structuredSectionProblems(
      oneField('text', {
        structured_doc: {
          schemaVersion: STRUCTURED_SCHEMA_VERSION,
          fields: [],
          nodes: [{ type: 'text', field: 'value' }],
        },
      }),
    )
    expect(problems.join(' ')).toContain('uses field value, which it never declares')
  })

  it('returns null from the body renderer, so a refusal is not an empty section', () => {
    // The distinction the caller depends on: "this definition renders nothing"
    // has to drop the wrapper and the stylesheet too, while "this definition
    // renders nothing visible" is an ordinary empty region.
    expect(renderStructuredBody(oneField('text', { structured_doc: null }), {})).toBeNull()
    expect(renderStructuredBody(oneField('text'), {})).toBe('<section></section>')
  })
})

// ------------------------------------------------------------ instrumentation

describe('preview and public output differ only by instrumentation', () => {
  const def = structuredDef(
    [
      { name: 'heading', type: 'text', label: 'Heading' },
      { name: 'body', type: 'richtext', label: 'Body' },
    ],
    [
      {
        type: 'element',
        tag: 'section',
        attributes: { class: 'quote' },
        children: [
          { type: 'element', tag: 'h2', children: [{ type: 'text', field: 'heading' }] },
          { type: 'element', tag: 'div', children: [{ type: 'richtext', field: 'body' }] },
        ],
      },
    ],
  )
  const values = { heading: 'A heading', body: '<p>Some <em>text</em>.</p>' }

  it('carries no editor attribute in public output', () => {
    const html = render(def, values)
    expect(html).not.toContain('data-cms-')
    expect(html).toContain('<h2>A heading</h2>')
  })

  it('wraps each field in the same selectable node the interpolation path uses', () => {
    // One instrumentation vocabulary for both models. A second attribute name
    // would mean the canvas runtime and the inspector each had to know which
    // compiler produced a section, which is the coupling the discriminator
    // exists to remove.
    const html = render(def, values, true)
    expect(html).toContain('<cms-slot data-cms-slot="heading" data-cms-kind="text">A heading</cms-slot>')
    expect(html).toContain('data-cms-slot="body" data-cms-kind="richtext"')
  })

  it('is the same document once the instrumentation is stripped', () => {
    const strip = (html: string) =>
      html
        .replace(/<cms-slot data-cms-slot="[^"]*" data-cms-kind="[^"]*">([\s\S]*?)<\/cms-slot>/g, '$1')
        .replace(/ data-cms-[a-z]+="[^"]*"/g, '')
    expect(strip(render(def, values, true))).toBe(render(def, values))
  })

  it('emits a field node’s static attributes identically on both paths', () => {
    // The attributes belong to the definition, so they cannot depend on who is
    // looking. Preview adds a wrapper around the anchor and nothing inside it.
    const withAttributes = structuredDef(
      [
        { name: 'cta', type: 'link', label: 'Call to action' },
        { name: 'portrait', type: 'image', label: 'Portrait' },
      ],
      [
        { type: 'link', field: 'cta', staticAttributes: { class: ['btn'], rel: ['nofollow'], target: '_blank' } },
        {
          type: 'image',
          field: 'portrait',
          staticAttributes: { class: ['media'], width: 640, height: 360, loading: 'lazy' },
        },
      ],
    )
    const content = {
      cta: { url: '/about', label: 'About' },
      portrait: { src: '/a.png', alt: 'A photograph' },
    }
    const anchor = '<a href="/about" class="btn" rel="nofollow noopener" target="_blank">About</a>'
    const image = '<img src="/a.png" alt="A photograph" class="media" width="640" height="360" loading="lazy">'

    expect(render(withAttributes, content)).toBe(
      `<div id="s0" class="cms-section cms-section--structured">${anchor}${image}</div>`,
    )
    const preview = render(withAttributes, content, true)
    expect(preview).toContain(`<cms-slot data-cms-slot="cta" data-cms-kind="link">${anchor}</cms-slot>`)
    expect(preview).toContain(`<cms-slot data-cms-slot="portrait" data-cms-kind="image">${image}</cms-slot>`)
  })
})

describe('the renderer serializes a tree rather than concatenating fragments', () => {
  it('cannot be closed early by a value that looks like an end tag', () => {
    const html = render(oneField('text'), { value: '</section><section onclick="alert(1)">' })
    expect(html).toBe(
      '<div id="s0" class="cms-section cms-section--structured"><section>' +
        '&lt;/section&gt;&lt;section onclick="alert(1)"&gt;</section></div>',
    )
  })

  it('emits a void element with no end tag, because two would be two line breaks', () => {
    const def = structuredDef([], [{ type: 'element', tag: 'br' }])
    expect(render(def, {})).toContain('<br></div>')
  })
})
