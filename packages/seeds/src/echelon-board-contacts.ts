/** Shared approved chapter contacts and board; all content stays in native fields. */
import { sourceSampleValues, markSampleValues, type SlotDef } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
import type { CorePageDefinition } from './core-templates.ts'
type Variant = (slug: string, name: string, purpose: string, html: string, fields: SlotDef[]) => CoreSection
const text = (id: string, label: string, value: string): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: { sourceSample: value, multiline: id === 'intro' },
})
const rich = (id: string, label: string, value: string): SlotDef => ({
  id,
  kind: 'richtext',
  label,
  constraints: { sourceSample: value },
})
const symbol = (name: string) => '<i><span class="cms-material-symbols" aria-hidden="true">' + name + '</span></i>'
export function echelonBoardContactsLibrary(variant: Variant): readonly CoreSection[] {
  return [
    variant(
      'chapter-contacts',
      'Chapter contacts · Echelon',
      'Show the chapter contacts and a named Membership Chair through ordinary editable text and email fields.',
      '<div class="echelon-template"><section class="ech-chapter-contact"><p class="volunteer-kicker">{{kicker}}</p><h2>{{heading}}</h2><p>{{intro}}</p><div class="ech-local-person">' +
        symbol('person') +
        '<div><strong>{{first_role}}</strong><span>{{first_detail}}</span></div></div><div class="ech-local-person">' +
        symbol('person') +
        '<div><strong>{{second_role}}</strong><span>{{second_detail}}</span></div></div><div class="ech-local-person">' +
        symbol('mail') +
        '<div><strong>{{inquiries}}</strong><span class="ech-contact-role">{{membership_role}}</span><span>{{name}}</span><div class="ech-person-email">{{email}}</div></div></div><div class="ech-contact-action">{{action}}</div></section></div>',
      [
        text('heading', 'Heading', 'Get in touch. Get involved.'),
        text('kicker', 'Section label', 'Connect with our chapter'),
        text('intro', 'Introduction', 'Reach out with questions or to learn more about upcoming events.'),
        text('first_role', 'First contact role', 'Chapter president'),
        text('first_detail', 'First contact helps with', 'Membership and ways to get involved'),
        text('second_role', 'Second contact role', 'Staff liaison'),
        text('second_detail', 'Second contact helps with', 'Local service and community partnerships'),
        text('inquiries', 'Inquiries heading', 'Chapter inquiries'),
        text('membership_role', 'Membership contact role', 'Membership Chair'),
        text('name', 'Membership chair name', '[Membership chair name]'),
        rich('email', 'Chapter email address', '<p>[Chapter email address]</p>'),
        {
          id: 'action',
          kind: 'button',
          label: 'Button',
          constraints: { sourceSample: { label: 'Get in touch →', url: '#ech-demo-contact' } },
        },
      ],
    ),
    variant(
      'board',
      'Chapter board · Echelon',
      'Introduce every chapter board member with an optional photo,name and role;long boards keep eight visible with native Show all.',
      '<div class="echelon-template"><section class="ech-panel ech-pad ech-board"><div class="ech-section-head"><div><p class="volunteer-kicker">{{kicker}}</p><h2>{{heading}}</h2></div>{{contact}}</div><p class="ech-muted">{{intro}}</p><div class="ech-board-grid">{{#cards}}<article class="ech-board-person"><div class="ech-board-portrait">{{photo}}<div class="ech-board-placeholder">' +
        symbol('person') +
        '</div></div><div class="ech-board-person-copy"><h3>{{name}}</h3><p>{{role}}</p></div></article>{{/cards}}</div><div class="ech-board-contact-note">' +
        symbol('mail') +
        '<div>{{note}}</div></div></section></div>',
      [
        text('heading', 'Heading', 'Meet our chapter board'),
        text('kicker', 'Section label', 'Our local leadership'),
        text(
          'intro',
          'Introduction',
          'Meet the volunteer leaders who help bring our chapter together through service, fellowship and fundraising.',
        ),
        {
          id: 'contact',
          kind: 'link',
          label: 'Contact link',
          constraints: { sourceSample: { label: 'Contact our chapter →', url: '#ech-local-contact-title' } },
        },
        {
          id: 'cards',
          kind: 'repeat',
          label: 'Board members',
          constraints: {
            boardCards: true,
            item: {
              unit: 'Board member',
              min: 0,
              max: 48,
              fields: [
                { id: 'photo', kind: 'image', label: 'Photo', constraints: {} },
                { id: 'name', kind: 'text', label: 'Name', constraints: {} },
                { id: 'role', kind: 'text', label: 'Role', constraints: {} },
              ],
              samples: ['Chapter president', 'Vice president', 'Secretary', 'Treasurer'].map(role => ({
                photo: '',
                name: '',
                role,
              })),
            },
          },
        },
        rich(
          'note',
          'Contact note',
          '<p>Interested in getting involved or speaking with a board member? <a href="#ech-local-contact-title">Use our shared chapter contact</a> and we’ll help you connect with the right person.</p>',
        ),
      ],
    ),
  ]
}
export function echelonBoardContactsContent(definitions: readonly CorePageDefinition[]) {
  const entries = echelonBoardContactsLibrary((slug, name, purpose, html, slots) => ({
    definition: {
      kind: 'legacy',
      slug: 'core-echelon-' + slug,
      name,
      category: 'National sections',
      changelog: 'Approved shared chapter fields.',
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
  return entries.map(entry => {
    const definition = definitions.find(def => def.slug === entry.definition.slug)
    if (!definition) throw new Error('Install the shared Echelon sections first.')
    const values = sourceSampleValues(entry.definition.kind === 'legacy' ? entry.definition.slots : [])
    values.__cms_anchor = entry.definition.slug === 'core-echelon-board' ? 'ech-demo-board' : 'ech-local-contact-title'
    if (entry.definition.slug === 'core-echelon-board') {
      values.__cms_board_display = 'first-eight'
      values.__cms_chapter_part = 'board'
    } else Object.assign(values, markSampleValues({ name: values.name, email: values.email }))
    return {
      section_def_id: definition.id,
      section_def_version: definition.version,
      label: entry.definition.name,
      values,
    }
  })
}
