/** Reviewed chapter event examples and social links; no separate Events screen. */
import { sourceSampleValues, markSampleValues, type SlotDef } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
import type { CorePageDefinition } from './core-templates.ts'
type Variant = (slug: string, name: string, purpose: string, html: string, fields: SlotDef[]) => CoreSection
const text = (id: string, label: string, value: string): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: { sourceSample: value },
})
const examples = [
  {
    date: '2026-10-17',
    title: 'Community service morning',
    tag: 'Service',
    intro: 'Join us as we serve our neighbors through a local community project.',
  },
  {
    date: '2026-11-07',
    title: 'Meet Echelon',
    tag: 'Fellowship',
    intro: 'Meet other young adults and learn how to get involved with our chapter.',
  },
  {
    date: '2026-12-05',
    title: 'Kettle Takeover',
    tag: 'Fundraising',
    intro: 'Support The Salvation Army’s Christmas campaign at a local kettle.',
  },
].map(row => ({
  ...row,
  details: '<p>Contact the chapter for the time, meeting place and registration information.</p>',
}))
export function echelonEngagementLibrary(variant: Variant): readonly CoreSection[] {
  return [
    variant(
      'events',
      'Event list · Echelon',
      'Keep chapter event dates, titles, categories, introductions and expanded details in an ordinary repeating list.',
      '<div class="echelon-template"><section class="ech-national-agenda"><p class="volunteer-kicker">{{kicker}}</p><div class="ech-agenda-heading"><h2>{{heading}}</h2>{{contact}}</div><p class="ech-agenda-note">{{sample_note}}</p><div class="ech-agenda-list">{{#events}}<article class="ech-agenda-event"><div class="ech-agenda-date">{{date}}</div><div class="ech-agenda-copy"><h3>{{title}}</h3><span class="ech-agenda-tag">{{tag}}</span><p>{{intro}}</p></div><details class="ech-agenda-details"><summary>Event details <span aria-hidden="true">+</span></summary><div>{{details}}</div></details></article>{{/events}}</div></section></div>',
      [
        {
          ...text('heading', 'Heading', 'What’s coming up'),
          constraints: { sourceSample: 'What’s coming up', echelonAudience: 'chapter' },
        },
        text('kicker', 'Section label', 'Events'),
        {
          id: 'contact',
          kind: 'link',
          label: 'Contact link',
          constraints: { sourceSample: { label: 'Contact our chapter →', url: '#ech-demo-contact' } },
        },
        text('sample_note', 'Sample note (remove after replacing examples)', 'Sample events'),
        {
          id: 'events',
          kind: 'repeat',
          label: 'Events',
          constraints: {
            item: {
              unit: 'Event',
              min: 0,
              max: 48,
              fields: [
                { id: 'title', kind: 'text', label: 'Event title', constraints: {} },
                {
                  id: 'date',
                  kind: 'text',
                  label: 'Event date',
                  constraints: { presentation: 'cms-date-calendar-v1' },
                },
                { id: 'tag', kind: 'text', label: 'Event category', constraints: {} },
                { id: 'intro', kind: 'text', label: 'Short description', constraints: { multiline: true } },
                { id: 'details', kind: 'richtext', label: 'Event details', constraints: {} },
              ],
              samples: examples,
            },
          },
        },
      ],
    ),
    variant(
      'follow',
      'Social links · Echelon',
      'Show chapter social links or the saved site accounts, using normal destination controls and the existing central account settings.',
      '<div class="echelon-template"><section class="ech-agenda-social"><div><h3>{{heading}}</h3><p>{{intro}}</p><p class="ech-agenda-note">{{sample_note}}</p></div><nav class="ech-social-placeholders" aria-label="Chapter social media" data-links-from="{{accounts_from}}">{{#links}}{{action}}{{/links}}</nav></section></div>',
      [
        {
          ...text('heading', 'Heading', 'Follow our chapter'),
          constraints: { sourceSample: 'Follow our chapter', echelonAudience: 'chapter' },
        },
        text('intro', 'Introduction', 'Stay up to date on events and service opportunities.'),
        text('sample_note', 'Sample note (remove after replacing examples)', 'Sample social links'),
        {
          id: 'accounts_from',
          kind: 'text',
          label: 'Links from',
          constraints: {
            siteSocialAccounts: true,
            sourceSample: 'own',
            choices: [
              { value: 'own', label: 'This chapter' },
              { value: 'site', label: 'Site social accounts' },
            ],
          },
        },
        {
          id: 'links',
          kind: 'repeat',
          label: 'Social links',
          constraints: {
            item: {
              unit: 'Social link',
              min: 0,
              max: 12,
              fields: [{ id: 'action', kind: 'link', label: 'Social account', constraints: {} }],
              samples: ['Facebook', 'Instagram', 'LinkedIn'].map(label => ({ action: { label, url: '#' } })),
            },
          },
        },
      ],
    ),
  ]
}
export function echelonEngagementContent(
  definitions: readonly CorePageDefinition[],
  accountsFrom: 'own' | 'site' = 'own',
) {
  const entries = echelonEngagementLibrary((slug, name, purpose, html, slots) => ({
    definition: {
      kind: 'legacy',
      slug: 'core-echelon-' + slug,
      name,
      category: 'National sections',
      changelog: 'Reviewed chapter event and social fields.',
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
    const events = entry.definition.slug === 'core-echelon-events'
    const prefix = events ? 'events' : 'links'
    Object.assign(
      values,
      markSampleValues(
        Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => key === prefix || key.startsWith(prefix + '__') || key === 'sample_note',
          ),
        ),
      ),
    )
    values.__cms_chapter_part = events ? 'events' : 'social'
    if (events) values.__cms_anchor = 'ech-demo-events'
    else {
      values.accounts_from = accountsFrom
      if (accountsFrom === 'site') values.sample_note = ''
    }
    return {
      section_def_id: definition.id,
      section_def_version: definition.version,
      label: entry.definition.name,
      values,
    }
  })
}
