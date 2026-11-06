/** Reusable report sections. Reviewed report content is imported into page drafts, never seeded here. */
import { sourceSampleValues, type SlotDef } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
import { REPORT_SECTION_CSS, REPORT_STORY_CSS, REPORT_LINKS_CSS } from './report-presentation.ts'
const text = (id: string, label: string, sample = ''): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: { sourceSample: sample },
})
const rich = (id: string, label: string, sample = ''): SlotDef => ({ ...text(id, label, sample), kind: 'richtext' })
const group = (
  id: string,
  label: string,
  unit: string,
  fields: SlotDef[],
  samples: Record<string, unknown>[],
): SlotDef => ({ id, kind: 'repeat', label, constraints: { item: { unit, min: 0, max: 48, fields, samples } } })
const caps = {
  background: false,
  width: false,
  spacing: false,
  alignment: false,
  imagePosition: false,
  phoneOrder: false,
  buttonStyle: false,
}
function report(
  slug: string,
  name: string,
  purpose: string,
  body: string,
  fields: SlotDef[],
  css = REPORT_SECTION_CSS,
): CoreSection {
  if (slug !== 'page-links') {
    fields = [...fields, text('page_link_label', 'Page link label')]
    body += '<span class="report-page-link-label" hidden>{{page_link_label}}</span>'
  }
  const slots = fields.map((field, index) =>
    index
      ? field
      : {
          ...field,
          constraints: {
            ...field.constraints,
            annualReport: true,
            coreCapabilities: caps,
            corePurpose: purpose,
            coreLibrary: 'r8',
          },
        },
  )
  return {
    definition: {
      kind: 'legacy',
      slug: 'core-report-' + slug,
      name,
      category: 'National sections',
      sourceHtml: '<div class="sawso-report ar-direction-4">' + body + '</div>',
      sourceCss: css,
      slots,
      changelog: 'Shared report layout with native editable fields and no page code.',
    },
    purpose,
    capabilities: caps,
    samples: sourceSampleValues(slots),
  }
}
const rowFields = [
  text('label', 'Row label'),
  text('amount', 'Amount'),
  {
    ...text('kind', 'Row type', 'ordinary'),
    constraints: {
      sourceSample: 'ordinary',
      choices: [
        { value: 'ordinary', label: 'Amount' },
        { value: 'total', label: 'Total' },
        { value: 'group', label: 'Group heading' },
      ],
    },
  },
]
const table = (groupId: string, title: string) =>
  '<table class="ar-statement"><caption>{{' +
  title +
  '}}</caption><tbody>{{#' +
  groupId +
  '}}<tr class="ar-{{kind}}"><th scope="row">{{label}}</th><td>{{amount}}</td></tr>{{/' +
  groupId +
  '}}</tbody></table>'
