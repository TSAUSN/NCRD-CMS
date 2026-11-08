/** This long seed catalogue keeps each governed definition together; existing page pins are immutable. */
import { REPORT_LIBRARY } from './report-library.ts'
import { ECHELON_LIBRARY } from './echelon-library.ts'
import { NATIONAL_LIBRARY } from './national-library.ts'
import { STORIES_MODEL, sawsoStoryRows, STORY_SECTORS, STORY_REGIONS } from './sawso-stories.ts'
import { CORE_BOOTSTRAP_GRID } from './core-grid.ts'
import { sourceSampleValues, MATERIAL_ICON_PRESENTATION, type SlotDef, type StructuredNode } from '@cms/schema'
import { compileSeedSection, upsertArguments, type SeedSectionDef, type SeedCompiled } from './index.ts'
export type CoreCapabilities = {
  background: boolean
  width: boolean
  spacing: boolean
  alignment: boolean
  imagePosition: boolean
  phoneOrder: boolean
  buttonStyle: boolean
}
export type CoreSection = {
  definition: SeedSectionDef
  purpose: string
  capabilities: CoreCapabilities
  samples: Record<string, unknown>
  list?: 'speakers' | 'people' | 'program' | 'resources'
}
const capabilities = (extra: Partial<CoreCapabilities> = {}): CoreCapabilities => ({
  background: true,
  width: true,
  spacing: true,
  alignment: true,
  imagePosition: false,
  phoneOrder: false,
  buttonStyle: false,
  ...extra,
})
const image = (shape = 'landscape') => ({
  src: `/cms-samples/r8-${shape}.png`,
  alt: 'Original abstract illustration of a welcoming community',
  decorative: false,
})
const link = (label: string, url = '#next') => ({ label, url })
const text = (id: string, label: string, sample: string): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: { sourceSample: sample },
})
const rich = (id: string, label: string, sample: string): SlotDef => ({
  id,
  kind: 'richtext',
  label,
  constraints: { sourceSample: sample },
})
const picture = (id = 'photo', label = 'Picture', shape = 'landscape'): SlotDef => ({
  id,
  kind: 'image',
  label,
  constraints: { sourceSample: image(shape) },
})
const action = (id: string, label: string, sample: string, url = '#next'): SlotDef => ({
  id,
  kind: 'button',
  label,
  constraints: { sourceSample: link(sample, url) },
})
const group = (
  id: string,
  label: string,
  unit: string,
  fields: SlotDef[],
  samples: Record<string, unknown>[],
): SlotDef => ({ id, kind: 'repeat', label, constraints: { item: { fields, unit, min: 0, max: 48, samples } } })
const heading = () => text('heading', 'Heading', 'A shared purpose. A stronger community.')
const widget = (name: 'chapter-search' | 'chapter-directory' | 'contact-form'): SlotDef => ({
  id: 'widget',
  kind: 'text',
  label: 'Site content',
  constraints: { siteWidget: name },
})
const intro = () =>
  text(
    'intro',
    'Introduction',
    'Bring people together to share ideas, build connections and make a practical difference.',
  )
