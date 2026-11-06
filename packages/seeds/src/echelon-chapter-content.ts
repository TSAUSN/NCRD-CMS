import { isReviewedChapterComposition } from '@cms/schema'
import { applyEchelonChapterTemplateSetup } from './echelon-chapter-template.ts'
import { markSampleValues, clearSampleField, type ChapterSetup, type SectionInstance } from '@cms/schema'
import type { CorePageDefinition } from './core-templates.ts'
import { ECHELON_PUBLIC_COPY } from './echelon-content.ts'
const people = Array.from({ length: 16 }, (_, index) => '[Board member ' + (index + 1) + ']')
export type ChapterPart =
  | 'title'
  | 'paragraph'
  | 'social'
  | 'what'
  | 'events'
  | 'board'
  | 'photos'
  | 'memberLogin'
  | 'contact'
  | 'join'
/** Site configuration composes the shared library; public text comes only from approved sources. */
export function echelonChapterContent(
  config: ChapterSetup,
  definitions: readonly CorePageDefinition[],
  boardCount = 4,
): SectionInstance[] {
  const parts: { part: ChapterPart; slug: string; label: string; values: Record<string, unknown>; sample?: boolean }[] =
    [
      {
        part: 'title',
        slug: 'page-header',
        label: 'Chapter introduction',
        values: { heading: config.name, intro: '[Chapter introduction]' },
        sample: true,
      },
      {
        part: 'paragraph',
        slug: 'text-block',
        label: 'About this chapter',
        values: { heading: 'About this chapter', body: '<p>[Chapter paragraph]</p>' },
        sample: true,
      },
      {
        part: 'social',
        slug: 'on-page-navigation',
        label: 'Social links',
        values: {
          heading: 'Connect with our chapter',
          links: { items: ['i1', 'i2'] },
          links__i1__action: { label: 'Instagram', url: 'https://example.test/instagram' },
          links__i2__action: { label: 'Facebook', url: 'https://example.test/facebook' },
        },
        sample: true,
      },
      {
        part: 'what',
        slug: 'text-block',
        label: 'What is Echelon',
        values: {
          heading: 'What is Echelon',
          body: '<p>' + ECHELON_PUBLIC_COPY.what + '</p><p>' + ECHELON_PUBLIC_COPY.mission + '</p>',
        },
      },
      {
        part: 'events',
        slug: 'image-link-cards',
        label: 'This year’s events',
        values: {
          heading: 'This year’s events',
          cards: { items: ['i1'] },
          cards__i1__title: '[Event name] (sample)',
          cards__i1__description: '[Date, time and place]',
          cards__i1__photo: {
            src: '/cms-samples/r8-landscape.png',
            alt: 'Abstract illustration (sample)',
            decorative: false,
          },
          cards__i1__action: { label: '[Event information]', url: 'https://example.test/event' },
        },
        sample: true,
      },
      {
        part: 'board',
        slug: 'chapter-board',
        label: 'Board',
        values: {
          heading: 'Board',
          cards: { items: people.slice(0, Math.max(0, Math.min(16, boardCount))).map((_, index) => 'i' + (index + 1)) },
          ...Object.fromEntries(
            people.slice(0, Math.max(0, Math.min(16, boardCount))).flatMap((name, index) => [
              [`cards__i${index + 1}__title`, name + ' (sample)'],
              [`cards__i${index + 1}__description`, '[Board role]'],
              [
                `cards__i${index + 1}__photo`,
                {
                  src: '/cms-samples/r8-square.png',
                  alt: 'Abstract portrait illustration (sample)',
                  decorative: false,
                },
              ],
              [`cards__i${index + 1}__action`, { label: 'Contact', url: 'mailto:chapter@example.test' }],
            ]),
          ),
        },
        sample: true,
      },
      {
        part: 'photos',
        slug: 'image-gallery',
        label: 'Photos',
        values: {
          heading: 'Photos',
          pictures: { items: ['i1'] },
          pictures__i1__photo: {
            src: '/cms-samples/r8-landscape.png',
            alt: 'Abstract illustration (sample)',
            decorative: false,
          },
          pictures__i1__caption: '[Photo caption]',
        },
        sample: true,
      },
      {
        part: 'memberLogin',
        slug: 'cta-band',
        label: 'Member login',
        values: {
          heading: 'Member login',
          intro: '[Member information]',
          action: { label: 'Member login', url: 'https://example.test/members' },
        },
        sample: true,
      },
      {
        part: 'contact',
        slug: 'text-block',
        label: 'Contact the chapter',
        values: {
          heading: 'Contact the chapter',
          body: '<p>Inquiries: <a href="mailto:chapter@example.test">[chapter email]</a></p><p>Membership chair: [Name]</p>',
        },
        sample: true,
      },
      {
        part: 'join',
        slug: 'contact-form',
        label: 'Join us',
        values: { heading: 'Join Us', intro: ECHELON_PUBLIC_COPY.join },
      },
    ]
  if (config.sections.socialFirst) {
    const social = parts.splice(2, 1)[0]!
    parts.splice(1, 0, social)
  }
  return parts.map(({ part, slug, label, values, sample }) => {
    const definition = definitions.find(def => def.slug === 'core-' + slug)
    if (!definition) throw new Error('Install the shared chapter sections before creating a page.')
    let fields = sample ? markSampleValues(values) : values
    // The title and headings identify controls, rather than sample public facts.
    fields = clearSampleField(fields, 'heading')
    fields = {
      ...fields,
      __cms_chapter_part: part,
      ...(part === 'board' ? { __cms_board_display: config.boardDisplay } : {}),
    }
    const optional = part in config.sections ? config.sections[part as keyof typeof config.sections] : true
    return {
      section_def_id: definition.id,
      section_def_version: definition.version,
      label,
      values: fields,
      hidden: !optional,
      hidden_at: [],
      ...(part === 'title' ? { appearance: { surface: 'primary' as const } } : {}),
    }
  })
}
export function applyChapterSetup(content: SectionInstance[], config: ChapterSetup): SectionInstance[] {
  if (isReviewedChapterComposition(content)) return applyEchelonChapterTemplateSetup(content, config)
  const next = content.map(section => {
    const part = section.values.__cms_chapter_part
    if (typeof part !== 'string') return section
    return {
      ...section,
      hidden: part in config.sections ? !config.sections[part as keyof typeof config.sections] : section.hidden,
      values: {
        ...section.values,
        ...(part === 'title' ? { heading: config.name } : {}),
        ...(part === 'board' ? { __cms_board_display: config.boardDisplay } : {}),
      },
    }
  })
  const social = next.findIndex(section => section.values.__cms_chapter_part === 'social')
  if (social >= 0) {
    const item = next.splice(social, 1)[0]!,
      target = config.sections.socialFirst
        ? 1
        : next.findIndex(section => section.values.__cms_chapter_part === 'paragraph') + 1
    next.splice(Math.min(Math.max(1, target), next.length), 0, item)
  }
  return next
}
