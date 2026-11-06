import {
  DEFAULT_FOOTER_CONFIG_V1,
  DEFAULT_HEADER_CONFIG_V1,
  DEFAULT_THEME_TOKENS,
  RESOURCE_COLLECTION_MODEL,
  PROGRAM_COLLECTION_MODEL,
  type SiteSetup,
  type CollectionModel,
  type StructuredNode,
} from '@cms/schema'
import {
  demoSpeakersCollection,
  SEED_SECTION_DEFS,
  type SeedSectionDef,
  type StructuredSeedSectionDef,
} from './index.ts'

export function starterSiteSetup(kind: SiteSetup['kind']): SiteSetup {
  const pages: SiteSetup['pages'] =
    kind === 'event'
      ? [
          {
            slug: '',
            title: 'Home',
            template: 'event-home',
            layout: 'content',
            intro: 'Bring people together around a shared purpose.',
            body: 'Introduce your event, who it is for, and what participants can expect.',
            menu: true,
            nested: false,
            footer: false,
          },
          {
            slug: 'speakers',
            title: 'Speakers',
            layout: 'speakers',
            intro: 'Meet the people contributing to the conversation.',
            body: '',
            menu: true,
            nested: false,
            footer: false,
          },
          {
            slug: 'program',
            title: 'Program',
            layout: 'program',
            intro: 'Explore the sessions and plan your time.',
            body: '',
            menu: true,
            nested: false,
            footer: false,
          },
          {
            slug: 'visit',
            title: 'Plan your visit',
            template: 'visit',
            layout: 'content',
            intro: 'Everything you need to take part.',
            body: 'Add the venue, travel information, accessibility arrangements, and registration details.',
            menu: true,
            nested: false,
            footer: false,
          },
        ]
      : [
          {
            slug: '',
            title: 'Home',
            layout: 'content',
            intro: 'Evidence, resources, and context for your community.',
            body: 'Introduce the purpose of your project and explain how people can use its resources.',
            menu: true,
            nested: false,
            footer: false,
          },
          {
            slug: 'resources',
            title: 'Resources',
            layout: 'resources',
            intro: 'Explore the latest published resources.',
            body: '',
            menu: true,
            nested: false,
            footer: false,
          },
          {
            slug: 'about',
            title: 'About this project',
            layout: 'content',
            intro: 'Understand the work behind the information.',
            body: 'Explain the methodology, sources, and people behind this project.',
            menu: true,
            nested: false,
            footer: false,
          },
        ]
  return {
    schemaVersion: 1,
    name: '',
    slug: '',
    kind,
    theme: structuredClone(DEFAULT_THEME_TOKENS),
    header: structuredClone(DEFAULT_HEADER_CONFIG_V1),
    footer: { ...structuredClone(DEFAULT_FOOTER_CONFIG_V1), brand: { siteName: '', blurb: '', showFoundation: false } },
    pages,
  }
}

export type StarterCollection = { slug: string; name: string; readerKey: string; model: CollectionModel }
export function starterCollections(setup: SiteSetup): StarterCollection[] {
  const needed = new Set<string>(setup.pages.map(page => page.layout))
  for (const page of setup.pages) {
    if (page.template === 'event-home' || page.template === 'speakers') needed.add('speakers')
    if (page.template === 'event-home' || page.template === 'program') needed.add('program')
    if (page.template === 'resources') needed.add('resources')
  }
  const collections: StarterCollection[] = []
  if (setup.pages.some(page => page.template === 'echelon-home'))
    collections.push({
      slug: 'people',
      name: 'People',
      readerKey: 'people',
      model: {
        fields: [
          { key: 'name', type: 'text', label: 'Name', required: true },
          { key: 'role', type: 'text', label: 'Role', required: false },
          { key: 'photo', type: 'image', label: 'Photo', required: false },
          { key: 'bio', type: 'richtext', label: 'Introduction', required: false },
        ],
        presentation: {
          schemaVersion: 1,
          titleField: 'name',
          subtitleField: 'role',
          imageField: 'photo',
          groupField: null,
        },
      },
    })
  if (needed.has('speakers'))
    collections.push({
      slug: 'speakers',
      name: 'Speakers',
      readerKey: 'speakers',
      model: {
        fields: structuredClone([...demoSpeakersCollection.fields]),
        presentation: { ...demoSpeakersCollection.presentation },
      },
    })
  for (const kind of ['resources', 'program'] as const) {
    if (!needed.has(kind)) continue
    collections.push({
      slug: kind,
      name: kind === 'resources' ? 'Resources' : 'Program',
      readerKey: kind,
      model: structuredClone(kind === 'resources' ? RESOURCE_COLLECTION_MODEL : PROGRAM_COLLECTION_MODEL),
    })
  }
  return collections
}

