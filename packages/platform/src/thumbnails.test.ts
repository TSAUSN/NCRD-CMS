// What a thumbnail is allowed to be a picture of, and what a machine with no
// browser is allowed to hand back (SPEC §6.5, D3).
//
// None of this launches Chromium. The document builder is a pure function and
// the fallback is a pure function, which is deliberate: the parts that decide
// *what* gets photographed and *whether the answer is real* are exactly the
// parts that must be checkable without a browser, or they end up checked by
// looking at a card and deciding it seems fine.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  compileSection,
  compileStructuredSection,
  sectionScopeSelector,
  type SectionDefView,
} from '@cms/renderer'
import { HNI_TABLEAU_EMBEDS, STRUCTURED_SCHEMA_VERSION } from '@cms/schema'
import {
  LIBRARY_THEME,
  THUMBNAIL_PLACEHOLDER_IMAGE,
  buildThumbnailDocument,
  embedThumbnailFiles,
  thumbnailMediaIds,
  thumbnailPlaceholderValues,
} from './thumbnails.ts'
import { createPlaceholderScreenshotter } from './local/index.ts'

/** A legacy definition compiled the way the authoring command compiles one. */
function legacyDef(overrides: Partial<SectionDefView> = {}): SectionDefView {
  const slug = overrides.slug ?? 'hero'
  const compiled = compileSection({
    sourceHtml:
      '<section class="hero"><h1>{{heading}}</h1><p>{{intro}}</p>' + '<img src="{{shot}}" alt="{{shotAlt}}"></section>',
    sourceCss: '.hero{padding:4rem 1.5rem;text-align:center}',
    slots: [
      { id: 'heading', kind: 'text', label: 'Headline', constraints: {} },
      { id: 'intro', kind: 'richtext', label: 'Supporting copy', constraints: {} },
      { id: 'shot', kind: 'text', label: 'Screenshot', constraints: {} },
      { id: 'shotAlt', kind: 'text', label: 'Screenshot description', constraints: {} },
    ],
    scopeSelector: sectionScopeSelector(slug) ?? undefined,
  })
  return {
    section_def_id: '11111111-1111-1111-1111-111111111111',
    version: 3,
    slug,
    compiled_ast: compiled.ast,
    css: compiled.css,
    css_policy_version: CSS_POLICY_VERSION,
    sanitizer_policy_version: SANITIZER_POLICY_VERSION,
    slots: [
      { id: 'heading', kind: 'text', label: 'Headline', constraints: {} },
      { id: 'intro', kind: 'richtext', label: 'Supporting copy', constraints: {} },
      { id: 'shot', kind: 'image', label: 'Screenshot', constraints: {} },
    ],
    definition_kind: 'legacy',
    ...overrides,
  }
}

/** A structured definition, compiled through the structured authoring path. */
function structuredDef(overrides: Partial<SectionDefView> = {}): SectionDefView {
  const slug = overrides.slug ?? 'feature-row'
  const document = {
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [
      { name: 'eyebrow', type: 'text', label: 'Eyebrow' },
      { name: 'body', type: 'richtext', label: 'Supporting copy' },
      { name: 'cta', type: 'link', label: 'Call to action' },
      { name: 'shot', type: 'image', label: 'Illustration' },
    ],
    nodes: [
      {
        type: 'element',
        tag: 'section',
        children: [
          { type: 'element', tag: 'p', children: [{ type: 'text', field: 'eyebrow' }] },
          { type: 'element', tag: 'div', children: [{ type: 'richtext', field: 'body' }] },
          { type: 'link', field: 'cta' },
          { type: 'image', field: 'shot' },
        ],
      },
    ],
  }
  const compiled = compileStructuredSection({
    slug,
    document,
    sourceCss: '.row{display:flex;gap:1rem}',
  })
  expect(compiled.blocking).toEqual([])
  return {
    section_def_id: '22222222-2222-2222-2222-222222222222',
    version: 1,
    slug,
    // A structured row carries the empty compiled AST its authoring command
    // stores; the markup lives in `structured_doc`.
    compiled_ast: {
      nodes: [],
      policyVersion: SANITIZER_POLICY_VERSION,
      cssPolicyVersion: CSS_POLICY_VERSION,
    },
    css: compiled.css,
    css_policy_version: CSS_POLICY_VERSION,
    sanitizer_policy_version: SANITIZER_POLICY_VERSION,
    definition_kind: 'structured',
    structured_doc: document,
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    ...overrides,
  }
}

