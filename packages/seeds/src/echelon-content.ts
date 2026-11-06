import { withEchelonMedia } from './echelon-media-values.ts'
import { clearSampleField, markSampleValues, sampleFieldNames, type SectionAppearance } from '@cms/schema'
/** Approved national-page-public-text.txt; approved public content only. */
export const ECHELON_PUBLIC_COPY = {
  mission:
    'Echelon seeks to mobilize the next generation for The Salvation Army by providing opportunities for young adults to engage with the organization through fellowship and networking, donations and fundraising, and service and volunteering.',
  who: "Echelon members participate in a variety of networking, volunteer, and fundraising activities. These activities directly support Salvation Army services within a chapter's local community. Whether we are serving, attending one of our social events, or raising money, you will find Echelon is a connected community full of people who are making a difference.",
  what: "Echelon is the emerging professionals arm of The Salvation Army. Our community is serious about having fun while addressing some of today's most pressing issues within our local communities.",
  join: 'You can become a member of a connected and passionate community and enjoy exclusive member benefits. Locate the Echelon chapter closest to you and find out more about membership!',
  find: 'We are always looking for new members to join one of our Echelon chapters and become ambassadors of The Salvation Army in their local communities. Community leaders, executives, and other key influencers work closely with the Salvation Army and Echelon on a regular basis. Echelon provides members with opportunities to build powerful and lasting relationships, while making a positive impact in their communities. If you do not find an active Echelon chapter located near you and are interested in starting one, please contact us via email at Echelon@usn.salvationarmy.org',
  contact:
    'If you are interested in volunteer opportunities, membership, or have questions for Echelon, please fill out the form below and let us know!',
  footer: 'The Salvation Army Echelon National, 615 Slaters Lane, Alexandria, Virginia 22314 | 1-800-SAL-ARMY',
} as const
export function echelonSectionContent(
  template: string,
  slug: string,
  initial: Record<string, unknown>,
): { values: Record<string, unknown>; appearance?: SectionAppearance } {
  if (!['echelon-home', 'chapter-finder'].includes(template)) return { values: initial }
  let values: Record<string, unknown> = { ...initial },
    appearance: SectionAppearance | undefined
  const owned = (fields: Record<string, unknown>) => {
    Object.assign(values, fields)
    for (const key of Object.keys(fields)) values = clearSampleField(values, key)
  }
  if (template === 'echelon-home') {
    if (slug === 'split-hero') {
      owned({
        kicker: 'Our Mission',
        ...(sampleFieldNames(initial).includes('intro') ? { intro: ECHELON_PUBLIC_COPY.mission } : {}),
        primary: { label: 'Find a chapter', url: '/chapters' },
        secondary: { label: 'Contact Echelon', url: '#contact' },
      })
      appearance = { surface: 'primary' }
      values.photo = {
        src: '/cms-samples/r8-landscape.png',
        alt: 'Abstract community illustration (sample)',
        decorative: false,
      }
    }
    if (slug === 'text-block') owned({ heading: 'Who We Are', body: '<p>' + ECHELON_PUBLIC_COPY.who + '</p>' })
    if (slug === 'icon-cards')
      values = {
        heading: 'What we do',
        cards: { items: ['i1', 'i2', 'i3'] },
        ...Object.fromEntries(
          ['Fellowship and networking', 'Donations and fundraising', 'Service and volunteering'].flatMap(
            (title, index) => [
              [`cards__i${index + 1}__title`, title],
              [`cards__i${index + 1}__description`, ''],
              [`cards__i${index + 1}__icon`, ['users', 'heart', 'star'][index]],
            ],
          ),
        ),
      }
    if (slug === 'team-grid') owned({ heading: 'Leadership' })
    if (slug === 'image-link-cards')
      values = markSampleValues({
        heading: 'News',
        cards: { items: ['i1', 'i2'] },
        ...Object.fromEntries(
          [1, 2].flatMap(number => [
            [`cards__i${number}__title`, '[News title] (sample)'],
            [`cards__i${number}__description`, '[News summary]'],
            [
              `cards__i${number}__photo`,
              { src: '/cms-samples/r8-square.png', alt: 'Abstract illustration (sample)', decorative: false },
            ],
            [`cards__i${number}__action`, { label: '[Link text]', url: 'https://example.test/' }],
          ]),
        ),
      })
    if (slug === 'faq')
      values = markSampleValues({
        heading: 'FAQ',
        questions: { items: ['i1', 'i2'] },
        questions__i1__question: '[Question]',
        questions__i1__answer: '<p>[Answer]</p>',
        questions__i2__question: '[Question]',
        questions__i2__answer: '<p>[Answer]</p>',
      })
    if (slug === 'contact-form') {
      owned({ heading: 'Contact Echelon', intro: ECHELON_PUBLIC_COPY.contact })
      values.__cms_anchor = 'contact'
    }
  } else {
    if (slug === 'page-header' && sampleFieldNames(initial).includes('intro'))
      owned({ intro: ECHELON_PUBLIC_COPY.find })
    if (slug === 'text-block') owned({ heading: 'Join Us', body: '<p>' + ECHELON_PUBLIC_COPY.join + '</p>' })
    if (slug === 'cta-band')
      owned({
        heading: 'Contact Echelon',
        intro: ECHELON_PUBLIC_COPY.contact,
        action: { label: 'Contact Echelon', url: '/#contact' },
      })
  }
  return {
    values: template === 'echelon-home' ? values : withEchelonMedia(values, {}),
    ...(appearance ? { appearance } : {}),
  }
}