export function starterDefinitions(setup: SiteSetup): SeedSectionDef[] {
  const definitions: SeedSectionDef[] = SEED_SECTION_DEFS.filter(def => ['hero', 'prose'].includes(def.slug))
  const speakers = SEED_SECTION_DEFS.find(def => def.slug === 'speakers-listing') as StructuredSeedSectionDef
  if (setup.pages.some(page => page.layout === 'speakers')) definitions.push(speakers)
  const text = (tag: 'h3' | 'p', field: string, className: string): StructuredNode => ({
    type: 'element',
    tag,
    attributes: { class: className },
    children: [{ type: 'text', field }],
  })
  for (const kind of ['resources', 'program'] as const) {
    if (!setup.pages.some(page => page.layout === kind)) continue
    const resource = kind === 'resources'
    const fields: StructuredNode[] = resource
      ? [
          {
            type: 'image',
            field: 'thumbnail',
            staticAttributes: {
              class: ['listing-card__image'],
              width: 960,
              height: 640,
              loading: 'lazy',
              decoding: 'async',
            },
          },
          text('p', 'category', 'listing-card__category'),
          text('h3', 'title', 'listing-card__title'),
        ]
      : [
          text('p', 'date', 'listing-card__date'),
          text('p', 'time', 'listing-card__time'),
          text('h3', 'title', 'listing-card__title'),
          text('p', 'location', 'listing-card__location'),
          text('p', 'speakers', 'listing-card__speakers'),
          text('p', 'category', 'listing-card__category'),
        ]
    definitions.push({
      kind: 'structured',
      slug: `${kind}-listing`,
      name: resource ? 'Resources listing' : 'Program listing',
      category: 'Collections',
      sourceCss:
        '.content-listing{padding:clamp(2rem,5vw,4rem) 1.5rem;max-width:72rem;margin:0 auto}' +
        '.content-listing__title{margin:0 0 2rem;text-align:center}' +
        `.content-listing__items{display:grid;gap:1.25rem;${resource ? 'grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))' : 'max-width:52rem;margin:0 auto'}}` +
        '.listing-card{min-width:0;overflow-wrap:anywhere;padding:1.5rem;border:1px solid var(--color-primary,#003087);border-radius:var(--radius,.5rem);background:var(--color-surface,#fff)}' +
        '.listing-card__image{display:block;width:100%;height:auto;aspect-ratio:3/2;object-fit:cover;border-radius:var(--radius,.5rem);margin-bottom:1rem}' +
        '.listing-card__title{margin:.5rem 0 .75rem}.listing-card p{margin:.25rem 0}' +
        '.listing-card__date,.listing-card__time,.listing-card__category{color:var(--color-primary,#003087);font-weight:600}' +
        '.listing-card__summary{margin:1rem 0}.listing-card__link{display:inline-block;margin-top:.75rem;font-weight:600;text-underline-offset:.2em}' +
        '.listing-card p:empty,.listing-card__summary:empty{display:none}',
      fields: [
        { name: 'heading', type: 'text', label: 'Heading' },
        { name: kind, type: 'repeat', label: resource ? 'Resources' : 'Program' },
      ],
      nodes: [
        {
          type: 'element',
          tag: 'section',
          attributes: { class: 'content-listing' },
          children: [
            {
              type: 'element',
              tag: 'h2',
              attributes: { class: 'content-listing__title' },
              children: [{ type: 'text', field: 'heading' }],
            },
            {
              type: 'element',
              tag: 'div',
              attributes: { class: 'content-listing__items' },
              children: [
                {
                  type: 'repeat',
                  field: kind,
                  empty: {
                    behavior: 'message',
                    text: resource ? 'No resources have been published yet.' : 'The program will be announced here.',
                  },
                  item: [
                    {
                      type: 'element',
                      tag: 'article',
                      attributes: { class: 'listing-card' },
                      children: [
                        ...fields,
                        {
                          type: 'element',
                          tag: 'div',
                          attributes: { class: 'listing-card__summary' },
                          children: [{ type: 'richtext', field: 'summary' }],
                        },
                        {
                          type: 'link',
                          field: resource ? 'resource_url' : 'session_url',
                          staticAttributes: { class: ['listing-card__link'] },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      changelog: `Typed ${kind} starter with editor-maintained content and governed links.`,
    })
  }
  return definitions
}

/** Wizard body text is plain text; it cannot introduce a trusted-code escape hatch. */
export function starterBodyHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(
      paragraph =>
        `<p>${paragraph.replace(
          /[&<>"']/g,
          character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
        )}</p>`,
    )
    .join('')
}
