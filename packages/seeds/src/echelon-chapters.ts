import { ChapterSetup } from '@cms/schema'
import { ECHELON_CHAPTER_SOURCES } from './echelon-chapters-source.ts'
export { ECHELON_CHAPTER_SOURCES } from './echelon-chapters-source.ts'
export { echelonChapterContent, applyChapterSetup } from './echelon-chapter-content.ts'
/** Reserved example addresses are explicit demo stand-ins, never claims about a chapter. */
export function echelonChapterSetups(): { slug: string; config: ChapterSetup; sample: boolean }[] {
  const rows = ECHELON_CHAPTER_SOURCES.map(source => {
    const editors = ['peoria', 'north-texas', 'boston'].includes(source.slug)
    const boston = source.slug === 'boston'
    const northTexas = source.slug === 'north-texas'
    const destination = boston ? 'page' : source.destination
    return {
      slug: source.slug,
      sample: false,
      config: ChapterSetup.parse({
        name: source.name,
        destination,
        pageId: null,
        externalUrl: destination === 'external' ? 'https://example.test/chapters/' + source.slug : null,
        updateMode: editors ? 'chapter-editors' : 'division',
        contact: { name: '[Name]', role: '[Role]', email: 'contact-' + source.slug + '@example.test' },
        sections: {
          paragraph: true,
          social: true,
          socialFirst: boston,
          events: !boston,
          board: !boston,
          photos: northTexas,
          memberLogin: northTexas,
        },
        boardDisplay: northTexas ? 'first-eight' : 'all',
      }),
    }
  })
  return [
    ...rows,
    {
      slug: 'rebuilding-sample',
      sample: true,
      config: ChapterSetup.parse({
        name: '[A rebuilding chapter]',
        destination: 'unlisted',
        pageId: null,
        externalUrl: null,
        contact: { name: '[Name]', role: '[Role]', email: 'rebuilding@example.test' },
        sections: {},
      }),
    },
    {
      slug: 'maryland',
      sample: true,
      config: ChapterSetup.parse({
        name: 'Maryland Chapter',
        destination: 'page',
        pageId: null,
        externalUrl: null,
        updateMode: 'chapter-editors',
        contact: { name: '[Name]', role: '[Role]', email: 'maryland@example.test' },
        sections: {},
      }),
    },
  ]
}

export { echelonChapterTemplate, type EchelonChapterMedia } from './echelon-chapter-template.ts'

export { ECHELON_REFERENCE_MEDIA } from './echelon-reference-media.ts'
export {
  withEchelonMedia,
  echelonChapterPhotos,
  ECHELON_MEDIA_KEYS,
  type EchelonImage,
  type EchelonMediaValues,
} from './echelon-media-values.ts'

export { echelonNationalTemplate, ECHELON_NATIONAL_SOCIAL } from './echelon-national-template.ts'
