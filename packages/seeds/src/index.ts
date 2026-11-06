// Fixtures every environment shares: local dev, CI, the database policy tests,
// and the e2e specs (SPEC §3.1). Everything here is schema-valid and
// compiler-clean by construction — a seed that drifts from the schema or the
// renderer fails in this package's tests, not in a running app.
//
// Since ADR 0007 the seed carries both section models at once, on purpose. The
// two are meant to coexist for as long as the V1 catalogue takes to import, and
// "they coexist" is a claim that is only worth anything if the page everybody
// looks at every day is actually rendering one of each.
import {
  PageContent,
  SlotDef,
  STRUCTURED_SCHEMA_VERSION,
  StructuredDocument,
  ThemeTokens,
  ICON_PRESENTATION,
  structuredFieldNodes,
  type NavTree,
  type SectionInstance,
  type StructuredFieldDef,
  type StructuredNode,
  type StructuredTag,
} from '@cms/schema'
import {
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  compileSection,
  compileStructuredSection,
  sectionScopeSelector,
  type CompiledSection,
  type SectionDefView,
} from '@cms/renderer'

/** A definition authored as markup with `{{slot}}` tokens in it (SPEC §6.5). */
export type LegacySeedSectionDef = {
  kind: 'legacy'
  slug: string
  name: string
  category: string
  sourceHtml: string
  sourceCss: string
  slots: SlotDef[]
  changelog: string
}

/** A definition authored as a document of typed nodes (ADR 0007). */
export type StructuredSeedSectionDef = {
  kind: 'structured'
  slug: string
  name: string
  category: string
  sourceCss: string
  fields: StructuredFieldDef[]
  nodes: StructuredNode[]
  changelog: string
}

export type SeedSectionDef = LegacySeedSectionDef | StructuredSeedSectionDef

function slots(...defs: { id: string; kind: SlotDef['kind']; label: string }[]): SlotDef[] {
  return defs.map(slot => SlotDef.parse({ ...slot, constraints: {} }))
}

const element = (
  tag: StructuredTag,
  attributes: Record<string, string>,
  children: StructuredNode[],
): StructuredNode => ({ type: 'element', tag, attributes, children })

/**
 * Five definitions: four structured, one still on the interpolation path.
 *
 * `cta` is the one left behind, and deliberately. Its editable value is a
 * `button` slot, and ADR 0007's field vocabulary — text, richtext, link, image,
 * icon, repeat — has no `button` in it. Re-typing it as `link` would render the
 * identical anchor and would quietly change what the editor offers an author, so
 * the honest move is to leave the definition where it is until the importer
 * decides what a button is. That it also keeps a legacy definition on the
 * seeded, published page is the point: coexistence that nothing renders is a
 * claim, not a property.
 */