export const REPORT_LIBRARY: readonly CoreSection[] = [
  report(
    'letters',
    'Letters with full message',
    'Present reviewed letters side by side, with photos, introductions and messages that open without JavaScript.',
    '<section class="ar-band ar-report-letters"><div class="ar-container"><h2 class="ar-section-title">{{heading}}</h2><div class="ar-letters">{{#letters}}<article class="ar-letter"><div class="ar-letter-head"><figure class="ar-leader-photo">{{photo}}</figure><div><h3>{{name}}</h3><div class="ar-role">{{role}}</div></div></div><p>{{intro}}</p><details class="ar-read-more"><summary>{{open_label}}</summary>{{message}}</details></article>{{/letters}}</div><p class="ar-small ar-source">{{source}}</p></div></section>',
    [
      text('heading', 'Heading', '[Letters]'),
      group(
        'letters',
        'Letters',
        'Letter',
        [
          { id: 'photo', kind: 'image', label: 'Photo', constraints: {} },
          text('name', 'Name'),
          rich('role', 'Role and organization'),
          text('intro', 'Introduction'),
          rich('message', 'Full message'),
          text('open_label', 'Open message label', 'Read the full message'),
        ],
        [
          {
            photo: '',
            name: '[Name]',
            role: '<p>[Role and organization]</p>',
            intro: '[Introduction]',
            message: '<p>[Full message]</p>',
            open_label: 'Read the full message',
          },
        ],
      ),
      text('source', 'Source line', '[Source]'),
    ],
  ),
  report(
    'financial',
    'Financial summary',
    'Edit expense bars,revenue and both financial statements as named rows;disclosures work without JavaScript.',
    [
      '<section class="ar-band ar-financial-clean"><div class="ar-container"><h2 class="ar-section-title">{{heading}',
      '}',
      '</h2><p class="ar-lead">{{period}',
      '}',
      '</p><div class="ar-financial-grid"><div><h3>{{expenses_heading}',
      '}',
      '</h3><div class="ar-expenses">{{#expenses}',
      '}',
      '<div class="ar-expense"><div class="ar-expense-label"><span>{{label}',
      '}',
      '</span><strong>{{amount}',
      '}',
      '</strong></div><div aria-hidden="true" class="ar-track"><span class="ar-fill" data-report-expense="true"></span></div></div>{{/expenses}',
      '}',
      '</div></div><div><div class="ar-revenue"><h3>{{revenue_heading}',
      '}',
      '</h3><div class="ar-revenue-row"><div aria-hidden="true" class="ar-donut" data-report-revenue="true"></div><div class="ar-revenue-values">{{#revenue}',
      '}',
      '<p><strong>{{amount}',
      '}',
      '</strong>{{label}',
      '}',
      '</p>{{/revenue}',
      '}',
      '</div></div></div>',
    ].join('') +
      table('position', 'position_heading') +
      '</div></div><details class="ar-financial-disclosure"><summary>{{activities_label}}</summary><div class="ar-activity-table">' +
      table('activities', 'activities_heading') +
      '</div></details><p class="ar-small ar-source">{{source}}</p></div></section>',
    [
      text('heading', 'Heading', 'Financial summary'),
      text('period', 'Reporting period', '[Reporting period]'),
      text('expenses_heading', 'Expenses heading', 'Expenses by Program'),
      group(
        'expenses',
        'Expenses',
        'Expense',
        [text('label', 'Program'), text('amount', 'Amount')],
        [{ label: '[Program]', amount: '0' }],
      ),
      text('revenue_heading', 'Revenue heading', 'Revenue'),
      group(
        'revenue',
        'Revenue',
        'Revenue row',
        [text('label', 'Revenue source'), text('amount', 'Amount')],
        [{ label: '[Revenue source]', amount: '0' }],
      ),
      text('position_heading', 'Position statement heading', 'STATEMENT OF FINANCIAL POSITION'),
      group('position', 'Financial position', 'Statement row', rowFields, [
        { label: '[Row label]', amount: '0', kind: 'ordinary' },
      ]),
      text('activities_label', 'Open activities label', 'View the statement of financial activities'),
      text('activities_heading', 'Activities statement heading', 'STATEMENT OF FINANCIAL ACTIVITIES'),
      group('activities', 'Financial activities', 'Statement row', rowFields, [
        { label: '[Row label]', amount: '0', kind: 'ordinary' },
      ]),
      text('source', 'Source line', '[Source]'),
    ],
  ),

  report(
    'country-story',
    'Country story with stats',
    'Present a country story, photo, editable impact numbers and source using a reviewed response, feature or reading layout.',
    [
      '<section class="ar-band ar-country-section" data-report-layout="{{layout}}"><div class="ar-container"><h2 class="ar-section-title">{{heading}',
      '}',
      '</h2><article class="ar-country-story"><div class="ar-country-grid"><div class="ar-feature-heading"><p class="ar-eyebrow">{{country}',
      '}',
      '</p><h3>{{title}',
      '}',
      '</h3></div><figure class="ar-story-figure"><div class="ar-photo">{{photo}',
      '}',
      '</div><div class="ar-photo-note ar-caption">{{photo_note}',
      '}',
      '</div></figure><div class="ar-copy">{{body}',
      '}',
      '</div><h3 class="ar-stats-heading">{{stats_heading}',
      '}',
      '</h3><div class="ar-stat-grid">{{#stats}',
      '}',
      '<div class="ar-stat"><p>{{before}',
      '}',
      '<strong class="ar-stat-number">{{value}',
      '}',
      '</strong>{{after}',
      '}',
      '</p></div>{{/stats}',
      '}',
      '</div><div class="ar-after-stats">{{after_stats}',
      '}',
      '</div></div><div class="ar-story-body">{{continuation}',
      '}',
      '</div><div class="ar-program-impact"><div><h3>{{impact_heading}',
      '}',
      '</h3><div class="ar-stat"><p>{{impact_before}',
      '}',
      '<strong class="ar-stat-number">{{impact_value}',
      '}',
      '</strong>{{impact_after}',
      '}',
      '</p></div></div><div class="ar-report-list">{{impact}',
      '}',
      '</div></div><aside class="ar-discover"><div><h3>{{action_heading}',
      '}',
      '</h3><div>{{action_text}',
      '}',
      '</div></div>{{action}',
      '}',
      '</aside></article><p class="ar-small ar-source">{{source}',
      '}',
      '</p></div></section>',
    ].join(''),
    [
      text('heading', 'Section heading'),
      {
        ...text('layout', 'Story layout', 'feature'),
        constraints: {
          sourceSample: 'feature',
          presentation: true,
          choices: [
            { value: 'response', label: 'Response with stats' },
            { value: 'feature', label: 'Photo and story' },
            { value: 'reading', label: 'Reading story' },
            { value: 'text', label: 'Text and facts' },
          ],
        },
      },
      text('country', 'Country or introduction', '[Country]'),
      text('title', 'Story title', '[Story title]'),
      { id: 'photo', kind: 'image', label: 'Photo', constraints: {} },
      rich('photo_note', 'Photo caption'),
      rich('body', 'Story', '<p>[Story text]</p>'),
      text('stats_heading', 'Stats heading'),
      group(
        'stats',
        'Story stats',
        'Stat',
        [text('before', 'Before the number'), text('value', 'Number'), text('after', 'After the number')],
        [],
      ),
      rich('after_stats', 'After the story numbers'),
      rich('continuation', 'After the stats'),
      text('impact_heading', 'Impact heading'),
      text('impact_before', 'Before the impact number'),
      text('impact_value', 'Impact number'),
      text('impact_after', 'After the impact number'),
      rich('impact', 'Impact list'),
      text('action_heading', 'Related story heading'),
      rich('action_text', 'Related story text'),
      { id: 'action', kind: 'button', label: 'Related story link', constraints: {} },
      text('source', 'Source line', '[Source]'),
    ],
    REPORT_SECTION_CSS + REPORT_STORY_CSS,
  ),
  report(
    'regions',
    'Region lists with View all',
    'Present a photo and introduction with expandable regional country lists that remain available without JavaScript.',
    '<section class="ar-band ar-region-section"><div class="ar-container"><div class="ar-global-cover"><figure class="ar-photo">{{photo}}</figure><h2>{{heading}}</h2><p>{{intro}}</p></div><details class="ar-country-disclosure"><summary>{{open_label}}</summary><div class="ar-regions">{{#regions}}<div><h3>{{title}}</h3>{{countries}}</div>{{/regions}}</div></details><p class="ar-small ar-source">{{source}}</p></div></section>',
    [
      text('heading', 'Heading', '[Global presence]'),
      text('intro', 'Introduction', '[Introduction]'),
      { id: 'photo', kind: 'image', label: 'Photo', constraints: {} },
      text('open_label', 'Open list label', 'View all countries'),
      group(
        'regions',
        'Regions',
        'Region',
        [text('title', 'Region'), rich('countries', 'Countries')],
        [{ title: '[Region]', countries: '<ul><li>[Country]</li></ul>' }],
      ),
      text('source', 'Source line', '[Source]'),
    ],
    REPORT_SECTION_CSS + REPORT_STORY_CSS,
  ),

  report(
    'page-links',
    'Page links bar',
    'Help visitors jump to the named sections of a report, with a native expandable phone list.',
    '<section class="ar-page-links"><nav class="ar-jump" aria-label="On this page">{{#links}}{{action}}{{/links}}</nav><details class="ar-mobile-jump"><summary>{{mobile_label}}</summary><div data-report-links-copy="true"></div></details></section>',
    [
      text('mobile_label', 'Phone list label', 'Explore the report'),
      group(
        'links',
        'Page sections',
        'Section',
        [{ id: 'action', kind: 'link', label: 'Section link', constraints: {} }],
        [],
      ),
    ],
    REPORT_LINKS_CSS,
  ),
]
