import { describe, expect, it } from 'vitest'
import {
  PageContent,
  STRUCTURED_SCHEMA_VERSION,
  upgradeStructuredDocument,
  type StructuredDocument,
  type StructuredNode,
} from '@cms/schema'
import { renderSection, type ManifestSection, type SectionDefView } from '@cms/renderer'
import {
  SEED_SECTION_DEFS,
  compileSeedSection,
  demoHomeContent,
  demoTheme,
  seedSectionDefView,
  upsertArguments,
} from './index.ts'

const defIds = Object.fromEntries(SEED_SECTION_DEFS.map(d => [d.slug, `def-${d.slug}`]))
const bySlug = (slug: string) => SEED_SECTION_DEFS.find(d => d.slug === slug)!

describe('every seed section definition compiles cleanly', () => {
  it.each(SEED_SECTION_DEFS.map(d => [d.slug, d] as const))('%s has no compile problems', (_slug, def) => {
    const result = compileSeedSection(def)
    expect(result.problems).toEqual([])
    expect(result.carriesTrustedCode).toBe(false)
  })

  it('covers the slot and field behaviours the renderer actually distinguishes', () => {
    const kinds = new Set(
      SEED_SECTION_DEFS.flatMap(def =>
        def.kind === 'legacy' ? def.slots.map(s => s.kind) : def.fields.map(f => f.type),
      ),
    )
    expect(kinds).toContain('text')
    expect(kinds).toContain('richtext')
    expect(kinds).toContain('button')
    // The two whose stored value is an object rather than a string, which is
    // what makes them the two the editor cannot patch into the canvas as text.
    expect(kinds).toContain('link')
    expect(kinds).toContain('image')
  })

  it('scopes its CSS to its own section class', () => {
    for (const def of SEED_SECTION_DEFS) {
      const { compiledCss } = compileSeedSection(def)
      if (compiledCss === '') continue
      expect(compiledCss.startsWith(`.cms-section--${def.slug}`)).toBe(true)
    }
  })
})

describe('the two section models coexist in one seed', () => {
  it('carries definitions of both kinds', () => {
    const kinds = new Set(SEED_SECTION_DEFS.map(d => compileSeedSection(d).definitionKind))
    expect(kinds).toEqual(new Set(['legacy', 'structured']))
  })

  it('renders both kinds on the seeded home page, so coexistence is a property and not a claim', () => {
    const placed = demoHomeContent(defIds).map(
      instance =>
        compileSeedSection(SEED_SECTION_DEFS.find(d => `def-${d.slug}` === instance.section_def_id)!).definitionKind,
    )
    expect(new Set(placed)).toEqual(new Set(['legacy', 'structured']))
  })

  it('gives a structured definition an empty compiled template and a legacy one no document', () => {
    // Migration 0019 makes both of these a CHECK constraint. Asserted here too
    // because the seed is what the constraint is first asked about, and a
    // failure at `pnpm db:seed` names the database rather than the seed.
    for (const def of SEED_SECTION_DEFS) {
      const compiled = compileSeedSection(def)
      if (compiled.definitionKind === 'structured') {
        expect(compiled.compiledAst.nodes, def.slug).toEqual([])
        expect(compiled.structuredSchemaVersion, def.slug).toBe(STRUCTURED_SCHEMA_VERSION)
      } else {
        expect(compiled.structuredDoc, def.slug).toBeNull()
        expect(compiled.structuredSchemaVersion, def.slug).toBeNull()
      }
    }
  })

  it('sends the discriminator to the database with every definition', () => {
    for (const def of SEED_SECTION_DEFS) {
      const args = upsertArguments(def)
      expect(args, def.slug).toHaveLength(16)
      expect(args[13], def.slug).toBe(compileSeedSection(def).definitionKind)
    }
  })
})