describe('the document a thumbnail is a picture of', () => {
  it('photographs an inert provider description instead of a blocked live frame', () => {
    const def = structuredDef({
      structured_doc: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [HNI_TABLEAU_EMBEDS.map] },
    })
    const thumbnail = buildThumbnailDocument({ def })
    expect(thumbnail.ok).toBe(true)
    expect(thumbnail.html).toContain('Interactive Tableau chart')
    expect(thumbnail.html).not.toMatch(/<iframe|<script|srcdoc=/)
  })
  it('is byte-identical for the same definition, so one version has one object key', () => {
    const def = structuredDef()
    const first = buildThumbnailDocument({ def })
    const second = buildThumbnailDocument({ def: structuredDef() })
    expect(first.ok).toBe(true)
    expect(second.html).toBe(first.html)
  })

  it('does not depend on the order the theme happened to arrive in', () => {
    // A jsonb column orders keys by length then bytes; an object literal keeps
    // source order. `themeCss` walks Object.entries, so without the sort inside
    // the builder these two produce different stylesheets and therefore two
    // objects for one version.
    const def = legacyDef()
    const forwards = buildThumbnailDocument({
      def,
      theme: { colors: { ink: '#111', primary: '#2f4a7d', surface: '#fff' } },
    })
    const backwards = buildThumbnailDocument({
      def,
      theme: { colors: { surface: '#fff', primary: '#2f4a7d', ink: '#111' } },
    })
    expect(forwards.html).toBe(backwards.html)
  })

  it('carries no preview instrumentation, because it is a picture of the published section', () => {
    const built = buildThumbnailDocument({ def: structuredDef() })
    expect(built.ok).toBe(true)
    expect(built.html).not.toContain('data-cms-')
    expect(built.html).not.toContain('<script')
    // The selection outline the editor draws around a hovered section. A card
    // showing it would be showing the editor to somebody who is not editing.
    expect(built.html).not.toContain('cms-preview')
  })

  it('fetches nothing, so the picture cannot depend on when it was taken', () => {
    const html = buildThumbnailDocument({ def: structuredDef() }).html ?? ''
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toContain('//')
    expect(html).not.toContain('@import')
  })

  it('names every declared region, so an empty definition is still a recognisable card', () => {
    // The whole point of the placeholder rule: nothing has been authored yet, and
    // the card still shows the shape of the section with each region labelled
    // rather than one blank rectangle.
    const html = buildThumbnailDocument({ def: structuredDef() }).html ?? ''
    expect(html).toContain('Eyebrow')
    expect(html).toContain('Supporting copy')
    expect(html).toContain('Call to action')
    expect(html).toContain('Illustration')
  })

  it('derives placeholders from the declarations alone', () => {
    expect(thumbnailPlaceholderValues(structuredDef())).toEqual({
      eyebrow: 'Eyebrow',
      body: '<p>Supporting copy</p>',
      cta: { url: '#', label: 'Call to action' },
      shot: { src: THUMBNAIL_PLACEHOLDER_IMAGE, alt: 'Illustration' },
    })
    // Legacy definitions declare the same thing in a different column, and get
    // the same treatment through the same rule.
    expect(thumbnailPlaceholderValues(legacyDef())).toEqual({
      heading: 'Headline',
      intro: '<p>Supporting copy</p>',
      shot: { src: THUMBNAIL_PLACEHOLDER_IMAGE, alt: 'Screenshot' },
    })
  })

  it('falls back to the field name when a label is blank, and never to nothing', () => {
    const def = legacyDef({
      slots: [{ id: 'heading', kind: 'text', label: '   ', constraints: {} }],
    })
    expect(thumbnailPlaceholderValues(def)).toEqual({ heading: 'heading' })
  })

  it('uses the library theme when the definition belongs to no site', () => {
    // A global definition has no site theme to borrow, and drawing it with every
    // custom property missing is a decision nobody made. This asserts the stated
    // one is the one that ships.
    const html = buildThumbnailDocument({ def: legacyDef() }).html ?? ''
    expect(html).toContain(`--color-primary:${LIBRARY_THEME.colors!['primary']}`)
  })
})

