/** Approved national composition,using normal shared sections and this site's imported Media. */
import { sourceSampleValues, type SectionInstance } from '@cms/schema'
import type { CorePageDefinition } from './core-templates.ts'
import { ECHELON_LIBRARY } from './echelon-library.ts'
import { echelonBodyContent } from './echelon-body-library.ts'
import { echelonFaqContactContent } from './echelon-faq-contact.ts'
import { echelonLeadershipContent } from './echelon-leadership.ts'
import {
  ECHELON_MEDIA_KEYS,
  echelonChapterPhotos,
  withEchelonMedia,
  type EchelonMediaValues,
} from './echelon-media-values.ts'
export const ECHELON_NATIONAL_SOCIAL = [
  {
    service: 'facebook',
    url: 'https://www.facebook.com/salvationarmyechelon/',
    handle: '',
    inFooter: false,
  },
  {
    service: 'instagram',
    url: 'https://www.instagram.com/salvationarmyechelon/',
    handle: '',
    inFooter: false,
  },
  {
    service: 'linkedin',
    url: 'https://www.linkedin.com/company/salvation-army-echelon',
    handle: '',
    inFooter: false,
  },
] as const
export function echelonNationalTemplate(
  definitions: readonly CorePageDefinition[],
  media: EchelonMediaValues,
): SectionInstance[] {
  const photos = echelonChapterPhotos(media)
  if (!photos) throw new Error('Choose the Echelon logo and reference photos first.')
  const one = (slug: string): SectionInstance => {
    const entry = ECHELON_LIBRARY.find(row => row.definition.slug === 'core-echelon-' + slug),
      def = definitions.find(row => row.slug === 'core-echelon-' + slug)
    if (!entry || !def) throw new Error('Install the shared Echelon sections first.')
    return {
      section_def_id: def.id,
      section_def_version: def.version,
      label: def.name,
      hidden: false,
      hidden_at: [],
      values: withEchelonMedia(
        sourceSampleValues(entry.definition.kind === 'legacy' ? entry.definition.slots : []),
        media,
        def.slug,
      ),
    }
  }
  const hero = one('hero')
  Object.assign(hero.values, { logo: photos.logo, photo: photos.photo, __cms_anchor: 'ech-demo-title' })
  const jump = one('jump-links')
  jump.values.accounts_from = 'site'
  const directory = one('directory')
  directory.values.__cms_anchor = 'ech-demo-chapters'
  const body = echelonBodyContent('national', definitions, photos),
    stories = one('stories')
  stories.values.__cms_anchor = 'ech-demo-stories'
  const leadershipMedia = Object.fromEntries(
      ['council', 'portrait_one', 'portrait_two', 'portrait_three', 'portrait_four'].map(key => [
        key === 'council' ? 'photo' : key,
        media[ECHELON_MEDIA_KEYS[key as keyof typeof ECHELON_MEDIA_KEYS]],
      ]),
    ),
    leadership = echelonLeadershipContent(definitions, leadershipMedia),
    ending = echelonFaqContactContent('national', definitions)
  return [hero, jump, directory, ...body, stories, leadership, ...ending].map(section => ({
    ...section,
    hidden: false,
    hidden_at: [],
    values: { ...section.values, __cms_echelon_template: 'national' },
  }))
}