export const SEED_SECTION_DEFS: SeedSectionDef[] = [
  {
    kind: 'structured',
    slug: 'speakers-listing',
    name: 'Speakers listing',
    category: 'Collections',
    sourceCss:
      '.speakers-listing{padding:clamp(2.5rem,6vw,5rem) 1.5rem;max-width:72rem;margin:0 auto}' +
      '.speakers-listing__title{text-align:center;margin:0 0 2rem}' +
      '.speakers-listing__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1.25rem}' +
      '.speaker-card{padding:1.25rem;border:1px solid rgba(0,0,0,.12);border-radius:var(--radius,.5rem)}' +
      '.speaker-card__photo{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius,.5rem)}' +
      '.speaker-card__name{margin:.9rem 0 .2rem}.speaker-card__role{margin:0 0 .75rem;color:var(--color-primary,#003087);font-weight:600}',
    fields: [
      { name: 'heading', type: 'text', label: 'Heading' },
      { name: 'speakers', type: 'repeat', label: 'Speakers' },
    ],
    nodes: [
      element('section', { class: 'speakers-listing' }, [
        element('h2', { class: 'speakers-listing__title' }, [{ type: 'text', field: 'heading' }]),
        element('div', { class: 'speakers-listing__grid' }, [
          {
            type: 'repeat',
            field: 'speakers',
            empty: { behavior: 'message', text: 'No speakers are published yet.' },
            item: [
              element('article', { class: 'speaker-card' }, [
                {
                  type: 'image',
                  field: 'photo',
                  staticAttributes: {
                    class: ['speaker-card__photo'],
                    width: 960,
                    height: 720,
                    loading: 'lazy',
                    decoding: 'async',
                  },
                },
                element('h3', { class: 'speaker-card__name' }, [{ type: 'text', field: 'name' }]),
                element('p', { class: 'speaker-card__role' }, [{ type: 'text', field: 'role' }]),
                element('div', { class: 'speaker-card__bio' }, [{ type: 'richtext', field: 'bio' }]),
              ]),
            ],
          },
        ]),
      ]),
    ],
    changelog: 'A collection-backed speakers listing using structured schema v3.',
  },
  {
    kind: 'structured',
    slug: 'hero',
    name: 'Hero',
    category: 'Openers',
    sourceCss:
      '.hero{padding:4rem 1.5rem;text-align:center;background:var(--color-surface,#fff)}' +
      '.lede{font-size:1.125rem;max-width:38rem;margin:1rem auto;color:var(--color-ink,#333)}',
    fields: [
      { name: 'heading', type: 'text', label: 'Heading' },
      { name: 'intro', type: 'text', label: 'Intro' },
    ],
    nodes: [
      element('section', { class: 'hero' }, [
        element('h1', {}, [{ type: 'text', field: 'heading' }]),
        element('p', { class: 'lede' }, [{ type: 'text', field: 'intro' }]),
      ]),
    ],
    changelog: 'Hero, as a structured definition.',
  },
  {
    kind: 'structured',
    slug: 'prose',
    name: 'Text block',
    category: 'Content',
    sourceCss: '.prose{padding:2rem 1.5rem;max-width:42rem;margin:0 auto}.body{line-height:1.7}',
    fields: [
      { name: 'title', type: 'text', label: 'Title' },
      { name: 'body', type: 'richtext', label: 'Body' },
    ],
    nodes: [
      element('section', { class: 'prose' }, [
        element('h2', {}, [{ type: 'text', field: 'title' }]),
        element('div', { class: 'body' }, [{ type: 'richtext', field: 'body' }]),
      ]),
    ],
    changelog: 'Text block, as a structured definition.',
  },
  {
    kind: 'legacy',
    slug: 'cta',
    name: 'Call to action',
    category: 'Actions',
    sourceHtml: '<section class="cta"><h2>{{heading}}</h2><p class="cta-action">{{action}}</p></section>',
    sourceCss:
      '.cta{padding:3rem 1.5rem;text-align:center;background:var(--color-primary,#003087);' +
      'color:var(--color-primaryContrast,#fff);--button-bg:var(--color-primaryContrast,#fff);' +
      '--button-ink:var(--color-primary,#003087)}.cta .cms-button{margin-top:.35rem}',
    slots: slots({ id: 'heading', kind: 'text', label: 'Heading' }, { id: 'action', kind: 'button', label: 'Button' }),
    changelog: 'Initial call to action.',
  },
  {
    /**
     * The two field types nothing else here declares, and the only two that can
     * carry static attributes.
     *
     * ADR 0007's vocabulary has four implemented types and the seed covered
     * two of them, so `link` and `image` were shipped code that every
     * environment carried and nothing ever exercised — including the two
     * inspector controls that are the only way an author reaches them, and the
     * only two whose stored value is an object rather than a string.
     *
     * Since schema v2 (ADR 0008) it is also the only seed that exercises
     * definition-owned attributes, and it does it the way the V1 catalogue
     * actually writes them: the image carries the class that styles it and the
     * width and height that reserve its box, and the link carries the class that
     * makes it look like a link and the browsing context it opens in. The
     * `noopener` on the emitted anchor is not in this document, and that is the
     * point — the renderer adds it because the target is `_blank`, so a
     * definition author cannot forget it.
     *
     * Deliberately not on the seeded home page. The editor's end-to-end specs
     * index into that page by position, and this is a definition to add from
     * the library rather than a fourth section to count around.
     */
    kind: 'structured',
    slug: 'feature',
    name: 'Feature card',
    category: 'Content',
    // `.feature-image` rather than `.feature-media img`: the class is on the
    // element the definition wrote it on, which is what makes the selector and
    // the markup reviewable against each other. Moving a class to a wrapper
    // changes which selectors match, and ADR 0008 refuses to do that without a
    // proof of equivalence nobody has.
    sourceCss:
      '.feature{padding:2rem 1.5rem;max-width:42rem;margin:0 auto;text-align:center}' +
      '.feature-image{max-width:100%;height:auto;border-radius:var(--radius,0.5rem)}' +
      '.feature-action{margin-top:1rem}' +
      '.feature-link{display:inline-block;font-weight:600;text-decoration:underline}',
    fields: [
      { name: 'picture', type: 'image', label: 'Picture' },
      { name: 'more', type: 'link', label: 'Link' },
    ],
    nodes: [
      element('section', { class: 'feature' }, [
        element('div', { class: 'feature-media' }, [
          {
            type: 'image',
            field: 'picture',
            staticAttributes: {
              class: ['feature-image'],
              width: 960,
              height: 540,
              decoding: 'async',
              loading: 'lazy',
            },
          },
        ]),
        element('p', { class: 'feature-action' }, [
          {
            type: 'link',
            field: 'more',
            staticAttributes: { class: ['feature-link'], rel: ['noreferrer'], target: '_blank' },
          },
        ]),
      ]),
    ],
    changelog: 'A picture and a link, as a structured definition.',
  },
  {
    // `quote-v1` from the V1 catalogue (docs/v1-inventory), converted node for
    // node. Chosen because it is one of the 78 definitions shared by all three
    // sites and one of the few that depends on nothing this slice cannot
    // express: no form, no iframe, no icon, no repeated unit, and none of the 25
    // `fx-` classes that live in V1's `INTERACTION_PRESET_CSS` rather than in
    // the definition. Its class names and block ids are V1's, unchanged, so the
    // conversion can be read against the original.
    kind: 'structured',
    slug: 'quote',
    name: 'Pull quote',
    category: 'Content',
    sourceCss:
      '.cms-section-quote{padding:clamp(2.5rem,7vw,5rem) 1rem;background:var(--color-surface,#fff);' +
      'color:var(--color-ink,#1a1a1a);font-family:var(--font-body,inherit)}' +
      '.cms-section-quote__figure{max-width:44rem;margin:0 auto;text-align:center}' +
      '.cms-section-quote__text{margin:0;font-family:var(--font-heading,inherit);' +
      'font-size:clamp(1.4rem,3.4vw,2.1rem);line-height:1.35}' +
      '.cms-section-quote__text p{margin:0}' +
      '.cms-section-quote__caption{margin-top:1.5rem;display:flex;flex-direction:column;gap:0.15rem}' +
      '.cms-section-quote__name{font-weight:700;color:var(--color-primary,#003087)}' +
      '.cms-section-quote__role{font-size:0.85rem}',
    fields: [
      { name: 'quote-text', type: 'richtext', label: 'Quote' },
      { name: 'quote-name', type: 'text', label: 'Name' },
      { name: 'quote-role', type: 'text', label: 'Title, organization' },
    ],
    nodes: [
      element('section', { class: 'cms-section-quote' }, [
        element('figure', { class: 'cms-section-quote__figure' }, [
          element('blockquote', { class: 'cms-section-quote__text' }, [{ type: 'richtext', field: 'quote-text' }]),
          element('figcaption', { class: 'cms-section-quote__caption' }, [
            element('span', { class: 'cms-section-quote__name' }, [{ type: 'text', field: 'quote-name' }]),
            element('span', { class: 'cms-section-quote__role' }, [{ type: 'text', field: 'quote-role' }]),
          ]),
        ]),
      ]),
    ],
    changelog: 'Imported from the V1 catalogue as a structured definition.',
  },
]