describe('what it refuses to photograph', () => {
  it('refuses a definition whose slug cannot scope a stylesheet', () => {
    const built = buildThumbnailDocument({ def: legacyDef({ slug: 'a,body' }) })
    expect(built.ok).toBe(false)
    expect(built.refusal?.code).toBe('thumbnail-definition-has-no-slug')
    expect(built.refusal?.message).toContain('rename it')
  })

  it('refuses a definition whose stylesheet this build will not emit', () => {
    // The row claims a policy version the renderer does not emit, so a page
    // would drop the section entirely. A card showing it styled would advertise
    // a section nobody can publish.
    const built = buildThumbnailDocument({
      def: legacyDef({ css_policy_version: CSS_POLICY_VERSION - 1 }),
    })
    expect(built.ok).toBe(false)
    expect(built.refusal?.code).toBe('thumbnail-definition-unrenderable')
    expect(built.html).toBeNull()
  })

  it('refuses a structured row whose schema version the renderer does not read', () => {
    const built = buildThumbnailDocument({
      def: structuredDef({ structured_schema_version: STRUCTURED_SCHEMA_VERSION + 1 }),
    })
    expect(built.ok).toBe(false)
    expect(built.refusal?.code).toBe('thumbnail-definition-unrenderable')
  })

  it('refuses a definition_kind nobody here reads, rather than guessing a model', () => {
    const built = buildThumbnailDocument({ def: structuredDef({ definition_kind: 'diagram' }) })
    expect(built.ok).toBe(false)
    expect(built.refusal?.message).toContain('definition_kind')
  })

  it.each(['hide', 'message'] as const)(
    'renders a healthy collection section with %s empty behavior from representative data',
    behavior => {
      const def = structuredDef({
        structured_doc: {
          schemaVersion: STRUCTURED_SCHEMA_VERSION,
          fields: [{ name: 'people', type: 'repeat', label: 'People' }],
          nodes: [
            {
              type: 'repeat',
              field: 'people',
              empty: behavior === 'hide' ? { behavior } : { behavior, text: 'Nobody published yet.' },
              item: [
                {
                  type: 'element',
                  tag: 'article',
                  children: [
                    { type: 'text', field: 'name' },
                    { type: 'richtext', field: 'bio' },
                    { type: 'image', field: 'photo' },
                    { type: 'link', field: 'session_url' },
                  ],
                },
              ],
            },
          ],
        },
      })
      const built = buildThumbnailDocument({ def })
      expect(built.ok).toBe(true)
      expect(built.html?.match(/<article>/g)).toHaveLength(2)
      expect(built.html).toContain('<p>bio</p>')
      expect(built.html).toContain('alt="photo"')
      expect(built.html).toContain('href="https://example.test/library-sample"')
      expect(built.html).toContain('session url</a>')
      expect(built.html).not.toContain('data-cms-slot')
      expect(built.html).not.toContain('<script')
      expect(buildThumbnailDocument({ def })).toEqual(built)
    },
  )

  it('refuses a definition that renders to nothing', () => {
    const built = buildThumbnailDocument({
      def: structuredDef({
        structured_doc: { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields: [], nodes: [] },
      }),
    })
    expect(built.ok).toBe(false)
    expect(built.refusal?.code).toBe('thumbnail-renders-nothing')
  })

  it('carries a code a machine can branch on and a sentence a person can read', () => {
    const built = buildThumbnailDocument({ def: legacyDef({ slug: 'Not A Slug' }) })
    expect(built.refusal?.code).toMatch(/^thumbnail-/)
    expect(built.refusal?.message.length).toBeGreaterThan(30)
  })
})