describe('the seed home page', () => {
  const content = demoHomeContent(defIds)

  it('passes the shared content schema', () => {
    expect(() => PageContent.parse(content)).not.toThrow()
  })

  it('places hero, prose and call to action, in order', () => {
    expect(content.map(s => s.section_def_id)).toEqual(['def-hero', 'def-prose', 'def-cta'])
  })

  it('renders a real h1 out of a structured definition', () => {
    const section: ManifestSection = {
      instance: content[0]!,
      def: seedSectionDefView(bySlug('hero')),
    }
    expect(renderSection(section, 0)).toContain('<h1>A page served by cms-v2</h1>')
  })

  it('keeps the allowed formatting in its rich text and nothing else', () => {
    const html = renderSection({ instance: content[1]!, def: seedSectionDefView(bySlug('prose')) }, 1)
    expect(html).toContain('<strong>immutable definition version</strong>')
    expect(html).not.toContain('<script')
  })

  it('still renders the definition left on the interpolation path', () => {
    const html = renderSection({ instance: content[2]!, def: seedSectionDefView(bySlug('cta')) }, 2)
    expect(html).toContain('<a href="/">Open the editor</a>')
  })
})

describe('the V1 pull quote, converted node for node', () => {
  const quote = bySlug('quote')

  it('keeps V1’s block ids as its field names, so the conversion can be read against the original', () => {
    expect(compileSeedSection(quote).slots.map(s => s.id)).toEqual(['quote-text', 'quote-name', 'quote-role'])
  })

  it('renders the figure, the blockquote and the caption V1 renders', () => {
    const html = renderSection(
      {
        instance: {
          section_def_id: 'def-quote',
          section_def_version: 1,
          values: {
            'quote-text': '<p>One strong sentence.</p>',
            'quote-name': 'Firstname Lastname',
            'quote-role': 'Title, Organization',
          },
        },
        def: seedSectionDefView(quote),
      },
      0,
    )

    expect(html).toContain('<figure class="cms-section-quote__figure">')
    expect(html).toContain('<blockquote class="cms-section-quote__text"><p>One strong sentence.</p></blockquote>')
    expect(html).toContain('<span class="cms-section-quote__name">Firstname Lastname</span>')
  })

  it('depends on no icon sprite, no form, no iframe and no interaction-preset class', () => {
    // The four dependencies ADR 0007 says an import must not silently lose. A
    // definition that needs `INTERACTION_PRESET_CSS` renders markup that parses
    // and looks wrong, which is the failure mode the importer exists to refuse.
    const compiled = compileSeedSection(quote)
    const everything = JSON.stringify(compiled.structuredDoc) + compiled.compiledCss
    for (const marker of ['icon', 'fx-', 'cms-cta', 'iframe', 'form']) {
      expect(everything, marker).not.toContain(marker)
    }
  })
})

