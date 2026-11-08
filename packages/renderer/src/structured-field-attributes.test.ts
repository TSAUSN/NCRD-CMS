import { describe, expect, it } from 'vitest'
import {
  STRUCTURED_IMAGE_DECODINGS,
  STRUCTURED_IMAGE_FETCH_PRIORITIES,
  STRUCTURED_IMAGE_LOADINGS,
  STRUCTURED_LINK_RELS,
  type StructuredNode,
} from '@cms/schema'
import type { SectionDefView } from './render.ts'
import { cases, render, structuredDef } from './fixtures/structured-rendering.ts'
import { renderStructuredBody } from './structured.ts'

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
