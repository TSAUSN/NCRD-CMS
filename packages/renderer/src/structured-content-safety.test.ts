import { describe, expect, it } from 'vitest'
import { STRUCTURED_ARIA_CURRENT_STATES, STRUCTURED_SCHEMA_VERSION, type StructuredNode } from '@cms/schema'
import { FORBIDDEN_IN_ATTRIBUTES, FORBIDDEN_TAGS } from './fixtures/malicious.ts'
import { cases, oneField, render, structuredDef } from './fixtures/structured-rendering.ts'
import { compileStructuredSection, renderStructuredBody, structuredSectionProblems } from './structured.ts'

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