describe('every seed renders under schema v2 exactly what it rendered under schema v1', () => {
  // The whole promise of ADR 0008's version bump is that nothing already stored
  // changes what it puts on a page. A promise about bytes has to be asserted in
  // bytes, so the strings below were recorded from this repository at commit
  // 718e8d0 — the last commit before schema v2 — and pasted in. Re-deriving them
  // from the current renderer would produce a test that agrees with whatever the
  // current renderer happens to do, which is the failure mode of every golden
  // test that was ever written by running the code and blessing the output.
  const VALUES: Record<string, Record<string, unknown>> = {
    hero: { heading: 'A page served by cms-v2', intro: 'This HTML left the server complete.' },
    prose: { title: 'What you are looking at', body: '<p>Some <strong>copy</strong>.</p>' },
    cta: { heading: 'Edit this page in the admin', action: { url: '/', label: 'Open the editor' } },
    feature: {
      picture: { src: '/a.png', alt: 'A photograph' },
      more: { url: 'https://example.test/a', label: 'Read more' },
    },
    quote: {
      'quote-text': '<p>One strong sentence.</p>',
      'quote-name': 'Firstname Lastname',
      'quote-role': 'Title, Organization',
    },
  }

  const V1_PUBLIC: Record<string, string> = {
    hero:
      '<div id="s0" class="cms-section cms-section--hero"><section class="hero">' +
      '<h1>A page served by cms-v2</h1><p class="lede">This HTML left the server complete.</p></section></div>',
    prose:
      '<div id="s0" class="cms-section cms-section--prose"><section class="prose">' +
      '<h2>What you are looking at</h2><div class="body"><p>Some <strong>copy</strong>.</p></div></section></div>',
    cta:
      '<div id="s0" class="cms-section cms-section--cta"><section class="cta">' +
      '<h2>Edit this page in the admin</h2><p class="cta-action"><a href="/">Open the editor</a></p></section></div>',
    feature:
      '<div id="s0" class="cms-section cms-section--feature"><section class="feature">' +
      '<div class="feature-media"><img src="/a.png" alt="A photograph"></div>' +
      '<p class="feature-action"><a href="https://example.test/a" rel="noopener">Read more</a></p></section></div>',
    quote:
      '<div id="s0" class="cms-section cms-section--quote"><section class="cms-section-quote">' +
      '<figure class="cms-section-quote__figure">' +
      '<blockquote class="cms-section-quote__text"><p>One strong sentence.</p></blockquote>' +
      '<figcaption class="cms-section-quote__caption">' +
      '<span class="cms-section-quote__name">Firstname Lastname</span>' +
      '<span class="cms-section-quote__role">Title, Organization</span>' +
      '</figcaption></figure></section></div>',
  }

  const V1_PREVIEW: Record<string, string> = {
    hero:
      '<div id="s0" class="cms-section cms-section--hero" data-cms-section="0" data-cms-def="def-hero" ' +
      'data-cms-label="hero"><section class="hero"><h1><span data-cms-slot="heading" data-cms-kind="text">' +
      'A page served by cms-v2</span></h1><p class="lede"><span data-cms-slot="intro" data-cms-kind="text">' +
      'This HTML left the server complete.</span></p></section></div>',
    prose:
      '<div id="s0" class="cms-section cms-section--prose" data-cms-section="0" data-cms-def="def-prose" ' +
      'data-cms-label="prose"><section class="prose"><h2><span data-cms-slot="title" data-cms-kind="text">' +
      'What you are looking at</span></h2><div class="body"><span data-cms-slot="body" data-cms-kind="richtext">' +
      '<p>Some <strong>copy</strong>.</p></span></div></section></div>',
    cta:
      '<div id="s0" class="cms-section cms-section--cta" data-cms-section="0" data-cms-def="def-cta" ' +
      'data-cms-label="cta"><section class="cta"><h2><span data-cms-slot="heading" data-cms-kind="text">' +
      'Edit this page in the admin</span></h2><p class="cta-action">' +
      '<span data-cms-slot="action" data-cms-kind="button"><a href="/">Open the editor</a></span></p></section></div>',
    feature:
      '<div id="s0" class="cms-section cms-section--feature" data-cms-section="0" data-cms-def="def-feature" ' +
      'data-cms-label="feature"><section class="feature"><div class="feature-media">' +
      '<span data-cms-slot="picture" data-cms-kind="image"><img src="/a.png" alt="A photograph"></span></div>' +
      '<p class="feature-action"><span data-cms-slot="more" data-cms-kind="link">' +
      '<a href="https://example.test/a" rel="noopener">Read more</a></span></p></section></div>',
    quote:
      '<div id="s0" class="cms-section cms-section--quote" data-cms-section="0" data-cms-def="def-quote" ' +
      'data-cms-label="quote"><section class="cms-section-quote"><figure class="cms-section-quote__figure">' +
      '<blockquote class="cms-section-quote__text"><span data-cms-slot="quote-text" data-cms-kind="richtext">' +
      '<p>One strong sentence.</p></span></blockquote><figcaption class="cms-section-quote__caption">' +
      '<span class="cms-section-quote__name"><span data-cms-slot="quote-name" data-cms-kind="text">' +
      'Firstname Lastname</span></span><span class="cms-section-quote__role">' +
      '<span data-cms-slot="quote-role" data-cms-kind="text">Title, Organization</span></span>' +
      '</figcaption></figure></section></div>',
  }

  /**
   * The seed's document as schema v1 could have written it, carried back to the
   * current version by the upgrade a stored row will go through.
   *
   * Removing `staticAttributes` is what makes this a v1 document: v2 differs
   * from v1 by nothing else. Running the result through
   * `upgradeStructuredDocument` rather than simply re-stamping the version is
   * the point of the helper — it exercises the migration's own transformation
   * against real documents rather than against a fixture written to suit it.
   */
  function asWrittenUnderV1(document: StructuredDocument): StructuredDocument {
    const strip = (node: StructuredNode): StructuredNode => {
      if (node.type === 'element') {
        return node.children === undefined ? node : { ...node, children: node.children.map(strip) }
      }
      const v1 = { ...node } as Record<string, unknown>
      delete v1['staticAttributes']
      return v1 as unknown as StructuredNode
    }
    const upgraded = upgradeStructuredDocument({
      ...document,
      schemaVersion: 1,
      nodes: document.nodes.map(strip),
    })
    if (upgraded === null) throw new Error('this seed cannot be expressed as a schema v1 document')
    return upgraded
  }

  it.each(SEED_SECTION_DEFS.filter(def => def.slug in V1_PUBLIC).map(def => [def.slug] as const))(
    '%s preserves public bytes and preview content across the schema upgrade',
    slug => {
      const view = seedSectionDefView(bySlug(slug))
      const document = view.structured_doc
      const asV1: SectionDefView =
        document === null || document === undefined
          ? view
          : { ...view, structured_doc: asWrittenUnderV1(document as StructuredDocument) }
      const section = {
        def: asV1,
        instance: { section_def_id: `def-${slug}`, section_def_version: 1, values: VALUES[slug]! },
      } as ManifestSection

      expect(renderSection(section, 0)).toBe(V1_PUBLIC[slug])
      // Retain the recorded historical golden. Only the internal editing tag
      // changed to avoid matching authored span selectors; its attributes,
      // content and all authored elements still obey the byte-level contract.
      const preview = renderSection(section, 0, { preview: true })
        .replace(/<cms-slot /g, '<span ')
        .replace(/<\/cms-slot>/g, '</span>')
      expect(preview).toBe(V1_PREVIEW[slug])
    },
  )

  it('exempts from the v1 byte promise only seeds v1 could not express at all', () => {
    // A seed without a recorded golden must be one whose document schema v1
    // had no grammar for — today, a collection repeat. Anything else missing
    // from V1_PUBLIC is a seed dodging the parity promise, not a new schema.
    const exempt = SEED_SECTION_DEFS.filter(def => !(def.slug in V1_PUBLIC))
    expect(exempt.map(def => def.slug)).toEqual(['speakers-listing'])
    for (const def of exempt) {
      expect(def.kind === 'structured' && def.fields.some(field => field.type === 'repeat')).toBe(true)
    }
  })

  it('changes only the definition that asked for the new attributes', () => {
    // The counterpart the byte-for-byte test needs: a suite where nothing
    // changed would pass all of the above and prove that the feature does
    // nothing. The class, the reserved box and the loading hints are what the
    // V1 inventory found on 85 of 86 image field elements, and `noopener` is
    // there because the target is `_blank` rather than because the definition
    // remembered to ask.
    const section = {
      def: seedSectionDefView(bySlug('feature')),
      instance: { section_def_id: 'def-feature', section_def_version: 1, values: VALUES['feature']! },
    } as ManifestSection
    expect(renderSection(section, 0)).toBe(
      '<div id="s0" class="cms-section cms-section--feature"><section class="feature">' +
        '<div class="feature-media"><img src="/a.png" alt="A photograph" class="feature-image" ' +
        'width="960" height="540" decoding="async" loading="lazy"></div>' +
        '<p class="feature-action"><a href="https://example.test/a" class="feature-link" ' +
        'rel="noopener noreferrer" target="_blank">Read more</a></p></section></div>',
    )
  })

  it('styles the image through the class the definition put on the image', () => {
    // Not on a wrapper. The inventory calls some V1 classes "wrapper-capable",
    // and moving one would change which selectors match — so the definition's
    // stylesheet names the class the image itself carries, and the two can be
    // read against each other.
    const compiled = compileSeedSection(bySlug('feature'))
    expect(compiled.compiledCss).toContain('.cms-section--feature .feature-image')
    expect(compiled.compiledCss).not.toContain('.feature-media img')
  })
})

describe('the seed theme respects the no-CDN constraint', () => {
  it('uses device-native font stacks', () => {
    expect(demoTheme.fonts.body).not.toMatch(/https?:/)
    expect(demoTheme.fonts.heading).not.toMatch(/https?:/)
  })
})
