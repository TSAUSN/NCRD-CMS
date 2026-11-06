/** Approved Echelon body variants; content stays in ordinary text/image/repeat slots. */
import { MATERIAL_ICON_PRESENTATION, type SlotDef } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
import type { CorePageDefinition } from './core-templates.ts'
type Variant = (slug: string, name: string, purpose: string, html: string, fields: SlotDef[]) => CoreSection
const text = (id: string, label: string, value: string): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: {
    sourceSample: value,
    multiline: ['intro', 'body', 'paragraph_one', 'paragraph_two', 'paragraph_three'].includes(id),
  },
})
const icon: SlotDef = {
  id: 'icon',
  kind: 'text',
  label: 'Icon',
  constraints: { presentation: MATERIAL_ICON_PRESENTATION },
}
const photo = (id: string, label: string): SlotDef => ({
  id,
  kind: 'image',
  label,
  constraints: {
    sourceSample: { src: '/cms-samples/r8-landscape.png', alt: '[Replace with an Echelon photo]', decorative: false },
  },
})
const group = (
  id: string,
  label: string,
  fields: SlotDef[],
  samples: Record<string, unknown>[],
  max: number,
): SlotDef => ({ id, kind: 'repeat', label, constraints: { item: { unit: 'Card', min: 0, max, fields, samples } } })
const movement =
  'Echelon is the emerging professionals’ movement of The Salvation Army — connecting people, ideas and service to create lasting change in our communities.'
