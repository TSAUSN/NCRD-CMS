/** The three supplied national reference teasers; full article text is not in the local reference. */
import type { SlotDef } from '@cms/schema'
import type { CoreSection } from './core-library.ts'
type Variant = (slug: string, name: string, purpose: string, html: string, fields: SlotDef[]) => CoreSection
const ECHELON_NATIONAL_STORIES = [
  {
    title: 'Leading through others',
    summary: 'Col. Michele Matthews on helping Echelon grow across the country.',
    url: 'https://salvationarmyechelon.org/echelon/news/leading-through-others-col-michele-matthews-journey-with-echelon',
    photoKey: 'd7ce8468-b3b0-46ab-b972-5a3fa76a2cbc',
  },
  {
    title: 'A day of service. A lasting impact.',
    summary: 'Echelon members help prepare Camp Wonderland for the summer.',
    url: 'https://salvationarmyechelon.org/echelon/news/a-day-of-service-a-lasting-impact-at-camp-wonderland',
    photoKey: '0fe94d80-2cd2-4306-a0cc-e80080f82dcf',
  },
  {
    title: 'A legacy of service',
    summary: 'Meet Katie Sopic and discover the story behind her work with Echelon Chicago.',
    url: 'https://salvationarmyechelon.org/echelon/news/katie-sopics-story-of-how-she-came-to-lead-an-echelon-chapter',
    photoKey: '0ade5055-083b-4fb1-84af-9fef21c5ec3a',
  },
] as const
export function echelonNationalStoriesLibrary(variant: Variant): readonly CoreSection[] {
  return [
    variant(
      'stories',
      'Image link cards · Echelon',
      'Show the three national community stories with described Media and normal story destinations;never available on chapter pages.',
      '<div class="echelon-template"><section class="ech-panel ech-pad"><div class="ech-section-head"><h2>{{heading}}</h2>{{more}}</div><div class="ech-cards">{{#cards}}<article class="ech-story"><div class="ech-story-photo">{{photo}}</div><div class="ech-story-copy"><h3>{{action}}</h3><p>{{summary}}</p></div></article>{{/cards}}</div></section></div>',
      [
        {
          id: 'heading',
          kind: 'text',
          label: 'Heading',
          constraints: { sourceSample: 'Stories from our community', echelonAudience: 'national' },
        },
        {
          id: 'more',
          kind: 'link',
          label: 'All stories link',
          constraints: {
            sourceSample: {
              label: 'View all stories →',
              url: 'https://salvationarmyechelon.org/echelon/allnews/',
              newTab: true,
            },
          },
        },
        {
          id: 'cards',
          kind: 'repeat',
          label: 'Stories',
          constraints: {
            item: {
              unit: 'Story card',
              min: 0,
              max: 3,
              fields: [
                { id: 'photo', kind: 'image', label: 'Story photo', constraints: {} },
                { id: 'action', kind: 'link', label: 'Story title and destination', constraints: {} },
                {
                  id: 'summary',
                  kind: 'text',
                  label: 'Story summary',
                  constraints: { multiline: true, maxLength: 155 },
                },
              ],
              samples: ECHELON_NATIONAL_STORIES.map(row => ({
                photo: { src: '/cms-samples/r8-landscape.png', alt: '[Choose the story photo]', decorative: false },
                action: { label: row.title, url: row.url, newTab: true },
                summary: row.summary,
              })),
            },
          },
        },
      ],
    ),
  ]
}