const item = '<article class="core-card">{{photo}}<h3>{{title}}</h3><p>{{description}}</p>{{action}}</article>'
const baseCss =
  CORE_BOOTSTRAP_GRID +
  `
.core{--core-gap:calc(1.5rem * var(--spacing-scale));--core-space:calc(3rem * var(--spacing-scale));box-sizing:border-box;padding:var(--core-space) 1.25rem;background:var(--color-surface);color:var(--color-ink);font-family:var(--font-body);overflow-wrap:anywhere}
.core *{box-sizing:border-box;min-width:0}.core .container{width:100%;max-width:72rem;margin-inline:auto}.core .row{--bs-gutter-x:var(--core-gap);--bs-gutter-y:var(--core-gap);align-items:center}
.core h1,.core h2,.core h3{font-family:var(--font-heading);line-height:1.15;margin:0 0 1rem;text-wrap:balance}.core h1{font-size:clamp(2rem,5vw,4rem)}.core h2{font-size:clamp(1.6rem,3vw,2.5rem)}.core h3{font-size:1.25rem}.core p{line-height:1.65;margin:0 0 1rem}.core .core-intro{font-size:clamp(1rem,2vw,1.2rem);max-width:48rem}
.core .core-kicker{font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:.8rem;margin-bottom:1rem;color:var(--color-ink)}.core .core-actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.5rem}.core a:not(.cms-button){color:var(--color-ink);text-underline-offset:.2em}.core a:focus-visible,.core summary:focus-visible{outline:2px solid var(--color-primary);outline-offset:4px}.core .core-actions>a,.core-card>a{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.75rem 1.25rem;text-decoration:none}.core .core-actions>a+a{background:var(--color-surface);color:var(--color-ink);border-color:var(--color-ink)}
.core img{display:block;width:100%;height:auto;object-fit:cover;border-radius:var(--radius)}.core .core-grid{display:grid;grid-template-columns:1fr;gap:var(--core-gap);margin-top:2rem;align-items:start}.core-card{padding:1.5rem;border:1px solid var(--color-muted);border-radius:var(--radius);background:var(--color-surface);color:var(--color-ink)}.core-card img{aspect-ratio:4/3;margin-bottom:1.25rem}.core-card p:last-child{margin-bottom:0}.core-card>a{margin-top:.5rem}.core-center{text-align:center}.core-center .core-intro{margin-inline:auto}.core-center .core-actions{justify-content:center}
.core-photo{position:relative;background:var(--color-ink);color:var(--color-surface);isolation:isolate}.core-photo>.core-backdrop{position:absolute;inset:0;z-index:-1;opacity:.18}.core-photo>.core-backdrop img{width:100%;height:100%;border-radius:0}.core-photo .container{position:relative}.core-photo .core-intro{max-width:38rem}.core-photo .core-kicker{color:inherit}.core-reading .container{max-width:48rem}.core-quote blockquote{margin:0;border-left:.25rem solid var(--color-primary);padding-left:1.5rem;font-family:var(--font-heading);font-size:clamp(1.4rem,3vw,2.25rem)}.core-quote .core-credit{font-family:var(--font-body);font-size:1rem;margin-top:1.5rem}
.core-faq details{border-top:1px solid var(--color-muted);padding:1.25rem 0}.core-faq summary{font-weight:700;font-size:1.1rem;cursor:pointer;min-height:2rem}.core-faq details>div{padding-top:1rem;line-height:1.7}.core-stats .core-number{font-family:var(--font-heading);font-size:clamp(2.5rem,5vw,4rem);font-weight:700;color:var(--color-ink)}.core-logos img{aspect-ratio:3/2;object-fit:contain;max-height:6rem}.core-logos .core-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.core-logos .core-card{text-align:center}
.core-people img{aspect-ratio:1/1;max-height:14rem}.core-people .core-card{padding:1.25rem}.core-people .core-role{font-size:.95rem;font-weight:600}.core details{margin-top:.75rem}.core summary{cursor:pointer;min-height:2rem}.core summary[aria-label]::after{content:attr(aria-label)}.core .cms-initials-avatar{display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;max-height:14rem;background:var(--color-surfaceAlt);color:var(--color-ink);font-family:var(--font-heading);font-size:3rem;border-radius:var(--radius);margin-bottom:1.25rem}.core-schedule .core-grid{grid-template-columns:1fr;max-width:56rem}.core-schedule [hidden]{display:none!important}.core-schedule [data-cms-track-filter] button{font:inherit;color:var(--color-ink);background:var(--color-surfaceAlt);border:1px solid var(--color-muted);border-radius:var(--radius);padding:.5rem 1rem;min-height:2.5rem;margin:0 .5rem .5rem 0;cursor:pointer}.core-schedule [data-cms-track-filter] button[aria-pressed=true]{color:var(--color-surface);background:var(--color-ink)}.core-schedule .cms-list-day+.cms-list-day{margin-top:2rem}.core-schedule .cms-list-day-items{display:grid;gap:1rem}.core-schedule .cms-list-day>h3{margin-bottom:1rem}.core-schedule .core-card{display:grid;gap:.5rem}.core-schedule .core-date{font-weight:700;color:var(--color-ink)}.core-schedule h3{margin-bottom:0}.core-gallery .core-card{padding:0;overflow:hidden}.core-gallery figcaption{padding:1rem}.core-gallery img{margin:0;aspect-ratio:4/3}.core-nav .core-grid{display:flex;flex-wrap:wrap;gap:.5rem;margin:0}.core-nav{padding-block:1rem;border-block:1px solid var(--color-muted)}.core-nav a{display:block;min-height:2.5rem;padding:.6rem 1rem;font-weight:600}.core-video .container{max-width:60rem}.core-video img{aspect-ratio:16/9}.core-video figcaption{margin-top:.5rem}.core-list .core-card{height:100%}
@media(min-width:48em){.core .core-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.core-logos .core-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.core-schedule .core-grid{grid-template-columns:1fr}.core-gallery .core-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(min-width:75em){.core .core-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.core-logos .core-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.core-schedule .core-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.core *{transition:none}}
`
function section(
  slug: string,
  name: string,
  category: string,
  purpose: string,
  body: string,
  slots: SlotDef[],
  modifiers = '',
  extra: Partial<CoreCapabilities> = {},
  extraCss = '',
): CoreSection {
  const caps = capabilities(extra)
  const annotated = slots.map((slot, index) =>
    index
      ? slot
      : {
          ...slot,
          constraints: { ...slot.constraints, coreCapabilities: caps, corePurpose: purpose, coreLibrary: 'r8' },
        },
  )
  const definition: SeedSectionDef = {
    kind: 'legacy',
    slug: `core-${slug}`,
    name,
    category,
    sourceHtml: `<section class="core ${modifiers}"><div class="container">${body}</div></section>`,
    sourceCss: baseCss + extraCss,
    slots: annotated,
    changelog: 'Revision 8 global core library. Existing page versions remain pinned.',
  }
  if (slug === 'photo-hero')
    definition.sourceHtml = definition.sourceHtml.replace(
      '<div class="container">',
      '<div class="core-backdrop">{{photo}}</div><div class="container">',
    )
  return { definition, purpose, capabilities: caps, samples: sourceSampleValues(annotated) }
}
const heroBody =
  '<div class="row"><div class="col-12 col-md-6"><p class="core-kicker">{{kicker}}</p><h1>{{heading}}</h1><p class="core-intro">{{intro}}</p><div class="core-actions">{{primary}}{{secondary}}</div></div><div class="col-12 col-md-6">{{photo}}</div></div>'
const heroFields = () => [
  text('kicker', 'Short introduction', 'Ideas into action'),
  heading(),
  intro(),
  action('primary', 'Main button', 'Plan your visit', '#visit'),
  action('secondary', 'Second button', 'Explore the program', '#program'),
  picture(),
]
const cardFields = () => [
  picture('photo', 'Picture', 'square'),
  text('title', 'Title', 'A place to connect'),
  text('description', 'Description', 'Meet people, share what works and discover your next step.'),
  action('action', 'Link', 'Explore this opportunity'),
]
const cardSamples = () =>
  ['Learn together', 'Build connections', 'Put ideas into action'].map(title => ({
    title,
    description: 'Practical ideas and meaningful conversations for people making a difference.',
    photo: image('square'),
    action: link('Find out more'),
  }))
