/** Approved public national leadership copy; photos must come from Echelon Media. */
import { sourceSampleValues, type SlotDef } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
import type { CorePageDefinition } from './core-templates.ts'
type Variant = (slug: string, name: string, purpose: string, html: string, fields: SlotDef[]) => CoreSection
const text = (id: string, label: string, value: string): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: { sourceSample: value },
})
const photo = { src: '/cms-samples/r8-landscape.png', alt: '[Replace with an Echelon photo]', decorative: false }
const council = [
  { name: 'Madilyn Maruna', role: 'Chair' },
  { name: 'Sebastian Galvez', role: 'Vice Chair' },
  { name: 'Cody Johnson', role: 'Developing Chapter Chair' },
  { name: 'Jake Brown', role: 'Strategic Initiatives Chair' },
]
export function echelonLeadershipLibrary(variant: Variant): readonly CoreSection[] {
  return [
    variant(
      'leadership',
      'Leadership · Echelon',
      'Introduce the national council with its group photo and separate editable portrait, name and role fields.',
      '<div class="echelon-template"><section class="ech-panel ech-pad"><div class="ech-section-head"><h2>{{heading}}</h2>{{council_link}}</div><div class="ech-lead-feature ech-gray"><div class="ech-lead-photo">{{photo}}</div><div class="ech-lead-copy"><h3>{{feature_heading}}</h3><p class="ech-muted">{{intro}}</p></div></div><div class="ech-roster ech-gray">{{#cards}}<article class="ech-person">{{portrait}}<div><h3>{{name}}</h3><p>{{role}}</p></div></article>{{/cards}}</div></section></div>',
      [
        {
          ...text('heading', 'Heading', 'Our leadership'),
          constraints: { sourceSample: 'Our leadership', echelonAudience: 'national' },
        },
        {
          id: 'council_link',
          kind: 'link',
          label: 'Council link',
          constraints: {
            sourceSample: {
              label: 'Meet the full council →',
              url: 'https://salvationarmyechelon.org/echelon/national-leadership',
              newTab: true,
            },
          },
        },
        { id: 'photo', kind: 'image', label: 'Council group photo', constraints: { sourceSample: photo } },
        text('feature_heading', 'Feature heading', 'People who help Echelon grow'),
        text(
          'intro',
          'Introduction',
          'Meet the people supporting our chapters and connecting emerging leaders through service.',
        ),
        {
          id: 'cards',
          kind: 'repeat',
          label: 'Council members',
          constraints: {
            item: {
              unit: 'Council member',
              min: 0,
              max: 48,
              fields: [
                { id: 'portrait', kind: 'image', label: 'Portrait', constraints: {} },
                { id: 'name', kind: 'text', label: 'Name', constraints: {} },
                { id: 'role', kind: 'text', label: 'Role', constraints: {} },
              ],
              samples: council.map(row => ({ ...row, portrait: photo })),
            },
          },
        },
      ],
    ),
  ]
}
export function echelonLeadershipContent(definitions: readonly CorePageDefinition[], media: Record<string, unknown>) {
  for (const key of ['photo', 'portrait_one', 'portrait_two', 'portrait_three', 'portrait_four'])
    if (!media[key]) throw new Error('Choose the council group photo and all four portraits first.')
  const entry = echelonLeadershipLibrary((slug, name, purpose, html, slots) => ({
    definition: {
      kind: 'legacy',
      slug: 'core-echelon-' + slug,
      name,
      category: 'National sections',
      changelog: 'Approved national leadership fields.',
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
  }))[0]!
  const definition = definitions.find(def => def.slug === entry.definition.slug)
  if (!definition) throw new Error('Install the shared Echelon sections first.')
  const values = sourceSampleValues(entry.definition.kind === 'legacy' ? entry.definition.slots : [])
  values.__cms_anchor = 'ech-demo-leadership'
  values.photo = media.photo
  ;['portrait_one', 'portrait_two', 'portrait_three', 'portrait_four'].forEach((key, index) => {
    values['cards__i' + (index + 1) + '__portrait'] = media[key]
  })
  return {
    section_def_id: definition.id,
    section_def_version: definition.version,
    label: entry.definition.name,
    values,
  }
}
