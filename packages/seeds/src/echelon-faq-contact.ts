/** Approved Echelon FAQ/contact variants; normal fields and the existing contact endpoint. */
import { sourceSampleValues, MATERIAL_ICON_PRESENTATION, type SlotDef } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
import type { CorePageDefinition } from './core-templates.ts'
type Variant = (slug: string, name: string, purpose: string, html: string, fields: SlotDef[]) => CoreSection
const text = (id: string, label: string, value: string): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: { sourceSample: value, multiline: ['heading', 'intro'].includes(id) },
})
const questions = [
  {
    question: 'What is Echelon?',
    answer:
      '<p>Echelon is the emerging professionals’ movement of The Salvation Army. It connects developing leaders with opportunities to build community and support The Salvation Army’s work.</p>',
  },
  {
    question: 'What does Echelon do?',
    answer:
      '<p>Echelon brings people together through networking, fundraising, and service. Chapters support Salvation Army programs and respond to needs in their local communities.</p>',
  },
  {
    question: 'How can I get involved with this chapter?',
    answer:
      '<p>Explore our <a href="#ech-demo-events">chapter events</a> and contact the <a href="#ech-local-contact-title">membership chair</a> with questions about joining, volunteering or taking part in an activity.</p>',
  },
  {
    question: 'Who should I contact with a question?',
    answer:
      '<p>Our <a href="#ech-local-contact-title">chapter contacts</a> can help you find the right person. Reach out to the membership chair for chapter inquiries, the president about chapter leadership, or the staff liaison about local Salvation Army service and partnerships.</p>',
  },
]
export function echelonFaqContactLibrary(variant: Variant): readonly CoreSection[] {
  return [
    variant(
      'faq',
      'FAQ · Echelon',
      'Answer Echelon questions with normal editable text and native one-at-a-time disclosure, including without JavaScript.',
      '<div class="echelon-template"><section class="ech-panel ech-faq"><div class="ech-faq-heading"><p class="volunteer-kicker">{{kicker}}</p><h2>{{heading}}</h2><p>{{intro}}</p></div><div class="ech-faq-list">{{#questions}}<details class="ech-faq-item" name="echelon-faq"><summary>{{question}}</summary><div>{{answer}}</div></details>{{/questions}}</div></section></div>',
      [
        text('heading', 'Heading', 'A few things you might be wondering.'),
        text('kicker', 'Section label', 'Frequently asked questions'),
        text(
          'intro',
          'Introduction',
          'Find your place in a community built around fellowship, fundraising and service.',
        ),
        {
          id: 'questions',
          kind: 'repeat',
          label: 'Questions',
          constraints: {
            item: {
              unit: 'Question',
              min: 0,
              max: 20,
              fields: [
                { id: 'question', kind: 'text', label: 'Question', constraints: {} },
                { id: 'answer', kind: 'richtext', label: 'Answer', constraints: {} },
              ],
              samples: questions,
            },
          },
        },
      ],
    ),
    variant(
      'contact',
      'Contact panel and form · Echelon',
      'Invite Echelon inquiries through the existing required-field contact form, with an editable navy panel and normal links.',
      '<div class="echelon-template"><section class="ech-panel ech-contact"><div class="ech-navy ech-contact-intro"><div class="ech-contact-brand"><img src="/cms-themes/sawso/salvation-army-shield.svg" alt="The Salvation Army"><div><strong>{{brand}}</strong><span>{{level}}</span></div></div><h2>{{heading}}</h2><p>{{intro}}</p><ul class="ech-contact-benefits">{{#benefits}}<li><i>{{icon}}</i><span>{{text}}</span></li>{{/benefits}}</ul><p class="ech-contact-tagline">{{tagline}}</p></div><div class="ech-pad">{{widget}}<div class="ech-contact-note"><p>{{resource_intro}} {{resource}}</p></div></div></section></div>',
      [
        text('heading', 'Heading', 'Get involved\nwith Echelon'),
        text('brand', 'Organisation name', 'Echelon'),
        text('level', 'Page label', 'Our chapter'),
        text('intro', 'Introduction', 'Ask about membership, volunteering or connecting with a chapter.'),
        {
          id: 'benefits',
          kind: 'repeat',
          label: 'Ways to get involved',
          constraints: {
            item: {
              unit: 'Line',
              min: 0,
              max: 3,
              fields: [
                { id: 'icon', kind: 'text', label: 'Icon', constraints: { presentation: MATERIAL_ICON_PRESENTATION } },
                { id: 'text', kind: 'text', label: 'Text', constraints: {} },
              ],
              samples: [
                { icon: 'users', text: 'Build community' },
                { icon: 'heart', text: 'Make an impact' },
                { icon: 'map-pin', text: 'Connect with our chapter' },
              ],
            },
          },
        },
        text('tagline', 'Tagline', 'People  |  Purpose  |  Possibilities'),
        {
          id: 'widget',
          kind: 'text',
          label: 'Contact form',
          constraints: { siteWidget: 'contact-form', echelonContact: true },
        },
        text('resource_intro', 'Words before resource link', 'Looking for chapter resources?'),
        {
          id: 'resource',
          kind: 'link',
          label: 'Resource link',
          constraints: { sourceSample: { label: 'Visit Learn →', url: 'https://learn.salvationarmy.org/' } },
        },
      ],
    ),
  ]
}
export function echelonFaqContactContent(kind: 'national' | 'chapter', definitions: readonly CorePageDefinition[]) {
  const sections = echelonFaqContactLibrary((slug, name, purpose, html, slots) => ({
    definition: {
      kind: 'legacy',
      slug: 'core-echelon-' + slug,
      name,
      category: 'National sections',
      changelog: 'Approved Echelon FAQ/contact fields.',
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
  return sections.map(entry => {
    const definition = definitions.find(def => def.slug === entry.definition.slug)
    if (!definition) throw new Error('Install the shared Echelon sections first.')
    const values = sourceSampleValues(entry.definition.kind === 'legacy' ? entry.definition.slots : [])
    if (entry.definition.slug === 'core-echelon-faq') {
      values.__cms_anchor = 'ech-demo-faq'
      if (kind === 'national') {
        values.questions__i3__question = 'Is there an Echelon chapter near me?'
        values.questions__i3__answer =
          '<p>Use our <a href="#ech-demo-chapters">chapter map and directory</a> to find a local chapter and visit its webpage. If you cannot find a chapter nearby, <a href="#ech-demo-contact">get in touch</a> to learn more.</p>'
        values.questions__i4__question = 'How can I get involved?'
        values.questions__i4__answer =
          '<p>Start by <a href="#ech-demo-chapters">finding your local chapter</a> and asking about membership, upcoming activities or ways to volunteer. You can also use the <a href="#ech-demo-contact">Get involved section</a> below to connect with Echelon.</p>'
      }
    } else {
      values.__cms_anchor = 'ech-demo-contact'
      if (kind === 'national') {
        values.level = 'National'
        values.benefits__i3__text = 'Find your local chapter'
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
