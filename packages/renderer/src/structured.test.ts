import { describe, expect, it } from 'vitest'
import { STRUCTURED_SCHEMA_VERSION, upgradeStructuredDocument, type StructuredNode } from '@cms/schema'
import { compileSection } from './compile.ts'
import { CSS_POLICY_VERSION } from './css.ts'
import { renderPage, type RenderManifest, type SectionDefView, type SiteShell } from './render.ts'
import { compileStructuredSection, renderStructuredBody, structuredSectionProblems } from './structured.ts'
import { oneField, render, structuredDef } from './fixtures/structured-rendering.ts'

const SHELL: SiteShell = {
  site: { id: 'site', name: 'Site', slug: 'site' },
  theme: {},
  navigation: [],
  canonical_host: null,
  staging_host: null,
}

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