/**
 * A structured definition's fields, in the shape the editor already reads.
 *
 * The admin inspector and the library overlay both build their field lists from
 * `section_def_versions.slots`, and the four structured field types are four of
 * the six slot kinds — so a structured definition can describe its editable
 * surface in the existing vocabulary rather than making the editor learn a
 * second one for the same four things.
 */
export function slotsForFields(
  fields: readonly StructuredFieldDef[],
  nodes: readonly StructuredNode[] = [],
): SlotDef[] {
  const icons = new Set(
    structuredFieldNodes(nodes)
      .filter(node => node.type === 'icon')
      .map(node => node.field),
  )
  return fields.map(field =>
    SlotDef.parse({
      id: field.name,
      kind: field.type,
      label: field.label,
      constraints: icons.has(field.name) ? { presentation: ICON_PRESENTATION } : {},
    }),
  )
}

/**
 * The empty compiled AST a structured version stores.
 *
 * `section_def_versions.compiled_ast` is NOT NULL and every existing gate reads
 * it, so a structured row stores the one artifact that means "there is no
 * interpolated template here". Migration 0019 makes that a CHECK constraint
 * rather than a habit: a structured row whose AST had nodes in it would be a row
 * two renderers could both find something to do with.
 */
export const NO_COMPILED_TEMPLATE: CompiledSection = {
  nodes: [],
  policyVersion: SANITIZER_POLICY_VERSION,
  cssPolicyVersion: CSS_POLICY_VERSION,
}