describe('the screenshotter for a machine with no browser', () => {
  const viewport = { width: 320, height: 200, deviceScaleFactor: 1 }

  it('says it is a placeholder, in the result rather than in a comment', async () => {
    const shot = await createPlaceholderScreenshotter().capture({ html: '<p>x</p>', viewport })
    // The property the worker branches on. A fallback whose output is
    // indistinguishable from a render is how a library fills with grey boxes
    // that everybody believes are sections.
    expect(shot.fidelity).toBe('placeholder')
    expect(shot.fidelity).not.toBe('rendered')
  })

  it('returns a real PNG at the requested size, not zero bytes', async () => {
    const shot = await createPlaceholderScreenshotter().capture({ html: '<p>x</p>', viewport })
    expect([...shot.png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    // IHDR's width and height, at the fixed offset every PNG puts them.
    const header = new DataView(shot.png.buffer, shot.png.byteOffset + 16, 8)
    expect(header.getUint32(0)).toBe(320)
    expect(header.getUint32(4)).toBe(200)
    expect(shot.width).toBe(320)
    expect(shot.height).toBe(200)
  })

  it('honours the device scale factor in the pixels it reports and produces', async () => {
    const shot = await createPlaceholderScreenshotter().capture({
      html: '<p>x</p>',
      viewport: { width: 100, height: 50, deviceScaleFactor: 2 },
    })
    expect([shot.width, shot.height]).toEqual([200, 100])
    const header = new DataView(shot.png.buffer, shot.png.byteOffset + 16, 8)
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([200, 100])
  })

  it('is deterministic, so a content-addressed key over it is stable', async () => {
    const shotter = createPlaceholderScreenshotter()
    const first = await shotter.capture({ html: '<p>x</p>', viewport })
    const second = await shotter.capture({ html: '<p>x</p>', viewport })
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    expect(digest(second.png)).toBe(digest(first.png))
  })

  it('reads its input, so "ran twice" and "ignores the document" are distinguishable', async () => {
    const shotter = createPlaceholderScreenshotter()
    const one = await shotter.capture({ html: '<p>one</p>', viewport })
    const two = await shotter.capture({ html: '<p>two</p>', viewport })
    expect(Buffer.from(two.png).equals(Buffer.from(one.png))).toBe(false)
  })
})

describe('a card drawn with the section’s own content, fonts and pictures', () => {
  // SPEC §6.5 and V1 references 18/19: faithful, branded library cards. A
  // definition that carries its source's words as starting content is drawn
  // with them; labels remain the fallback for a field with none.
  it('uses a definition’s source samples before its field names', () => {
    const def = legacyDef({
      slots: [
        { id: 'heading', kind: 'text', label: 'Headline', constraints: { sourceSample: 'Echelon Symposium' } },
        { id: 'intro', kind: 'richtext', label: 'Supporting copy', constraints: {} },
        {
          id: 'shot',
          kind: 'image',
          label: 'Screenshot',
          constraints: { sourceSample: { src: '/media/9cb8478b-1790-4826-a79f-946ad9d46805/original', alt: 'Hall' } },
        },
      ],
    })
    expect(thumbnailPlaceholderValues(def)).toEqual({
      heading: 'Echelon Symposium',
      intro: '<p>Supporting copy</p>',
      shot: { src: '/media/9cb8478b-1790-4826-a79f-946ad9d46805/original', alt: 'Hall', decorative: false },
    })
  })

  it('draws a site layout with the words a page gives it, below its own samples and only for its own fields', () => {
    const def = legacyDef({
      slots: [
        { id: 'heading', kind: 'text', label: 'Headline', constraints: {} },
        {
          id: 'intro',
          kind: 'richtext',
          label: 'Supporting copy',
          constraints: { sourceSample: '<p>Starting copy</p>' },
        },
        { id: 'shot', kind: 'image', label: 'Screenshot', constraints: {} },
      ],
    })
    const html =
      buildThumbnailDocument({
        def,
        values: { heading: 'Echelon Symposium', intro: '<p>Page copy</p>', stray: 'Not a field', shot: '' },
      }).html ?? ''
    expect(html).toContain('Echelon Symposium')
    expect(html).toContain('Starting copy')
    expect(html).not.toContain('Page copy')
    expect(html).not.toContain('Not a field')
  })

  it('sets the card in the site’s registered fonts', () => {
    const html =
      buildThumbnailDocument({
        def: legacyDef(),
        fonts: [{ assetId: '58c8cac6-b0be-4e6b-ab86-7590154c2e86', fontKey: 'trajan-regular' }],
      }).html ?? ''
    expect(html).toContain(
      "@font-face{font-family:'Trajan Pro 3';src:url('/assets/58c8cac6-b0be-4e6b-ab86-7590154c2e86')",
    )
    // Anything that is not a registered font is ignored whole.
    expect(
      buildThumbnailDocument({ def: legacyDef(), fonts: [{ assetId: 'x', fontKey: 'comic' }] }).html,
    ).not.toContain('@font-face')
  })

  it('embeds the pictures and fonts it was given, and leaves the rest standing in', () => {
    const photo = '9cb8478b-1790-4826-a79f-946ad9d46805',
      missing = '7a9932e3-ca0f-4f48-a8d8-1899d11882e6',
      font = '58c8cac6-b0be-4e6b-ab86-7590154c2e86'
    const html =
      `<style>@font-face{src:url('/assets/${font}')}.x{background:url(/media/${photo}/wide)}</style>` +
      `<img src="/media/${photo}/original"><img src="/media/${missing}/card"><a href="/media/${photo}/original/extra">x</a>`
    expect(thumbnailMediaIds(html)).toEqual([missing, photo])
    const embedded = embedThumbnailFiles(html, {
      media: new Map([[photo, { mimeType: 'image/webp', bytes: new Uint8Array([1, 2]) }]]),
      assets: new Map([[font, { mimeType: 'font/otf', bytes: new Uint8Array([3]) }]]),
    })
    expect(embedded).toBe(
      `<style>@font-face{src:url('data:font/otf;base64,Aw==')}.x{background:url(data:image/webp;base64,AQI=)}</style>` +
        `<img src="data:image/webp;base64,AQI="><img src="/media/${missing}/card"><a href="/media/${photo}/original/extra">x</a>`,
    )
    // Only image and font types are embedded.
    expect(
      embedThumbnailFiles(`<img src="/media/${photo}/card">`, {
        media: new Map([[photo, { mimeType: 'text/html', bytes: new Uint8Array([1]) }]]),
        assets: new Map(),
      }),
    ).toBe(`<img src="/media/${photo}/card">`)
  })
})