const statements = [
  {
    icon: 'users',
    title: 'Emerging leaders. Greater impact.',
    body: 'Echelon brings together emerging professionals who are passionate about service, leadership and creating a stronger, more compassionate community.',
  },
  {
    icon: 'target',
    title: 'For a stronger tomorrow.',
    body: 'Through connections, fundraising and hands-on service, we support The Salvation Army’s life-changing work and help build a brighter future for those in need.',
  },
]
const pillars = [
  {
    icon: 'heart',
    label: 'Service',
    title: 'Serve our neighbors',
    body: 'We give our time and talents to hands-on projects that support local Salvation Army programs and the neighbors they serve.',
  },
  {
    icon: 'users',
    label: 'Fellowship',
    title: 'Build meaningful connections',
    body: 'Our social and service gatherings help members build friendships, learn about local needs and invite others to get involved.',
  },
  {
    icon: 'gift',
    label: 'Fundraising',
    title: 'Fundraise for local needs',
    body: 'We bring people together to raise funds for local programs and new opportunities to serve our community.',
  },
]
export function echelonBodyLibrary(variant: Variant): readonly CoreSection[] {
  return [
    variant(
      'about',
      'Feature statements · Echelon',
      'Present the shared Echelon purpose and two editable statements with the approved icons and shield divider.',
      '<div class="echelon-template"><section class="ech-panel ech-about-intro"><div class="ech-about-intro-heading"><p class="volunteer-kicker">{{kicker}}</p><h2>{{heading}}</h2><p class="ech-about-intro-lead">{{intro}}</p></div><div class="ech-about-intro-grid">{{#cards}}<article class="ech-about-intro-item"><div class="ech-about-intro-icon"><i>{{icon}}</i></div><div><h3>{{title}}</h3><p>{{body}}</p></div></article>{{/cards}}<div class="ech-about-intro-divider"><img src="/cms-themes/sawso/salvation-army-shield.svg" alt="" role="presentation"></div></div></section></div>',
      [
        text('heading', 'Heading', 'A community of purpose in action.'),
        text('kicker', 'Section label', 'About us'),
        text('intro', 'Introduction', movement),
        group(
          'cards',
          'Statements',
          [icon, text('title', 'Statement title', ''), text('body', 'Statement text', '')],
          statements,
          2,
        ),
      ],
    ),
    variant(
      'who',
      'Text and photo collage · Echelon',
      'Explain who Echelon is with three Media photos and focus points, three paragraphs and a normal destination button.',
      '<div class="echelon-template"><section class="ech-panel ech-about"><div class="ech-about-collage"><div class="ech-collage-tall">{{portrait}}</div><div class="ech-collage-small">{{photo_two}}</div><div class="ech-collage-small">{{photo_three}}</div></div><div class="ech-about-copy"><p class="volunteer-kicker">{{kicker}}</p><h2>{{heading}}</h2><p class="ech-muted">{{paragraph_one}}</p><p class="ech-muted">{{paragraph_two}}</p><p class="ech-muted">{{paragraph_three}}</p><div class="ech-about-cta">{{action}}</div></div></section></div>',
      [
        text('heading', 'Heading', 'A connected community with a shared purpose.'),
        text('kicker', 'Section label', 'Who we are'),
        photo('portrait', 'Tall photo'),
        photo('photo_two', 'Top photo'),
        photo('photo_three', 'Bottom photo'),
        text(
          'paragraph_one',
          'First paragraph',
          'Our chapter brings together emerging professionals in our local community to make a real difference. We volunteer side by side, host social gatherings, and organize fundraising efforts that support The Salvation Army’s work close to home.',
        ),
        text(
          'paragraph_two',
          'Second paragraph',
          'Whether you’re new to the area or a longtime local, Echelon is a place to meet like-minded people, build lasting friendships, and turn compassion into action — together.',
        ),
        text(
          'paragraph_three',
          'Third paragraph',
          'Along the way, our members grow as leaders and discover what it means to be part of something bigger than themselves, a movement of hope that reaches far beyond our own neighborhood.',
        ),
        {
          id: 'action',
          kind: 'button',
          label: 'Button',
          constraints: { sourceSample: { label: 'Explore chapter events →', url: '#ech-demo-events' } },
        },
      ],
    ),
    variant(
      'pillars',
      'Three pillars · Echelon',
      'Present Service, Fellowship and Fundraising in the shared Echelon layout with editable icon cards and highlight bars.',
      '<div class="echelon-template"><section class="ech-panel ech-purpose"><p class="volunteer-kicker">{{kicker}}</p><h2>{{heading}}</h2><p class="ech-purpose-intro">{{intro}}</p><div class="ech-purpose-grid">{{#cards}}<div class="ech-benefit"><i>{{icon}}</i><div><span class="ech-pillar-label">{{label}}</span><h3>{{title}}</h3><p>{{body}}</p></div></div>{{/cards}}</div></section></div>',
      [
        text('heading', 'Heading', 'Our local efforts'),
        text('kicker', 'Section label', 'What we do'),
        text(
          'intro',
          'Introduction',
          'Our vision is to mobilize the next generation with meaningful connections and opportunities to serve. We work alongside local Salvation Army programs, raise awareness of their work and help support ongoing community needs.',
        ),
        group(
          'cards',
          'Pillars',
          [icon, text('label', 'Pillar name', ''), text('title', 'Card title', ''), text('body', 'Card text', '')],
          pillars,
          3,
        ),
      ],
    ),
  ]
}
/** Assembly is shared by all template pages; callers supply site-owned Media. */
export function echelonBodyContent(
  kind: 'national' | 'chapter',
  definitions: readonly CorePageDefinition[],
  media: Record<string, unknown>,
) {
  for (const key of ['portrait', 'photo_two', 'photo_three'])
    if (!media[key]) throw new Error('Choose all three Echelon photos first.')
  const seeds = echelonBodyLibrary((slug, name, purpose, html, slots) => ({
    definition: {
      kind: 'legacy',
      slug: 'core-echelon-' + slug,
      name,
      category: 'National sections',
      changelog: 'Approved Echelon body field assembly.',
      sourceHtml: html,
      sourceCss: '',
      slots,
    },
    purpose,
    capabilities: {
      background: false,
      width: false,
      spacing: false,
      alignment: false,
      imagePosition: false,
      phoneOrder: false,
      buttonStyle: false,
    },
    samples: {},
  }))
  return seeds.map(entry => {
    const definition = definitions.find(def => def.slug === entry.definition.slug)
    if (!definition) throw new Error('Install the shared Echelon sections first.')
    const slots = entry.definition.kind === 'legacy' ? entry.definition.slots : [],
      values: Record<string, unknown> = {}
    for (const field of slots) {
      if (field.kind === 'repeat') {
        const item = field.constraints.item as { samples: Record<string, unknown>[] }
        values[field.id] = { items: item.samples.map((_, index) => 'i' + (index + 1)) }
        item.samples.forEach((row, index) => {
          for (const [key, value] of Object.entries(row)) values[field.id + '__i' + (index + 1) + '__' + key] = value
        })
      } else if (field.constraints.sourceSample !== undefined)
        values[field.id] = structuredClone(field.constraints.sourceSample)
    }
    if (entry.definition.slug === 'core-echelon-about') values.__cms_anchor = 'ech-demo-about-intro'
    if (entry.definition.slug === 'core-echelon-who') {
      values.__cms_anchor = 'ech-demo-about'
      for (const key of ['portrait', 'photo_two', 'photo_three']) if (media[key]) values[key] = media[key]
      if (kind === 'national') {
        values.paragraph_one =
          'Echelon brings together emerging professionals across the country to make a real difference in their local communities. We volunteer side by side, host social gatherings, and organize fundraising efforts that support The Salvation Army’s work close to home.'
        values.paragraph_three =
          'Through hands-on service, social gatherings and fundraising, our chapters bring people together to support their neighbors and learn about the needs of their communities.'
        values.action = { label: 'Find your chapter →', url: '#ech-demo-chapters' }
      }
    }
    if (entry.definition.slug === 'core-echelon-pillars') {
      values.__cms_anchor = 'ech-demo-participate'
      if (kind === 'national') {
        values.heading = 'Service. Fellowship. Fundraising.'
        values.intro =
          'Our vision is to mobilize the next generation with meaningful connections and opportunities to serve. Across the country, Echelon chapters work alongside local Salvation Army programs, raise awareness of their work and help support ongoing community needs.'
        values.cards__i3__body =
          'We bring people together to raise funds for local programs and new opportunities to serve their communities.'
      }
    }
    return {
      section_def_id: definition.id,
      section_def_version: definition.version,
      label: entry.definition.name,
      values,
    }
  })
}
