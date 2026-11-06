import { echelonNationalStoriesLibrary } from './echelon-national-stories.ts'
/** Approved echelon-reference split hero and jump links; ordinary versioned sections.
 * Layout comes from chapter-page.css final override; pictures remain Media fields.
 * These are Echelon variants of Split hero and On-page navigation, not page code. */
import { echelonEngagementLibrary } from './echelon-engagement.ts'
import { echelonLeadershipLibrary } from './echelon-leadership.ts'
import { echelonBoardContactsLibrary } from './echelon-board-contacts.ts'
import { echelonFaqContactLibrary } from './echelon-faq-contact.ts'
import { echelonBodyLibrary } from './echelon-body-library.ts'
import { sourceSampleValues, MATERIAL_ICON_PRESENTATION, type SlotDef } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
const text = (id: string, label: string, value: string): SlotDef => ({
  id,
  kind: 'text',
  label,
  constraints: { sourceSample: value },
})
const picture = (id: string, label: string): SlotDef => ({
  id,
  kind: 'image',
  label,
  constraints: {
    sourceSample: { src: '/cms-samples/r8-landscape.png', alt: '[Replace with an Echelon photo]', decorative: false },
  },
})
const button = (id: string, label: string, caption: string, url: string): SlotDef => ({
  id,
  kind: 'button',
  label,
  constraints: { sourceSample: { label: caption, url } },
})
const caps = {
  background: false,
  width: false,
  spacing: false,
  alignment: false,
  imagePosition: false,
  phoneOrder: false,
  buttonStyle: false,
}
function variant(slug: string, name: string, purpose: string, html: string, fields: SlotDef[]): CoreSection {
  const slots = fields.map((field, index) =>
    index
      ? field
      : {
          ...field,
          constraints: {
            ...field.constraints,
            coreCapabilities: caps,
            corePurpose: purpose,
            coreLibrary: 'r8',
            echelonTemplate: true,
          },
        },
  )
  return {
    definition: {
      kind: 'legacy',
      slug: 'core-echelon-' + slug,
      name,
      category: 'National sections',
      sourceHtml: html,
      sourceCss: '.echelon-opener,.echelon-jump{box-sizing:border-box}',
      slots,
      changelog: 'Approved Echelon template variant; existing page versions stay pinned.',
    },
    purpose,
    capabilities: caps,
    samples: sourceSampleValues(slots),
  }
}
const mission =
  'Echelon connects emerging professionals with The Salvation Army through networking, community engagement, and fundraising.'
export const ECHELON_LIBRARY: readonly CoreSection[] = [
  variant(
    'hero',
    'Split hero · Echelon',
    'Introduce the Echelon national or chapter page with a visible logo, navy text panel and separate photo.',
    '<section class="echelon-opener"><div class="echelon-opener-photo">{{photo}}</div><div class="echelon-opener-copy"><div class="echelon-opener-logo">{{logo}}</div><h1>{{heading}}</h1><h2>{{tagline}}</h2><p>{{intro}}</p><div class="echelon-opener-actions"><span>{{primary}}</span><span>{{secondary}}</span></div></div></section>',
    [
      text('heading', 'Page title', 'Echelon'),
      text('tagline', 'Tagline', 'Mobilizing the next generation'),
      text('intro', 'Introduction', mission),
      picture('logo', 'Echelon logo'),
      picture('photo', 'Hero photo'),
      button('primary', 'Main button', 'Find a chapter', '#ech-demo-chapters'),
      button('secondary', 'Second button', 'Join us', '#ech-demo-contact'),
    ],
  ),
  variant(
    'jump-links',
    'On-page navigation · Echelon',
    'Jump directly to the visible national or chapter sections, with the approved highlight bar and Material Symbols.',
    '<section class="echelon-page-navigation"><nav class="echelon-social" aria-label="Echelon social media" data-links-from="{{accounts_from}}">{{#social}}{{action}}{{/social}}</nav><nav class="echelon-jump" aria-label="On this page">{{#links}}<div class="echelon-jump-item"><span class="echelon-jump-icon">{{icon}}</span>{{action}}</div>{{/links}}</nav></section>',
    [
      {
        id: 'accounts_from',
        kind: 'text',
        label: 'Social accounts from',
        constraints: { siteSocialAccounts: true, siteSocialGroup: 'social', sourceSample: 'own' },
      },
      {
        id: 'social',
        kind: 'repeat',
        label: 'Social accounts',
        constraints: {
          item: {
            unit: 'Social account',
            min: 0,
            max: 6,
            fields: [{ id: 'action', kind: 'link', label: 'Account', constraints: {} }],
            samples: [],
          },
        },
      },
      {
        id: 'links',
        kind: 'repeat',
        label: 'Page links',
        constraints: {
          item: {
            unit: 'Page link',
            min: 0,
            max: 12,
            fields: [
              { id: 'icon', kind: 'text', label: 'Icon', constraints: { presentation: MATERIAL_ICON_PRESENTATION } },
              { id: 'action', kind: 'link', label: 'Goes to' },
            ],
            samples: [
              { icon: 'map-pin', action: { label: 'Chapters', url: '#ech-demo-chapters' } },
              { icon: 'users', action: { label: 'Who we are', url: '#ech-demo-about' } },
              { icon: 'heart', action: { label: 'What we do', url: '#ech-demo-participate' } },
              { icon: 'users', action: { label: 'Leadership', url: '#ech-demo-leadership' } },
              { icon: 'info', action: { label: 'FAQ', url: '#ech-demo-faq' } },
              { icon: 'mail', action: { label: 'Contact', url: '#ech-demo-contact' } },
            ],
          },
        },
      },
    ],
  ),
  variant(
    'directory',
    'Chapter directory · Echelon',
    'Find published Echelon chapters on the approved US map or through the searchable native list, with links that work without JavaScript.',
    '<div class="echelon-template"><section class="ech-panel ech-pad ech-directory-section"><div class="ech-directory-heading"><h2>{{heading}}</h2><p class="ech-muted">{{intro}}</p></div>{{directory}}</section></div>',
    [
      {
        ...text('heading', 'Heading', 'Find your Echelon chapter'),
        constraints: { sourceSample: 'Find your Echelon chapter', echelonAudience: 'national' },
      },
      text('intro', 'Introduction', 'Choose a chapter to explore local opportunities and get connected.'),
      {
        id: 'directory',
        kind: 'text',
        label: 'Published chapter map and list',
        constraints: { siteWidget: 'chapter-directory', echelonDirectory: true, echelonAudience: 'national' },
      },
    ],
  ),
  ...echelonNationalStoriesLibrary(variant),
  ...echelonBodyLibrary(variant),
  ...echelonFaqContactLibrary(variant),
  ...echelonBoardContactsLibrary(variant),
  ...echelonLeadershipLibrary(variant),
  ...echelonEngagementLibrary(variant),
]
export const ECHELON_TEMPLATE_INTRO = mission