function collectionSection(
  slug: string,
  name: string,
  category: string,
  purpose: string,
  reader: NonNullable<CoreSection['list']>,
  fields: { name: string; type: 'text' | 'richtext' | 'image' | 'link' }[],
  modifier: string,
): CoreSection {
  const node = (
    tag: 'h2' | 'h3' | 'h4' | 'p' | 'div',
    field: string,
    type: 'text' | 'richtext' = 'text',
    cls = '',
  ): StructuredNode => ({
    type: 'element' as const,
    tag,
    attributes: cls ? { class: cls } : {},
    children: [{ type, field }],
  })
  const itemNodes = fields
    .filter(field => reader !== 'program' || field.name !== 'date')
    .map(field =>
      field.type === 'image'
        ? {
            type: 'image' as const,
            field: field.name,
            staticAttributes: {
              loading: 'lazy' as const,
              decoding: 'async' as const,
              ...(reader === 'speakers' || reader === 'people' ? { class: ['cms-avatar-fallback'] } : {}),
            },
          }
        : field.type === 'link'
          ? { type: 'link' as const, field: field.name }
          : field.type === 'richtext'
            ? {
                type: 'element' as const,
                tag: 'details' as const,
                attributes: {},
                children: [
                  {
                    type: 'element' as const,
                    tag: 'summary' as const,
                    attributes: { 'aria-label': field.name === 'bio' ? 'Read bio' : 'Read more' },
                    children: [],
                  },
                  node('div', field.name, 'richtext'),
                ],
              }
            : node(
                field.name === 'name' || field.name === 'title' ? (reader === 'program' ? 'h4' : 'h3') : 'p',
                field.name,
                field.type,
                field.name === 'date'
                  ? 'core-date'
                  : field.name === 'role' || field.name === 'speakers'
                    ? 'core-role'
                    : '',
              ),
    )
  const listWords = {
    speakers: ['Meet the speakers', 'Speakers will be announced here.'],
    people: ['Meet our team', 'Meet the people behind our work here soon.'],
    program: ['Program', 'Program details will be announced here.'],
    resources: ['Resources for your next step', 'New resources will be shared here.'],
  }[reader]
  const definition: SeedSectionDef = {
    kind: 'structured',
    slug: `core-${slug}`,
    name,
    category,
    sourceCss:
      baseCss +
      (reader === 'program'
        ? '.core-schedule .core-card{padding:calc(1rem * var(--spacing-scale));gap:.5rem}.core-schedule .core-card>*{margin:0}.core-schedule .core-card h4{font-size:1rem;line-height:1.4}.core-schedule .core-role{font-weight:600}.core-schedule .core-card>a{justify-self:start;padding-inline:0;text-decoration:underline}'
        : ''),
    fields: [
      { name: 'heading', type: 'text', label: 'Heading' },
      { name: reader, type: 'repeat', label: name },
    ],
    nodes: [
      {
        type: 'element',
        tag: 'section',
        attributes: { class: `core ${modifier}` },
        children: [
          {
            type: 'element',
            tag: 'div',
            attributes: { class: 'container' },
            children: [
              node('h2', 'heading'),
              {
                type: 'element',
                tag: 'div',
                attributes: { class: 'core-grid' },
                children: [
                  {
                    type: 'repeat',
                    field: reader,
                    empty: { behavior: 'message', text: listWords[1]! },
                    item: [
                      { type: 'element', tag: 'article', attributes: { class: 'core-card' }, children: itemNodes },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    changelog: 'Revision 8 global core library, backed by a site list.',
  }
  return {
    definition,
    purpose,
    capabilities: capabilities({ alignment: false }),
    samples: { heading: listWords[0]!, [reader]: { readerKey: reader, selection: { mode: 'automatic', limit: 30 } } },
    list: reader,
  }
}
const storyFields: SlotDef[] = [
  picture('photo', 'Lead photo'),
  text('title', 'Title', ''),
  text('summary', 'Summary', ''),
  { ...text('published_date', 'Published', ''), constraints: { presentation: 'cms-date-long-v1' } },
  text('region_label', 'Region', ''),
  rich('sector_links', 'Sectors', ''),
  text('photo_note', 'Photo note', ''),
  { id: 'story_url', kind: 'link', label: 'Read story', constraints: {} },
]
const storyCards =
  '<div class="core-story-grid">{{#stories}}<article class="core-story-card"><div class="core-story-photo">{{photo}}<span>{{photo_note}}</span></div><div class="core-story-copy"><div class="core-story-tags"><b>Project sector</b><div class="core-story-sectors">{{sector_links}}</div><b>Region</b><span class="core-story-region-pill">{{region_label}}</span></div><h3><a href="{{story_url}}">{{title}}</a></h3><p>{{summary}}</p><p class="core-story-date">{{published_date}}</p><a href="{{story_url}}">Read More</a></div></article>{{/stories}}</div>'
const storyCss = [
  '.core-story-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:1.5rem}',
  '.core-story-card{min-width:0;background:var(--color-surfaceAlt);border-radius:var(--radius);overflow:hidden}',
  '.core-story-card h3{font-size:1.2rem;line-height:1.4;margin:.5rem 0}',
  '.core-story-card h3 a{color:inherit;text-decoration:none}',
  '.core-story-copy{padding:1rem;display:grid;gap:.5rem}',
  '.core-story-copy p{margin:0}',
  '.core-story-copy>a{font-weight:700;min-height:2.75rem;display:inline-flex;align-items:center}',
  '.core-story-photo{position:relative}',
  '.core-story-photo img{display:block;width:100%;height:10rem;object-fit:cover;border-radius:0}',
  '.core-story-photo span{position:absolute;bottom:.5rem;left:.5rem;background:var(--color-surface);color:var(--color-ink);padding:.25rem .5rem;border-radius:var(--button-radius);font-size:.75rem}',
  '.core-story-region,.core-story-date{font-size:.875rem;color:var(--color-muted)}',
  '.core-story-empty{padding:1.5rem;background:var(--color-surfaceAlt);border-radius:var(--radius)}',
  '.core-stories:has(.core-story-card) .core-story-empty{display:none}',
  '.core-story-more{margin-top:1.5rem}',
  '.core-story-more a{display:inline-flex;min-height:2.75rem;align-items:center}',
  '@media(min-width:1024px){.core-story-grid{grid-template-columns:repeat(3,minmax(0,1fr))}',
  '.core-story-more{display:none}',
  '}',
  '@media(max-width:1023px){.core-stories .core-story-card:nth-child(n+4){display:none}',
  '.core-story-desktop-link{display:none}',
  '}',
].join('')
const storiesSection = section(
  'stories',
  'Stories',
  'From your lists & feeds',
  'Show newest tagged stories from the site Stories list, with an expiry and a clear empty state.',
  '<div class="core-story-heading"><h2>{{heading}}</h2><p class="core-story-desktop-link">{{newsroom}}</p></div>' +
    storyCards +
    '<p class="core-story-empty" data-empty-mode="{{empty_mode}}">{{empty_line}}</p><p class="core-story-more">{{more}}</p>',
  [
    text('heading', 'Heading', '[Stories heading — sample content]'),
    {
      id: 'stories',
      kind: 'repeat',
      label: 'Stories',
      constraints: {
        collection: true,
        storyFeed: true,
        sampleFlags: { photo: 'photo_is_sample', body: 'body_is_sample' },
        sourceSample: {
          readerKey: 'stories',
          selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', maxAgeMonths: 13, limit: 6 },
        },
        item: { unit: 'Story', fields: storyFields },
      },
    },
    {
      ...text('empty_mode', 'When there are no stories', 'line'),
      constraints: {
        sourceSample: 'line',
        choices: [
          { value: 'line', label: 'Show a line' },
          { value: 'hide', label: 'Hide the section' },
        ],
      },
    },
    text('empty_line', 'Line to show', 'Check back soon for stories from our [sector] work.'),
    {
      id: 'more',
      kind: 'link',
      label: 'More stories',
      constraints: { sourceSample: { url: '/newsroom', label: 'More stories' } },
    },
    {
      id: 'newsroom',
      kind: 'link',
      label: 'Newsroom link',
      constraints: { sourceSample: { url: '/newsroom', label: 'Visit our newsroom' } },
    },
  ],
  'core-stories',
  { alignment: false },
  storyCss,
)
const storyDetailSection = section(
  'story-detail',
  'Story',
  'Text & stories',
  'Show one published story with its summary, approved text and original address.',
  '<p class="core-story-crumbs">{{library_link}}</p>{{#story}}<h1>{{title}}</h1><div class="core-story-meta"><span>{{published_date}}</span><div class="core-story-chips core-story-sectors">{{sector_links}}</div><span class="core-story-region-pill">{{region_label}}</span></div><figure class="core-story-photo">{{photo}}<figcaption>{{photo_note}}</figcaption></figure><p class="core-story-opening">{{summary}}</p><div class="core-story-text">{{body}}</div><p class="core-story-source"><a href="{{old_address}}">Read the full story</a></p>{{/story}}',
  [
    {
      id: 'library_link',
      kind: 'link',
      label: 'Story library link',
      constraints: { sourceSample: { url: '', label: '' } },
    },
    {
      id: 'story',
      kind: 'repeat',
      label: 'Story',
      constraints: {
        collection: true,
        sampleFlags: { photo: 'photo_is_sample', body: 'body_is_sample' },
        sourceSample: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [] } },
        item: {
          unit: 'Story',
          fields: [
            ...storyFields.filter(field => field.id !== 'story_url'),
            { id: 'body', kind: 'richtext', label: 'Story text', constraints: {} },
            { id: 'old_address', kind: 'link', label: 'Old address', constraints: {} },
          ],
        },
      },
    },
  ],
  'core-story-detail',
  { alignment: false },
  storyCss +
    [
      '.core-story-detail .core-story-crumbs:empty,.core-story-detail .core-story-crumbs:has(a[href=""]){display:none}',
      '.core-story-detail:has(.core-story-text:not(:empty)) .core-story-source,.core-story-detail .core-story-source:has(a[href=""]){display:none}',
      '.core-story-detail .core-story-photo img{height:auto;max-height:28rem;aspect-ratio:16/9}',
      '.core-story-detail h1{font-size:clamp(2rem,5vw,3rem)}',
      '.core-story-chips{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.5rem}',
      '.core-story-chips a{padding:.5rem .75rem;border-radius:var(--button-radius);background:var(--color-surfaceAlt);color:var(--color-ink)}',
      '.core-story-opening{font-weight:600}',
    ].join(''),
)
const worldStoriesSection = section(
  'story-world',
  'World View',
  'From your lists & feeds',
  'Show this site’s stories on a clickable world map, with region counts and ordinary links.',
  '<h2 class="core-world-heading">{{heading}}</h2><div class="core-world-panel" data-start-region="{{start_region}}" data-stories-per-region="{{per_region}}"><div class="core-world-map"></div><nav class="core-world-regions" aria-label="Story regions"></nav><p class="core-world-hint"></p><div class="core-world-results"><h3 class="core-world-region-heading"></h3>' +
    storyCards +
    '<p class="core-world-empty"></p></div></div>',
  [
    text('heading', 'Heading above the map', 'Where We Work'),
    {
      id: 'start_region',
      kind: 'text',
      label: 'Region shown when the page opens',
      constraints: { sourceSample: '', storyRegionFor: 'stories' },
    },
    {
      ...text('per_region', 'Stories per region', '200'),
      constraints: {
        sourceSample: '200',
        storyPerRegionFor: 'stories',
        choices: [
          { value: '200', label: 'All' },
          { value: '3', label: '3' },
          { value: '6', label: '6' },
          { value: '9', label: '9' },
          { value: '12', label: '12' },
          { value: '24', label: '24' },
        ],
      },
    },
    {
      id: 'stories',
      kind: 'repeat',
      label: 'Stories',
      constraints: {
        collection: true,
        storyFeed: true,
        storyWidget: 'world',
        sampleFlags: { photo: 'photo_is_sample', body: 'body_is_sample' },
        sourceSample: {
          readerKey: 'stories',
          selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', maxAgeMonths: 13, limit: 200 },
        },
        item: { unit: 'Story', fields: storyFields },
      },
    },
  ],
  'core-story-world',
  { alignment: false },
  storyCss,
)
const splitStoriesSection = section(
  'story-split',
  'Split View',
  'From your lists & feeds',
  'Browse this site’s stories by date, main tag or map, with ordinary links and Show more.',
  '<div class="core-world-panel" data-start-view="{{start_view}}" data-page-size="{{page_size}}"><div class="core-split-intro"><h1>{{heading}}</h1><p>{{introduction}}</p></div><nav class="core-split-views" aria-label="Story views"></nav><div class="core-split-stage"><div class="core-split-tools"></div><div class="core-split-sectors"></div><div class="core-split-map"><div class="core-world-map"></div><nav class="core-world-regions" aria-label="Story regions"></nav></div><p class="core-world-hint"></p><div class="core-world-results"><h3 class="core-world-region-heading"></h3>' +
    storyCards +
    '</div><div class="core-split-more"></div></div></div>',
  [
    text('heading', 'Heading', 'News and Stories'),
    text('introduction', 'Introduction', ''),
    {
      ...text('start_view', 'View shown first', 'recent'),
      constraints: {
        sourceSample: 'recent',
        storyViewFor: 'stories',
        choices: [
          { value: 'recent', label: 'Recently Published' },
          { value: 'sectors', label: 'By main tag' },
          { value: 'map', label: 'By Map' },
        ],
      },
    },
    {
      ...text('page_size', 'Stories per Show more', '12'),
      constraints: {
        sourceSample: '12',
        choices: [
          { value: '3', label: '3' },
          { value: '6', label: '6' },
          { value: '9', label: '9' },
          { value: '12', label: '12' },
          { value: '24', label: '24' },
        ],
      },
    },
    {
      id: 'stories',
      kind: 'repeat',
      label: 'Stories',
      constraints: {
        collection: true,
        storyFeed: true,
        storyWidget: 'split',
        sampleFlags: { photo: 'photo_is_sample', body: 'body_is_sample' },
        sourceSample: {
          readerKey: 'stories',
          selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', maxAgeMonths: 13, limit: 200 },
        },
        item: { unit: 'Story', fields: storyFields },
      },
    },
  ],
  'core-story-split',
  { alignment: false },
  storyCss,
)
export const CORE_LIBRARY: readonly CoreSection[] = [
  ...NATIONAL_LIBRARY,
  ...ECHELON_LIBRARY,
  ...REPORT_LIBRARY,
  storiesSection,
  storyDetailSection,
  worldStoriesSection,
  splitStoriesSection,
  section(
    'newsroom',
    'Newsroom stories',
    'From your lists & feeds',
    'Browse every published story using sector and region links, twelve at a time.',
    '<h1 class="core-newsroom-page-heading">{{page_heading}}</h1><div class="national-block-head"><h2>{{heading}}</h2>{{link}}</div><div class="core-newsroom-panel" data-view="{{home}}"><p class="core-newsroom-intro">{{intro}}</p><nav class="core-newsroom-tabs" aria-label="Story views"><a href="/newsroom">Recently Published</a><a href="/newsroom#story-filters">By Project Sector</a></nav><nav id="story-filters" class="core-newsroom-filters" aria-label="Story filters">{{filters}}</nav>' +
      storyCards +
      '<p class="core-story-empty">{{empty_line}}</p><div class="core-newsroom-paging">{{paging}}</div></div>',
    [
      text('page_heading', 'Page heading', ''),
      text('heading', 'Heading', 'News and Stories'),
      text('intro', 'Introduction', ''),
      { id: 'link', kind: 'link', label: 'Heading link', constraints: {} },
      text('home', 'View', 'newsroom'),
      {
        id: 'stories',
        kind: 'repeat',
        label: 'Stories',
        constraints: {
          collection: true,
          sampleFlags: { photo: 'photo_is_sample', body: 'body_is_sample' },
          sectors: STORY_SECTORS,
          regions: STORY_REGIONS,
          sourceSample: {
            readerKey: 'stories',
            selection: { mode: 'automatic', order: 'newest', dateField: 'published_date', limit: 200 },
          },
          item: { unit: 'Story', fields: storyFields },
        },
      },
      rich('filters', 'Story filters', ''),
      rich('paging', 'Story pages', ''),
      text('empty_line', 'Line to show', 'Check back soon for stories from our [sector] work.'),
    ],
    'core-newsroom',
    { alignment: false },
    storyCss +
      [
        '.core-newsroom:has(.core-story-card) .core-story-empty{display:none}',
        '.core-newsroom-filters{margin-bottom:2rem}',
        '.core-newsroom-filters p{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}',
        '.core-newsroom-filters b{flex-basis:100%}',
        '.core-newsroom-filters a,.core-newsroom-filters strong{display:inline-flex;align-items:center;min-height:2.75rem;padding:.5rem .75rem;border-radius:var(--button-radius);background:var(--color-surfaceAlt);color:var(--color-ink);text-decoration:none;font-size:.875rem}',
        '.core-newsroom-filters strong{background:var(--color-accent);color:var(--color-accentContrast)}',
        '.core-newsroom-paging{margin-top:2rem;display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}',
        '.core-newsroom-paging a{display:inline-flex;min-height:2.75rem;align-items:center;margin-inline-end:1rem}',
      ].join(''),
  ),
  section(
    'chapter-board',
    'Chapter board',
    'People',
    'Introduce a chapter board with optional Show all, using page-owned editable cards.',
    '<h2>{{heading}}</h2>{{#cards}}' + item + '{{/cards}}',
    [
      text('heading', 'Heading', 'Board'),
      {
        ...group('cards', 'Board members', 'Board member', cardFields(), cardSamples()),
        constraints: {
          ...group('cards', 'Board members', 'Board member', cardFields(), cardSamples()).constraints,
          boardCards: true,
        },
      },
    ],
    'core-chapter-board',
    { buttonStyle: true },
    [
      '.core-board-more{margin-block:1.5rem}',
      '.core-board-more>summary{font:inherit;font-weight:700;padding:1rem;background:var(--color-surfaceAlt);color:var(--color-ink);border-radius:var(--radius);min-height:2.75rem}',
      '.core-chapter-board .core-card img{aspect-ratio:1/1;max-height:10rem}',
      '.core-chapter-board .core-card p{margin-bottom:0}',
      '@media(max-width:47.99em){.core-chapter-board .core-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}',
      '.core-chapter-board .core-card{padding:1rem}',
      '.core-chapter-board .core-card img{max-height:6rem}',
      '.core-chapter-board .core-card h3{font-size:1rem}',
      '.core-chapter-board .core-card>a{padding:.5rem 0}',
      '}',
    ].join(''),
  ),
  section(
    'chapter-search',
    'Find a chapter search',
    'Page helpers',
    'Help visitors find a nearby chapter from the national page.',
    '<h2>{{heading}}</h2>{{widget}}',
    [text('heading', 'Heading', 'Find a chapter'), widget('chapter-search')],
  ),
  section(
    'chapter-directory',
    'Chapter directory',
    'From your lists & feeds',
    'Show available chapter pages and approved external chapter links.',
    '<h2>{{heading}}</h2>{{widget}}',
    [text('heading', 'Heading', 'Find a chapter'), widget('chapter-directory')],
  ),
  section(
    'contact-form',
    'Contact form',
    'Calls to action',
    'Collect a message with accessible fields and a server-side receipt.',
    '<h2>{{heading}}</h2><p>{{intro}}</p>{{widget}}',
    [
      text('heading', 'Heading', 'Contact us'),
      text('intro', 'Introduction', '[Contact introduction]'),
      widget('contact-form'),
    ],
  ),
  section(
    'split-hero',
    'Split hero',
    'Page openers',
    'Introduce a page with a picture and two clear next steps.',
    heroBody,
    heroFields(),
    '',
    { imagePosition: true, phoneOrder: true, buttonStyle: true },
  ),
  section(
    'photo-hero',
    'Photo hero',
    'Page openers',
    'Lead with a striking picture, a short headline and an invitation.',
    '<p class="core-kicker">{{kicker}}</p><h1>{{heading}}</h1><p class="core-intro">{{intro}}</p><div class="core-actions">{{primary}}</div>',
    heroFields().filter(field => field.id !== 'secondary'),
    'core-photo',
    { background: false, buttonStyle: true },
  ),
  section(
    'statement-hero',
    'Statement hero',
    'Page openers',
    'Make one clear statement at the centre of the page.',
    '<p class="core-kicker">{{kicker}}</p><h1>{{heading}}</h1><p class="core-intro">{{intro}}</p><div class="core-actions">{{primary}}</div>',
    heroFields().filter(field => !['photo', 'secondary'].includes(field.id)),
    'core-center',
    { buttonStyle: true },
  ),
  section(
    'event-hero',
    'Event hero',
    'Page openers',
    'Put your event name, dates, location and registration together.',
    '<div class="row"><div class="col-12 col-md-6"><p class="core-kicker">{{date}} · {{place}}</p><h1>{{heading}}</h1><p class="core-intro">{{intro}}</p><div class="core-actions">{{register}}</div></div><div class="col-12 col-md-6">{{photo}}</div></div>',
    [
      text('date', 'Dates', 'June 8–10, 2027'),
      text('place', 'Location', 'Your city, your community'),
      heading(),
      intro(),
      action('register', 'Registration button', 'Reserve your place'),
      picture(),
    ],
    '',
    { imagePosition: true, phoneOrder: true, buttonStyle: true },
  ),
  section(
    'page-header',
    'Page header',
    'Page openers',
    'Give an inner page a clear title and a useful introduction.',
    '<h1>{{heading}}</h1><p class="core-intro">{{intro}}</p>',
    [heading(), intro()],
  ),
  section(
    'text-block',
    'Text block',
    'Text & stories',
    'Tell your story in a comfortable reading column.',
    '<h2>{{heading}}</h2><div>{{body}}</div>',
    [
      heading(),
      rich(
        'body',
        'Story',
        '<p>Every community has people ready to make a difference. Share the story behind your work and the next step people can take.</p><p>Keep the most useful information near the top. Give people enough detail to feel welcome and prepared.</p>',
      ),
    ],
    'core-reading',
  ),
  section(
    'text-image',
    'Text + image',
    'Text & stories',
    'Pair a short story with a picture that helps explain it.',
    '<div class="row"><div class="col-12 col-md-6">{{photo}}</div><div class="col-12 col-md-6"><h2>{{heading}}</h2><div class="core-text-image-body">{{body}}</div></div></div><span class="report-page-link-label" hidden>{{page_link_label}}</span><div class="core-report-actions"><span class="core-report-page">{{report_page}}</span><span class="core-report-pdf">{{report_pdf}}</span></div>',
    [
      heading(),
      rich(
        'body',
        'Story',
        '<p>Good things happen when we work together. Introduce a person, a program or an idea, and explain why it matters to your community.</p>',
      ),
      picture(),
      { ...text('page_link_label', 'Page link label', ''), constraints: { sourceSample: '', reportOnly: true } },
      {
        id: 'report_page',
        kind: 'link',
        label: 'Web page',
        constraints: { sourceSample: { url: '', label: '' }, reportOnly: true },
      },
      {
        id: 'report_pdf',
        kind: 'link',
        label: 'PDF',
        constraints: { sourceSample: { url: '', label: '' }, reportOnly: true },
      },
    ],
    '',
    { imagePosition: true, phoneOrder: true },
    '@media(max-width:47.999em){.core .row{margin-left:0;margin-right:0}.core .row>*{padding-left:0;padding-right:0}}',
  ),
  section(
    'quote',
    'Quote',
    'Text & stories',
    'Let one person’s words bring the story to life.',
    '<blockquote>{{quote}}<p class="core-credit">{{credit}}</p></blockquote>',
    [
      text('quote', 'Quote', 'We all have something to contribute. The first step is showing up for one another.'),
      text('credit', 'Who said it', 'A voice from our community'),
    ],
    'core-quote core-reading',
  ),
  section(
    'faq',
    'FAQ',
    'Text & stories',
    'Answer common questions in accessible, expandable rows.',
    '<h2>{{heading}}</h2><div class="core-faq-list">{{#questions}}<details><summary><span class="core-faq-question">{{question}}</span><span class="core-faq-count">{{count}}</span><span class="core-faq-open">{{open_label}}</span></summary><div>{{answer}}</div></details>{{/questions}}</div><span class="report-page-link-label" hidden>{{page_link_label}}</span><p class="report-directory-source">{{source}}</p>',
    [
      text('heading', 'Heading', 'A few things you may be wondering'),
      group(
        'questions',
        'Questions',
        'Question',
        [
          text('question', 'Question', ''),
          rich('answer', 'Answer', ''),
          { ...text('count', 'Member count', ''), constraints: { sourceSample: '', reportOnly: true } },
          { ...text('open_label', 'Open list label', ''), constraints: { sourceSample: '', reportOnly: true } },
        ],
        [
          {
            question: 'Who is this for?',
            answer: '<p>Everyone who wants to learn, connect and support their community is welcome.</p>',
          },
          {
            question: 'What should I bring?',
            answer:
              '<p>Bring your questions, a notebook and an open mind. We will share practical details before you arrive.</p>',
          },
          {
            question: 'Can I ask about accessibility?',
            answer: '<p>Please contact the event team so we can help you plan a comfortable visit.</p>',
          },
        ],
      ),
      { ...text('page_link_label', 'Page link label', ''), constraints: { sourceSample: '', reportOnly: true } },
      { ...text('source', 'Source line', ''), constraints: { sourceSample: '', reportOnly: true } },
    ],
    'core-faq core-reading',
  ),
  section(
    'icon-cards',
    'Icon cards',
    'Cards & highlights',
    'Make three important ideas easy to scan.',
    '<h2>{{heading}}</h2><div class="core-grid">{{#cards}}<article class="core-card"><span class="core-kicker">{{icon}}</span><h3>{{title}}</h3><p>{{description}}</p></article>{{/cards}}</div>',
    [
      heading(),
      group(
        'cards',
        'Cards',
        'Card',
        [
          { ...text('icon', 'Icon', ''), constraints: { presentation: MATERIAL_ICON_PRESENTATION } },
          text('title', 'Title', ''),
          text('description', 'Description', ''),
        ],
        cardSamples().map((sample, index) => ({ ...sample, icon: ['users', 'star', 'heart'][index] })),
      ),
    ],
  ),
  section(
    'image-link-cards',
    'Image link cards',
    'Cards & highlights',
    'Help people explore programs, ministries or opportunities.',
    '<h2>{{heading}}</h2><div class="core-grid">{{#cards}}' + item + '{{/cards}}</div>',
    [heading(), group('cards', 'Cards', 'Card', cardFields(), cardSamples())],
    '',
    { buttonStyle: true },
  ),
  section(
    'stats',
    'Stats',
    'Cards & highlights',
    'Show a small set of meaningful numbers with clear labels.',
    '<h2>{{heading}}</h2><div class="core-stats-intro"><div class="core-stats-intro-copy">{{intro}}</div><figure class="core-stats-photo">{{photo}}<figcaption>{{photo_note}}</figcaption></figure></div><div class="core-grid">{{#stats}}<article><p class="core-number">{{value}}</p><h3>{{label}}</h3><p class="core-stat-context">{{context}}</p></article>{{/stats}}</div><p class="ar-small ar-source">{{source}}</p>',
    [
      text('heading', 'Heading', 'Small actions. Shared impact.'),
      group(
        'stats',
        'Numbers',
        'Number',
        [text('value', 'Number', ''), text('label', 'What it means', ''), text('context', 'Context', '')],
        [
          { value: '120', label: 'People connected', context: 'An example of the impact you can share.' },
          { value: '24', label: 'Ideas put into practice', context: 'Explain the time period and source here.' },
          { value: '1', label: 'Shared purpose', context: 'Stronger communities, together.' },
        ],
      ),
      { ...rich('intro', 'Introduction', ''), constraints: { sourceSample: '', reportOnly: true } },
      { id: 'photo', kind: 'image', label: 'Photo', constraints: { sourceSample: '', reportOnly: true } },
      { ...text('photo_note', 'Photo credit', ''), constraints: { sourceSample: '', reportOnly: true } },
      { ...text('source', 'Source line', ''), constraints: { sourceSample: '', reportOnly: true } },
    ],
    'core-stats',
  ),
  section(
    'logo-strip',
    'Logo strip',
    'Cards & highlights',
    'Recognize the partners who make the work possible.',
    '<h2>{{heading}}</h2><div class="core-grid">{{#logos}}<article class="core-card">{{logo}}<p>{{name}}</p></article>{{/logos}}</div>',
    [
      text('heading', 'Heading', 'Made possible together'),
      group(
        'logos',
        'Partners',
        'Partner',
        [picture('logo', 'Logo', 'square'), text('name', 'Partner name', '')],
        ['Community partner', 'Supporting partner', 'Event partner', 'Local partner'].map(name => ({
          name,
          logo: image('square'),
        })),
      ),
    ],
    'core-logos',
  ),
  collectionSection(
    'speakers-grid',
    'Speakers grid',
    'People',
    'Introduce speakers from the Speakers list.',
    'speakers',
    [
      { name: 'photo', type: 'image' },
      { name: 'name', type: 'text' },
      { name: 'role', type: 'text' },
      { name: 'bio', type: 'richtext' },
    ],
    'core-people',
  ),
  collectionSection(
    'team-grid',
    'Team / leadership grid',
    'People',
    'Introduce the people behind your work from the People list.',
    'people',
    [
      { name: 'photo', type: 'image' },
      { name: 'name', type: 'text' },
      { name: 'role', type: 'text' },
      { name: 'bio', type: 'richtext' },
    ],
    'core-people',
  ),
  collectionSection(
    'schedule',
    'Schedule',
    'Events',
    'Help visitors plan their day using the Program list.',
    'program',
    [
      { name: 'date', type: 'text' },
      { name: 'time', type: 'text' },
      { name: 'title', type: 'text' },
      { name: 'speakers', type: 'text' },
      { name: 'location', type: 'text' },
      { name: 'summary', type: 'richtext' },
      { name: 'session_url', type: 'link' },
    ],
    'core-schedule',
  ),
  section(
    'venue-travel',
    'Venue & travel',
    'Events',
    'Put arrival, hotel and accessibility details in one place.',
    '<div class="row"><div class="col-12 col-md-6"><p class="core-kicker">{{kicker}}</p><h2>{{heading}}</h2>{{details}}<div class="core-actions">{{directions}}{{hotel}}</div></div><div class="col-12 col-md-6">{{photo}}{{map}}</div></div>',
    [
      text('kicker', 'Short introduction', 'Plan your visit'),
      text('heading', 'Heading', 'We look forward to welcoming you'),
      rich(
        'details',
        'Venue and travel details',
        '<p><strong>Your venue name</strong><br>123 Community Avenue, Your City</p><p>Doors open at 8:30 AM. Tell visitors about parking, public transport and accessible entrances here.</p>',
      ),
      action('directions', 'Directions link', 'Get directions'),
      action('hotel', 'Hotel link', 'Hotel information'),
      picture(),
      {
        id: 'map',
        kind: 'link',
        label: 'Venue map',
        constraints: {
          embed: 'map',
          embedTitle: 'Venue map',
          embedHelp: 'Paste the Google Maps embed address for your venue. Visitors choose whether to load it.',
          sourceSample: { url: '', label: 'Venue map' },
        },
      },
    ],
    '',
    { imagePosition: true, phoneOrder: true, buttonStyle: true },
  ),
  section(
    'registration-cta',
    'Registration call to action',
    'Events',
    'Make the next step clear with prices and a deadline.',
    '<h2>{{heading}}</h2><p class="core-intro">{{deadline}}</p><div class="core-grid">{{#tiers}}<article class="core-card"><h3>{{title}}</h3><p class="core-number">{{price}}</p><p>{{description}}</p></article>{{/tiers}}</div><div class="core-actions">{{register}}</div>',
    [
      text('heading', 'Heading', 'Be part of the conversation'),
      text('deadline', 'Deadline', 'Register by May 1 to make time for what matters.'),
      group(
        'tiers',
        'Registration choices',
        'Choice',
        [text('title', 'Title', ''), text('price', 'Price', ''), text('description', 'What is included', '')],
        [
          { title: 'Full event', price: '$95', description: 'Three days of learning, connection and practical ideas.' },
          { title: 'One-day visit', price: '$40', description: 'Choose the day that works best for you.' },
        ],
      ),
      action('register', 'Registration link', 'Register for the event'),
    ],
    'core-stats',
    { buttonStyle: true },
  ),
  section(
    'cta-band',
    'Call-to-action band',
    'Calls to action',
    'Invite people to take one focused next step.',
    '<div class="core-report-closing-photo">{{photo}}</div><div class="row"><div class="col-12 col-md-6"><h2>{{heading}}</h2><p>{{intro}}</p></div><div class="col-12 col-md-6"><div class="core-actions">{{action}}</div></div></div>',
    [
      text('heading', 'Heading', 'Your next step can make a difference'),
      intro(),
      action('action', 'Button', 'Get involved'),
      { id: 'photo', kind: 'image', label: 'Photo', constraints: { sourceSample: '', reportOnly: true } },
    ],
    '',
    { buttonStyle: true },
  ),
  section(
    'ways-to-give',
    'Ways to give',
    'Calls to action',
    'Offer clear, practical ways to support the work.',
    '<h2>{{heading}}</h2><div class="core-grid">{{#ways}}' + item.replace('{{photo}}', '') + '{{/ways}}</div>',
    [
      text('heading', 'Heading', 'There is more than one way to help'),
      group(
        'ways',
        'Ways to help',
        'Way to help',
        cardFields().filter(field => field.id !== 'photo'),
        ['Give your time', 'Share your skills', 'Support the work'].map(title => ({
          title,
          description: 'Choose the opportunity that fits you. Every contribution helps us serve our community.',
          action: link('Explore this option'),
        })),
      ),
    ],
    '',
    { buttonStyle: true },
  ),
  section(
    'image-gallery',
    'Image gallery',
    'Media',
    'Tell a visual story with pictures and useful captions.',
    '<h2>{{heading}}</h2><div class="core-grid">{{#pictures}}<figure class="core-card">{{photo}}<figcaption>{{caption}}</figcaption></figure>{{/pictures}}</div>',
    [
      text('heading', 'Heading', 'Moments that bring us together'),
      group(
        'pictures',
        'Pictures',
        'Picture',
        [picture(), text('caption', 'Caption', '')],
        ['A welcoming place', 'Space to share ideas', 'A stronger community'].map(caption => ({
          caption,
          photo: image(),
        })),
      ),
    ],
    'core-gallery',
  ),
  section(
    'video',
    'Video',
    'Media',
    'Introduce a video with a poster, description and a player.',
    '<h2>{{heading}}</h2><figure>{{poster}}<figcaption><p>{{description}}</p><div class="core-actions">{{watch}}</div></figcaption></figure>',
    [
      text('heading', 'Heading', 'See the difference we can make'),
      picture('poster', 'Video poster'),
      text(
        'description',
        'Video description',
        'A short introduction to the people and ideas behind our shared work. Add a transcript beside your video so everyone can follow along.',
      ),
      {
        ...action('watch', 'Video link', 'Watch the video'),
        kind: 'link',
        constraints: {
          embed: 'video',
          embedTitle: 'Our welcome video',
          embedHelp: 'Paste a YouTube or Vimeo link to show your video here.',
          sourceSample: { url: '', label: 'Our welcome video' },
        },
      },
    ],
    'core-video',
    { buttonStyle: false },
  ),
  collectionSection(
    'resource-library',
    'Resource library',
    'From your lists & feeds',
    'Share useful documents and downloads from the Resources list.',
    'resources',
    [
      { name: 'thumbnail', type: 'image' },
      { name: 'category', type: 'text' },
      { name: 'title', type: 'text' },
      { name: 'summary', type: 'richtext' },
      { name: 'resource_url', type: 'link' },
    ],
    'core-list',
  ),
  section(
    'on-page-navigation',
    'On-page navigation',
    'Page helpers',
    'Help people jump to the important sections of a long page.',
    '<h2>{{heading}}</h2><nav data-links-from="{{accounts_from}}" aria-label="Related links" class="core-grid">{{#links}}{{action}}{{/links}}</nav>',
    [
      text('heading', 'Heading', 'On this page'),
      {
        id: 'accounts_from',
        kind: 'text',
        label: 'Links from',
        constraints: {
          siteSocialAccounts: true,
          sourceSample: 'own',
          choices: [
            { value: 'own', label: 'This section' },
            { value: 'site', label: 'Site social accounts' },
          ],
        },
      },
      group(
        'links',
        'Links',
        'Link',
        [{ ...action('action', 'Section link', ''), kind: 'link' }],
        [
          { action: link('Overview', '#overview') },
          { action: link('Program', '#program') },
          { action: link('Plan your visit', '#visit') },
        ],
      ),
    ],
    'core-nav',
    { alignment: false },
  ),
]
/** Authored metadata belongs to immutable slots alongside existing source samples. */
export function compileCoreSection(entry: CoreSection): SeedCompiled {
  const compiled = compileSeedSection(entry.definition)
  compiled.slots = compiled.slots.map((slot, index) => ({
    ...slot,
    constraints: {
      ...slot.constraints,
      ...(entry.samples[slot.id] !== undefined ? { sourceSample: entry.samples[slot.id] } : {}),
      ...(index === 0
        ? {
            coreCapabilities: entry.capabilities,
            corePurpose: entry.purpose,
            coreLibrary: 'r8',
            ...(entry.list ? { coreList: entry.list, coreListSamples: corePreviewValues(entry)[entry.list] } : {}),
          }
        : {}),
    },
  }))
  return compiled
}
export function coreUpsertArguments(entry: CoreSection): unknown[] {
  const args = upsertArguments(entry.definition)
  args[7] = JSON.stringify(compileCoreSection(entry).slots)
  return [...args, 'global', null]
}

/** Immutable examples for previews and explicitly confirmed sample sections; never stored as list records. */
export function corePreviewValues(entry: CoreSection): Record<string, unknown> {
  if (entry.definition.slug === 'core-report-page-links')
    return {
      ...structuredClone(entry.samples),
      links: { items: ['i1', 'i2', 'i3'] },
      links__i1__action: { label: '[First section]', url: '#first-section' },
      links__i2__action: { label: '[Second section]', url: '#second-section' },
      links__i3__action: { label: '[Third section]', url: '#third-section' },
    }
  const values = structuredClone(entry.samples)
  if (['core-story-detail', 'core-newsroom'].includes(entry.definition.slug)) {
    const schemaId = '00000000-0000-4000-8000-000000000002'
    const row = sawsoStoryRows()[0]!
    return {
      ...values,
      ...(entry.definition.slug === 'core-story-detail' ? { library_link: link('Newsroom', '/newsroom') } : {}),
      [entry.definition.slug === 'core-story-detail' ? 'story' : 'stories']: {
        kind: 'collection',
        collectionId: '00000000-0000-4000-8000-000000000001',
        readerKey: 'stories',
        publishedSchemaVersionId: schemaId,
        publishedSchemaRevision: '1',
        publishedEntryRevision: '1',
        schemas: [{ id: schemaId, revision: '1', fields: STORIES_MODEL.fields }],
        entries: [
          {
            id: '00000000-0000-4000-8000-000000000003',
            stableKey: row.stableKey,
            schemaVersionId: schemaId,
            values: row.values,
          },
        ],
      },
    }
  }
  if (!entry.list || entry.definition.kind !== 'structured') return values
  const schemaId = '00000000-0000-4000-8000-000000000002'
  const base = {
    name: '[Speaker name]',
    role: '[Role, organization]',
    bio: '<p>Meet a thoughtful voice bringing practical ideas and experience to the conversation.</p>',
    photo: entry.list === 'speakers' || entry.list === 'people' ? '' : image('square'),
    thumbnail: image(),
    title: 'Ideas into action',
    summary: '<p>Useful ideas to take back to your community.</p>',
    category: 'Community',
    date: 'June 8, 2027',
    time: '9:00 AM',
    location: 'Main hall',
    resource_url: '/',
    ...(entry.list === 'program' ? { speakers: '[Speaker name]', session_url: 'https://example.test/session' } : {}),
  }
  const records = [0, 1, 2].map(index => ({
    ...base,
    name: (entry.list === 'people' ? 'Person' : 'Speaker') + ' ' + (index + 1) + ' (sample)',
    ...(entry.list === 'people' ? { role: '[Role]', bio: '<p>[Short introduction]</p>' } : {}),
    title: ['A welcoming start', 'Learning together', 'Your next step'][index],
    time: ['9:00 AM', '10:30 AM', '1:00 PM'][index],
  }))
  const kinds: Record<string, string> = {
    bio: 'richtext',
    summary: 'richtext',
    photo: 'image',
    thumbnail: 'image',
    resource_url: 'url',
    session_url: 'url',
  }
  values[entry.list] = {
    kind: 'collection',
    collectionId: '00000000-0000-4000-8000-000000000001',
    readerKey: entry.list,
    publishedSchemaVersionId: schemaId,
    publishedSchemaRevision: '1',
    publishedEntryRevision: '1',
    schemas: [
      {
        id: schemaId,
        revision: '1',
        fields: Object.keys(base).map(key => ({
          key,
          label: key === 'resource_url' ? 'Download resource' : key === 'session_url' ? 'Session details' : key,
          type: kinds[key] ?? 'text',
          required: false,
        })),
      },
    ],
    entries: records.map((record, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 3}`,
      stableKey: `sample-${index + 1}`,
      schemaVersionId: schemaId,
      values: record,
    })),
  }
  return values
}
