import { describe, expect, it } from 'vitest'
import { STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import {
  renderStructuredBody,
  sectionScopeSelector,
  structuredSectionProblems,
  validateCompiledCss,
} from '@cms/renderer'
import { CONSUMED_BY_SECTION, convertDefinition, repeatUnits, type Conversion } from './convert.ts'
import type { V1Slot } from './source.ts'

const slot = (blockId: string, editable: string, label = blockId): V1Slot => ({ blockId, editable, label, role: null })

function convert(input: {
  id?: string
  html: string
  css?: string
  slots?: V1Slot[]
  presetClasses?: string[]
}): Conversion {
  return convertDefinition({
    id: input.id ?? 'fixture-v1',
    html: input.html,
    css: input.css ?? '.a{color:#111}',
    slots: input.slots ?? [],
    presetClasses: input.presetClasses ?? [],
  })
}

const codes = (conversion: Conversion): string[] => conversion.reasons.map(reason => reason.code)

describe('converting a definition the structured schema can express', () => {
  const converted = convert({
    id: 'quote-v1',
    html:
      '<section class="cms-section-quote">' +
      '<blockquote class="cms-section-quote__text" data-block-id="quote-text" data-editable="richtext">' +
      '<p>placeholder</p></blockquote>' +
      '<span class="cms-section-quote__name" data-block-id="quote-name" data-editable="text">Name</span>' +
      '</section>',
    css: '.cms-section-quote{padding:2rem}.cms-section-quote__text{margin:0}',
    slots: [slot('quote-text', 'richtext', 'Quote'), slot('quote-name', 'text', 'Name')],
  })

  it('reports no reasons at all, which is what automatic means', () => {
    expect(codes(converted)).toEqual([])
    expect(converted.status).toBe('automatic')
  })

  it('keeps the element that carries the class and puts the field inside it', () => {
    expect(converted.document?.nodes).toEqual([
      {
        type: 'element',
        tag: 'section',
        attributes: { class: 'cms-section-quote' },
        children: [
          {
            type: 'element',
            tag: 'blockquote',
            attributes: { class: 'cms-section-quote__text' },
            children: [{ type: 'richtext', field: 'quote-text' }],
          },
          {
            type: 'element',
            tag: 'span',
            attributes: { class: 'cms-section-quote__name' },
            children: [{ type: 'text', field: 'quote-name' }],
          },
        ],
      },
    ])
  })

  it('declares every field with the type and label V1 declared', () => {
    expect(converted.document?.fields).toEqual([
      { name: 'quote-text', type: 'richtext', label: 'Quote' },
      { name: 'quote-name', type: 'text', label: 'Name' },
    ])
  })

  it('produces a document the renderer’s own validator accepts', () => {
    expect(
      structuredSectionProblems({
        definition_kind: 'structured',
        structured_doc: converted.document,
        structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      }),
    ).toEqual([])
  })

  it('produces CSS that validateCompiledCss accepts under this definition’s own scope', () => {
    const scope = sectionScopeSelector('quote-v1')!
    expect(validateCompiledCss(converted.compiledCss!, scope)).toEqual([])
    expect(converted.compiledCss).toContain('.cms-section--quote-v1')
  })

  it('renders the values the fields name, through the policies each type carries', () => {
    const html = renderStructuredBody(
      {
        definition_kind: 'structured',
        structured_doc: converted.document,
        structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      },
      { 'quote-text': '<p>A quote</p>', 'quote-name': 'A & B' },
    )
    expect(html).toBe(
      '<section class="cms-section-quote">' +
        '<blockquote class="cms-section-quote__text"><p>A quote</p></blockquote>' +
        '<span class="cms-section-quote__name">A &amp; B</span>' +
        '</section>',
    )
  })
})

// The schema-v2 half of the mapping. `static-attributes.test.ts` holds the
// grammar case by case; what is checked here is that the converter reaches it,
// puts the result where the renderer looks for it, and produces a document the
// stored-row validator accepts — which is the only definition of "automatic"
// this package is allowed to use.
describe('carrying a link or image field’s governed static attributes', () => {
  const converted = convert({
    id: 'cta-v1',
    html:
      '<div class="wrap">' +
      '<a class="btn btn--primary" target="_blank" rel="noopener external"' +
      ' data-block-id="cta" data-editable="link" href="#">Go</a>' +
      '<img loading="lazy" width="1600" height="900" decoding="async" fetchpriority="high"' +
      ' class="shot" data-block-id="shot" data-editable="image" src="/a.webp" alt="">' +
      '</div>',
    css: '.wrap{display:flex}.btn{padding:1rem}.shot{width:100%}',
    slots: [slot('cta', 'link', 'Call to action'), slot('shot', 'image', 'Screenshot')],
  })

  it('reports no reasons at all, which is what automatic means', () => {
    expect(codes(converted)).toEqual([])
    expect(converted.status).toBe('automatic')
  })

  it('stores a class list as the token array the model holds, never as one string', () => {
    const link = converted.document?.nodes[0]
    expect(link).toMatchObject({
      type: 'element',
      children: [
        {
          type: 'link',
          field: 'cta',
          staticAttributes: { class: ['btn', 'btn--primary'], rel: ['noopener', 'external'], target: '_blank' },
        },
        {
          type: 'image',
          field: 'shot',
          staticAttributes: {
            class: ['shot'],
            width: 1600,
            height: 900,
            decoding: 'async',
            loading: 'lazy',
            fetchpriority: 'high',
          },
        },
      ],
    })
  })

  it('writes the keys in the schema’s order rather than in the order V1 typed them', () => {
    // The document is hashed and key order in JSON is insertion order, so an
    // author's typing must not reach the bytes. The image above is written
    // `loading width height decoding fetchpriority class`; the stored keys are
    // `STRUCTURED_IMAGE_STATIC_ATTRIBUTES`.
    const children = (converted.document?.nodes[0] as { children: unknown[] }).children
    expect(Object.keys((children[0] as { staticAttributes: object }).staticAttributes)).toEqual([
      'class',
      'rel',
      'target',
    ])
    expect(Object.keys((children[1] as { staticAttributes: object }).staticAttributes)).toEqual([
      'class',
      'width',
      'height',
      'decoding',
      'loading',
      'fetchpriority',
    ])
  })

  it('produces a document the renderer’s own validator accepts', () => {
    expect(
      structuredSectionProblems({
        definition_kind: 'structured',
        structured_doc: converted.document,
        structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      }),
    ).toEqual([])
  })

  it('renders the attributes back onto the anchor and the image', () => {
    const html = renderStructuredBody(
      {
        definition_kind: 'structured',
        structured_doc: converted.document,
        structured_schema_version: STRUCTURED_SCHEMA_VERSION,
      },
      { cta: { url: '/give', label: 'Give' }, shot: { src: '/a.webp', alt: 'A screenshot' } },
    )
    // `rel` comes back in the allowlist's own order rather than V1's, because
    // the renderer assembles it as a set from the definition and its own
    // `noopener` guarantee. Everything else is emitted as it was stored.
    expect(html).toContain('class="btn btn--primary"')
    expect(html).toContain('rel="external noopener"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('class="shot" width="1600" height="900"')
    expect(html).toContain('decoding="async" loading="lazy" fetchpriority="high"')
  })

  it('leaves the key off entirely when a field element carried nothing to put in it', () => {
    const bare = convert({
      html: '<p><a data-block-id="l" data-editable="link" href="#">Go</a></p>',
      slots: [slot('l', 'link', 'Link')],
    })
    const link = (bare.document?.nodes[0] as { children: object[] }).children[0]!
    // Not `staticAttributes: {}`. ADR 0008 is explicit that a node which never
    // asked for one has no key at all, and an empty object is a different
    // document that says the same nothing.
    expect(Object.keys(link)).toEqual(['type', 'field'])
  })
})

describe('refusing what the structured schema has no vocabulary for', () => {
  it('quarantines an icon whose authored SVG has no verified closed-icon mapping', () => {
    const converted = convert({
      html: '<span data-block-id="i" data-editable="icon"><svg viewBox="0 0 1 1"><path d="M0 0" /></svg></span>',
      slots: [slot('i', 'icon')],
    })
    expect(codes(converted)).toContain('icon-field')
    expect(converted.status).toBe('quarantined')
    expect(converted.document).toBeNull()
  })

  it('counts an icon slot even when the markup around it could not be read at all', () => {
    const converted = convert({
      html: '<div><script>x</script></div>',
      slots: [slot('i', 'icon')],
    })
    expect(codes(converted)).toEqual(['icon-field', 'html-parse-failed'])
  })

  it('quarantines a numbered slot family, which is a repeat with its cardinality baked in', () => {
    const converted = convert({
      html:
        '<ul><li data-block-id="amount-1-value" data-editable="text">a</li>' +
        '<li data-block-id="amount-2-value" data-editable="text">b</li></ul>',
      slots: [slot('amount-1-value', 'text'), slot('amount-2-value', 'text')],
    })
    expect(codes(converted)).toContain('repeat-family')
  })

  it('does not call a lone numbered slot a family', () => {
    expect(repeatUnits([slot('card-1-title', 'text')])).toEqual([])
    expect(repeatUnits([slot('card-1-title', 'text'), slot('card-2-title', 'text')])).toEqual(['card'])
  })

  it('quarantines a button rather than re-typing it as a link', () => {
    expect(codes(convert({ html: '<div><button type="submit">Go</button></div>' }))).toContain('button-element')
  })

  it('quarantines a button that carries an editable label, as a button', () => {
    const converted = convert({
      html: '<button data-block-id="b" data-editable="text">Go</button>',
      slots: [slot('b', 'text')],
    })
    expect(codes(converted)).toEqual(['button-element'])
  })

  it('quarantines a form rather than inventing its endpoint and submission behavior', () => {
    expect(codes(convert({ html: '<form action="#"><input name="q"></form>' }))).toContain('form-element')
  })

  it('quarantines an iframe, because an embed is a policy decision about a third party', () => {
    expect(codes(convert({ html: '<div><iframe src="" title="x"></iframe></div>' }))).toContain('embed-element')
  })

  it('quarantines copy that sits outside every editable region', () => {
    expect(codes(convert({ html: '<section><h2>A fixed heading</h2></section>' }))).toContain('static-text')
  })

  it('keeps whitespace between elements out of the static-text count', () => {
    const converted = convert({
      html: '<section>\n  <p data-block-id="t" data-editable="text">x</p>\n</section>',
      slots: [slot('t', 'text')],
    })
    expect(codes(converted)).toEqual([])
  })
})

describe('refusing markup that exceeds the allowlists', () => {
  it('quarantines a static anchor, which has no tag and no field to be', () => {
    const converted = convert({ html: '<p><a href="/x">go</a></p>' })
    expect(codes(converted)).toContain('unsupported-element')
    expect(converted.reasons.find(reason => reason.code === 'unsupported-element')?.detail).toBe('a')
  })

  // The attribute here used to be `data-cms-section`, which is now consumed
  // rather than refused — see the `CONSUMED_BY_SECTION` group below.
  // `data-cms-label` is the same shape and is still refused: V1 editor copy
  // whose v2 spelling is `StructuredFieldDef.label`, in the document's fields
  // array rather than an attribute shipped to every visitor.
  it('quarantines an attribute the model does not allow, naming it but never its value', () => {
    const converted = convert({ html: '<div data-cms-label="Support us today"><span></span></div>' })
    const found = converted.reasons.find(reason => reason.code === 'unsupported-attribute')
    expect(found?.detail).toBe('data-cms-label')
    expect(JSON.stringify(converted.reasons)).not.toContain('Support us today')
  })

  it('quarantines a class the structured token grammar cannot hold, such as a Tailwind utility', () => {
    const converted = convert({ html: '<div class="px-4 sm:px-6"><span></span></div>' })
    expect(converted.reasons.find(reason => reason.code === 'unsupported-attribute')?.detail).toBe('class value')
  })

  it('quarantines a link whose class list carries a framework utility the grammar refuses', () => {
    const converted = convert({
      html: '<p><a class="cta sm:px-6" data-block-id="l" data-editable="link" href="#">Go</a></p>',
      slots: [slot('l', 'link')],
    })
    // `class(value)` rather than `class`: the model has the attribute and
    // refuses this value, which is a different thing to fix than an attribute
    // the model does not have at all.
    expect(converted.reasons.find(reason => reason.code === 'field-attributes-lost')?.detail).toBe('a: class(value)')
  })

  it('converts a link that carries nothing but its href and its markers', () => {
    const converted = convert({
      html: '<p><a data-block-id="l" data-editable="link" href="#">Go</a></p>',
      slots: [slot('l', 'link', 'Link')],
    })
    expect(codes(converted)).toEqual([])
    expect(converted.document?.nodes).toEqual([
      { type: 'element', tag: 'p', attributes: {}, children: [{ type: 'link', field: 'l' }] },
    ])
  })

  it('quarantines an image over the inline style it carries, and names only that one', () => {
    const converted = convert({
      html:
        '<figure><img data-block-id="i" data-editable="image" src="/a.webp" alt=""' +
        ' width="10" height="8" style="opacity:.5"></figure>',
      slots: [slot('i', 'image')],
    })
    // The dimensions beside it are expressible now, so a detail naming them too
    // would send somebody to fix the wrong thing.
    expect(converted.reasons.find(reason => reason.code === 'field-attributes-lost')?.detail).toBe('img: style')
  })

  it('quarantines a link that wraps other content, which a field node cannot do', () => {
    const converted = convert({
      html: '<a data-block-id="l" data-editable="link" href="#"><span data-block-id="t" data-editable="text">x</span></a>',
      slots: [slot('l', 'link'), slot('t', 'text')],
    })
    expect(codes(converted)).toContain('nested-editable')
  })

  it('quarantines one editable region nested inside another', () => {
    const converted = convert({
      html:
        '<div data-block-id="outer" data-editable="richtext">' +
        '<span data-block-id="inner" data-editable="text">x</span></div>',
      slots: [slot('outer', 'richtext'), slot('inner', 'text')],
    })
    expect(codes(converted)).toContain('nested-editable')
  })

  it('quarantines a link declared on something that is not an anchor', () => {
    const converted = convert({
      html: '<span data-block-id="l" data-editable="link">x</span>',
      slots: [slot('l', 'link')],
    })
    expect(converted.reasons.find(reason => reason.code === 'unexpected-field-element')?.detail).toBe('link on <span>')
  })
})

// A text field renders an escaped string and a richtext field renders sanitized
// HTML, so the same `<em>` is a loss in one region and the sample value in the
// other. The walk used to treat both the same way — it kept the region's element
// and replaced its children with a field node — which was right for richtext and
// silently destructive for text.
describe('refusing a plain-text region whose markup a text field cannot reproduce', () => {
  it('quarantines it, naming the tags that would be lost and never the words', () => {
    const converted = convert({
      html:
        '<h1 class="hero__title" data-block-id="t" data-editable="text">' +
        'Ending <span class="hero__accent">extreme poverty</span><br>in a generation</h1>',
      slots: [slot('t', 'text', 'Title')],
    })
    expect(codes(converted)).toContain('text-region-markup')
    expect(converted.reasons.find(reason => reason.code === 'text-region-markup')?.detail).toBe('br span')
    expect(converted.status).toBe('quarantined')
    expect(converted.document).toBeNull()
    // Tag names are structural HTML. The copy between them is V1's, and this
    // list is written to a file in this repository.
    expect(JSON.stringify(converted.reasons)).not.toContain('extreme poverty')
  })

  it('names every tag in the region rather than only its outermost children', () => {
    const converted = convert({
      html: '<h2 data-block-id="t" data-editable="text">A <span><em>measured</em></span> claim</h2>',
      slots: [slot('t', 'text', 'Heading')],
    })
    // An author giving up the `<span>` gives up the `<em>` inside it too, and a
    // detail that stopped at the direct children would understate that.
    expect(converted.reasons.find(reason => reason.code === 'text-region-markup')?.detail).toBe('em span')
  })

  it('leaves a richtext region carrying the very same markup automatic', () => {
    const converted = convert({
      html:
        '<div class="prose" data-block-id="b" data-editable="richtext">' +
        '<p>Ending <em>extreme poverty</em><br>in a generation</p></div>',
      slots: [slot('b', 'richtext', 'Body')],
    })
    // The markup inside a richtext region is the sample value the field
    // replaces, and a richtext value can express it again.
    expect(codes(converted)).toEqual([])
    expect(converted.status).toBe('automatic')
    expect(converted.document?.nodes).toEqual([
      {
        type: 'element',
        tag: 'div',
        attributes: { class: 'prose' },
        children: [{ type: 'richtext', field: 'b' }],
      },
    ])
  })

  it('still counts what else the region carries, rather than stopping at the markup', () => {
    const converted = convert({
      html: '<h1 data-cms-label="Title" data-block-id="t" data-editable="text">A <br>B</h1>',
      slots: [slot('t', 'text', 'Title')],
    })
    expect(codes(converted)).toEqual(['text-region-markup', 'unsupported-attribute'])
  })

  it('leaves a text region holding nothing but words alone', () => {
    const converted = convert({
      html: '<span data-block-id="t" data-editable="text">A name</span>',
      slots: [slot('t', 'text', 'Name')],
    })
    expect(codes(converted)).toEqual([])
  })
})

// ADR 0009's finding, made operational: 20 definitions carry `data-cms-section`
// once each on their root element, with a value unique to the definition, that
// no stylesheet in the catalogue and no rule in INTERACTION_PRESET_CSS selects
// on. It is V1's seam between a static page and V1's CMS, and v2 re-derives the
// identity from the row.
describe('consuming data-cms-section as the authoring metadata it is', () => {
  const converted = convert({
    id: 'home-hero-v1',
    html:
      '<section class="hero" data-cms-section="home-hero">' +
      '<p class="hero__lede" data-cms-section="home-hero-lede"' +
      ' data-block-id="lede" data-editable="text">A lede</p>' +
      '</section>',
    css: '.hero{padding:4rem}.hero__lede{margin:0}',
    slots: [slot('lede', 'text', 'Lede')],
  })

  it('holds exactly the one attribute the evidence covers', () => {
    // A set with a second name in it would be a widening of the attribute
    // policy wearing this one's clothes; every other data-* in the census is
    // still refused one by one.
    expect([...CONSUMED_BY_SECTION]).toEqual(['data-cms-section'])
  })

  it('converts a definition whose only obstacle was that attribute', () => {
    expect(codes(converted)).toEqual([])
    expect(converted.status).toBe('automatic')
  })

  it('strips it wherever it sits, not only on the root the catalogue happens to use', () => {
    expect(converted.document?.nodes).toEqual([
      {
        type: 'element',
        tag: 'section',
        attributes: { class: 'hero' },
        children: [
          {
            type: 'element',
            tag: 'p',
            attributes: { class: 'hero__lede' },
            children: [{ type: 'text', field: 'lede' }],
          },
        ],
      },
    ])
  })

  it('never carries V1’s value into the document, which v2 gives a different meaning', () => {
    // v2's renderer emits `data-cms-section` on the section wrapper to carry the
    // section index, and the preview runtime reads it to say which section was
    // clicked. A V1 page identity stored on an inner element would answer that
    // query wrongly.
    expect(JSON.stringify(converted.document)).not.toContain('home-hero')
    expect(converted.compiledCss).not.toContain('data-cms-section')
  })

  it('does not smuggle any other data-* attribute past the allowlist with it', () => {
    const converted = convert({
      html: '<div data-cms-section="explore-hero" data-fe-block="1"><span></span></div>',
    })
    expect(converted.reasons.find(reason => reason.code === 'unsupported-attribute')?.detail).toBe('data-fe-block')
  })
})

describe('refusing what the definition does not carry with it', () => {
  it('quarantines a definition whose layout comes from the shared preset stylesheet', () => {
    const converted = convert({
      html: '<p class="fx-lift" data-block-id="t" data-editable="text">x</p>',
      css: '.other{color:#111}',
      slots: [slot('t', 'text')],
      presetClasses: ['fx-lift'],
    })
    expect(converted.reasons.find(reason => reason.code === 'interaction-preset-css')?.detail).toBe('fx-lift')
  })

  it('does not call a class borrowed when the definition styles it itself', () => {
    const converted = convert({
      html: '<p class="fx-lift" data-block-id="t" data-editable="text">x</p>',
      css: '.fx-lift{color:#111}',
      slots: [slot('t', 'text', 'Text')],
      presetClasses: ['fx-lift'],
    })
    expect(codes(converted)).toEqual([])
  })

  it('quarantines a definition whose CSS the policy would partly drop', () => {
    const converted = convert({
      html: '<p data-block-id="t" data-editable="text">x</p>',
      css: '@keyframes spin{from{transform:none}}.a{animation:spin 1s}',
      slots: [slot('t', 'text')],
    })
    expect(converted.reasons.find(reason => reason.code === 'css-policy-dropped')?.detail).toBe('unsupported-at-rule')
  })

  it('quarantines a definition whose CSS the policy refuses outright', () => {
    const converted = convert({
      html: '<p data-block-id="t" data-editable="text">x</p>',
      css: '.a{color:#111',
      slots: [slot('t', 'text')],
    })
    expect(converted.reasons.find(reason => reason.code === 'css-rejected')?.detail).toBe('unparseable')
  })

  it('never lets a rejected stylesheet’s own text reach a reason', () => {
    const converted = convert({
      html: '<p data-block-id="t" data-editable="text">x</p>',
      css: '.secret-brand-name{background:url(https://elsewhere.test/a.png)}',
      slots: [slot('t', 'text')],
    })
    expect(JSON.stringify(converted.reasons)).not.toContain('secret-brand-name')
    expect(JSON.stringify(converted.reasons)).not.toContain('elsewhere.test')
  })

  it('quarantines an id that cannot be a section scope before it reaches the CSS policy', () => {
    expect(codes(convert({ id: 'Not A Slug', html: '<p></p>' }))).toContain('css-rejected')
  })
})

describe('what a conversion says about itself', () => {
  it('withholds the document, the CSS and the render hash from anything quarantined', () => {
    const converted = convert({ html: '<div><button>x</button></div>' })
    expect(converted.document).toBeNull()
    expect(converted.compiledCss).toBeNull()
    expect(converted.renderHash).toBeNull()
  })

  it('sorts attributes by name so two runs serialize an element identically', () => {
    const converted = convert({
      html: '<div role="note" id="a" class="b"><span data-block-id="t" data-editable="text">x</span></div>',
      slots: [slot('t', 'text', 'Text')],
    })
    const [element] = converted.document!.nodes
    if (element === undefined || element.type !== 'element') throw new Error('expected an element node')
    expect(Object.keys(element.attributes ?? {})).toEqual(['class', 'id', 'role'])
  })

  it('collects every reason in a definition rather than stopping at the first', () => {
    const converted = convert({
      html:
        '<section><button>x</button><table><tr><td>y</td></tr></table>' +
        '<iframe src="" title="t"></iframe></section>',
    })
    expect(codes(converted)).toEqual(
      expect.arrayContaining(['button-element', 'embed-element', 'unsupported-element', 'static-text']),
    )
  })
})

describe('the section identity is consumed wherever V1 wrote it', () => {
  // The comment on `CONSUMED_BY_SECTION` says "every element", and a link or an
  // image field node is the one place that sentence could quietly have stopped
  // being true: those two never reach `Walk.attributes()` at all, because a
  // field node has no element to hang attributes on.
  it('strips it from a link field element as well as from an element node', () => {
    const converted = convert({
      html:
        '<div><a data-block-id="more" data-editable="link" data-cms-section="home-hero" ' + 'href="/x">Read</a></div>',
      slots: [{ blockId: 'more', editable: 'link', label: 'Read more', role: null }],
    })
    expect(converted.status).toBe('automatic')
    expect(JSON.stringify(converted.document)).not.toContain('home-hero')
  })

  it('strips it from an image field element too', () => {
    const converted = convert({
      html:
        '<div><img data-block-id="pic" data-editable="image" data-cms-section="home-hero" ' +
        'src="/a.png" alt="A"></div>',
      slots: [{ blockId: 'pic', editable: 'image', label: 'Picture', role: null }],
    })
    expect(converted.status).toBe('automatic')
    expect(JSON.stringify(converted.document)).not.toContain('home-hero')
  })
})