export type SeedCompiled = {
  /** Everything a stored version needs, whichever model it is written in. */
  slug: string
  definitionKind: 'legacy' | 'structured'
  sourceHtml: string
  sourceCss: string
  compiledCss: string
  compiledAst: CompiledSection
  slots: SlotDef[]
  structuredDoc: StructuredDocument | null
  structuredSchemaVersion: number | null
  renderHash: string
  carriesTrustedCode: boolean
  problems: string[]
}

/**
 * Compile one seed definition through the compiler its own model uses.
 *
 * One function for both kinds, so `pnpm db:seed` never has to ask which it is
 * holding — the discriminator travels with the row from here all the way to the
 * renderer, and nothing in between infers it.
 */
export function compileSeedSection(def: SeedSectionDef): SeedCompiled {
  if (def.kind === 'legacy') {
    const compiled = compileSection({
      sourceHtml: def.sourceHtml,
      sourceCss: def.sourceCss,
      slots: def.slots,
      scopeSelector: sectionScopeSelector(def.slug) ?? undefined,
    })
    return {
      slug: def.slug,
      definitionKind: 'legacy',
      sourceHtml: def.sourceHtml,
      sourceCss: def.sourceCss,
      compiledCss: compiled.css,
      compiledAst: compiled.ast,
      slots: def.slots,
      structuredDoc: null,
      structuredSchemaVersion: null,
      renderHash: compiled.renderHash,
      carriesTrustedCode: compiled.carriesTrustedCode,
      problems: compiled.problems,
    }
  }

  const document = StructuredDocument.parse({
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: def.fields,
    nodes: def.nodes,
  })
  const compiled = compileStructuredSection({
    slug: def.slug,
    document,
    sourceCss: def.sourceCss,
  })
  return {
    slug: def.slug,
    definitionKind: 'structured',
    // A structured definition has no authored HTML. Storing the serialized
    // output here instead would invent a source nobody wrote and hand the
    // revalidation CLI something it would try to recompile.
    sourceHtml: '',
    sourceCss: def.sourceCss,
    compiledCss: compiled.css,
    compiledAst: NO_COMPILED_TEMPLATE,
    slots: slotsForFields(def.fields, compiled.document.nodes),
    structuredDoc: compiled.document,
    structuredSchemaVersion: STRUCTURED_SCHEMA_VERSION,
    renderHash: compiled.renderHash,
    carriesTrustedCode: false,
    problems: compiled.problems,
  }
}

/**
 * A seed definition as the renderer receives it from a manifest.
 *
 * Built from the same compile step the database is fed, so a test that renders a
 * seed is rendering the artifacts that were stored rather than a second
 * assembly of the same fields that could disagree with them.
 */
export function seedSectionDefView(def: SeedSectionDef, id = `def-${def.slug}`, version = 1): SectionDefView {
  const compiled = compileSeedSection(def)
  return {
    section_def_id: id,
    version,
    slug: def.slug,
    compiled_ast: compiled.compiledAst,
    css: compiled.compiledCss,
    css_policy_version: CSS_POLICY_VERSION,
    sanitizer_policy_version: SANITIZER_POLICY_VERSION,
    slots: compiled.slots,
    definition_kind: compiled.definitionKind,
    structured_doc: compiled.structuredDoc,
    structured_schema_version: compiled.structuredSchemaVersion,
  }
}

/** The positional arguments `app.upsert_section_def_version` takes, in order. */
export function upsertArguments(def: SeedSectionDef): unknown[] {
  const compiled = compileSeedSection(def)
  return [
    def.slug,
    def.name,
    def.category,
    compiled.sourceHtml,
    compiled.sourceCss,
    compiled.compiledCss,
    JSON.stringify(compiled.compiledAst),
    JSON.stringify(compiled.slots),
    compiled.renderHash,
    compiled.compiledAst.policyVersion,
    compiled.compiledAst.cssPolicyVersion,
    def.changelog,
    compiled.carriesTrustedCode,
    compiled.definitionKind,
    compiled.structuredDoc === null ? null : JSON.stringify(compiled.structuredDoc),
    compiled.structuredSchemaVersion,
  ]
}

export const demoTheme = ThemeTokens.parse({
  colors: {
    primary: '#1f4e79',
    accent: '#b5462b',
    surface: '#ffffff',
    ink: '#1a1a1a',
  },
  // Device-native stacks: the no-CDN constraint is a feature, not a limitation
  // (SPEC §2, and v1's own copy).
  fonts: {
    heading: "Georgia, 'Times New Roman', serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  radius: '0.5rem',
})

export const demoNavigation: NavTree = []

/**
 * The seed home page: two structured sections and one legacy one.
 *
 * Three, and only three. `quote` stays in the library rather than on the page
 * because the editor's end-to-end specs count the sections here, and a seed that
 * quietly changes what they are counting turns an unrelated failure into an
 * afternoon.
 */
export function demoHomeContent(defIds: Record<string, string>): SectionInstance[] {
  return PageContent.parse([
    {
      section_def_id: defIds['hero'],
      section_def_version: 1,
      values: {
        heading: 'A page served by cms-v2',
        intro: 'This HTML left the server complete — nothing for a crawler to miss and nothing to wait for.',
      },
      label: 'Hero',
    },
    {
      section_def_id: defIds['prose'],
      section_def_version: 1,
      values: {
        title: 'What you are looking at',
        body:
          '<p>Every section on this page is an <strong>immutable definition version</strong>, ' +
          'pinned by the page that uses it. Editing the definition creates the next version; ' +
          'this page keeps rendering the one it was built with until someone upgrades it deliberately.</p>',
      },
      label: 'Explanation',
    },
    {
      section_def_id: defIds['cta'],
      section_def_version: 1,
      values: {
        heading: 'Edit this page in the admin',
        action: { url: '/', label: 'Open the editor' },
      },
      label: 'Call to action',
    },
  ])
}

export const demoSpeakersCollection = {
  slug: 'speakers',
  name: 'Speakers',
  readerKey: 'speakers',
  fields: [
    { key: 'name', label: 'Name', required: true, type: 'text' },
    { key: 'role', label: 'Role', required: true, type: 'text' },
    { key: 'bio', label: 'Biography', required: false, type: 'richtext' },
    { key: 'photo', label: 'Photo', required: false, type: 'image' },
  ],
  presentation: {
    schemaVersion: 1,
    titleField: 'name',
    subtitleField: 'role',
    imageField: 'photo',
    groupField: null,
  },
  entries: [
    {
      id: null,
      stableKey: 'speaker-1',
      values: {
        name: 'Speaker 1 (sample)',
        role: '[Role]',
        bio: '<p>[Short introduction]</p>',
        photo: '',
      },
    },
    {
      id: null,
      stableKey: 'speaker-2',
      values: {
        name: 'Speaker 2 (sample)',
        role: '[Role]',
        bio: '<p>[Short introduction]</p>',
        photo: '',
      },
    },
  ],
} as const

export function demoSpeakersContent(defIds: Record<string, string>): SectionInstance[] {
  return PageContent.parse([
    {
      section_def_id: defIds['speakers-listing'],
      section_def_version: 1,
      values: {
        heading: 'Meet the speakers',
        speakers: { readerKey: demoSpeakersCollection.readerKey, selection: { mode: 'automatic', limit: 12 } },
      },
      label: 'Speakers listing',
    },
  ])
}

export const demoSiteMeta = {
  slug: 'demo',
  name: 'Demo site',
  kind: 'resource' as const,
  stagingHostname: 'demo.staging.localhost',
  page: {
    slug: '',
    title: 'A page served by cms-v2',
    meta: {
      description: 'The M1 vertical slice: edit, publish, and read the result without JavaScript.',
    },
  },
  speakersPage: {
    slug: 'speakers',
    title: 'Speakers',
    meta: { description: 'A server-rendered collection-backed speakers listing.' },
  },
}
