import {
  clearSampleField,
  markSampleValues,
  sectionStartingValues,
  type SectionInstance,
  type SlotDef,
} from '@cms/schema'
import { echelonSectionContent } from './echelon-content.ts'
const chapterParts = [
  { slug: 'page-header', label: 'Page header', hidden: false },
  { slug: 'text-block', label: 'About this chapter', hidden: false },
  { slug: 'image-link-cards', label: 'Board', hidden: true },
  { slug: 'image-gallery', label: 'Photos', hidden: true },
  { slug: 'cta-band', label: 'Join us', hidden: false },
] as const
export function coreTemplateSectionOptions(templateId: string, slug: string) {
  return templateId === 'chapter' ? chapterParts.find(part => part.slug === slug.replace(/^core-/, '')) : undefined
}
export const CORE_PAGE_TEMPLATES = [
  {
    id: 'echelon-home',
    name: 'Echelon national home',
    sections: [
      'split-hero',
      'chapter-search',
      'text-block',
      'icon-cards',
      'team-grid',
      'image-link-cards',
      'faq',
      'contact-form',
    ],
  },
  {
    id: 'chapter-finder',
    name: 'Find a chapter',
    sections: ['page-header', 'chapter-directory', 'text-block', 'cta-band'],
  },
  {
    id: 'event-home',
    name: 'Event home',
    sections: [
      'event-hero',
      'icon-cards',
      'speakers-grid',
      'schedule',
      'venue-travel',
      'logo-strip',
      'registration-cta',
    ],
  },
  { id: 'speakers', name: 'Speakers', sections: ['page-header', 'speakers-grid', 'cta-band'] },
  { id: 'program', name: 'Program', sections: ['page-header', 'on-page-navigation', 'schedule', 'cta-band'] },
  { id: 'visit', name: 'Plan your visit', sections: ['page-header', 'venue-travel', 'faq', 'cta-band'] },
  {
    id: 'sponsors',
    name: 'Sponsors / exhibitors',
    sections: ['page-header', 'image-link-cards', 'logo-strip', 'text-image', 'cta-band'],
  },
  { id: 'resources', name: 'Resource page', sections: ['page-header', 'text-block', 'resource-library', 'faq'] },
  { id: 'landing', name: 'Landing page', sections: ['split-hero', 'icon-cards', 'text-image', 'stats', 'cta-band'] },
  { id: 'chapter', name: 'Chapter page', sections: chapterParts.map(part => part.slug) },
  { id: 'blank', name: 'Blank page', sections: ['page-header', 'text-block'] },
] as const
export type CoreTemplateId = (typeof CORE_PAGE_TEMPLATES)[number]['id']
export type CorePageDefinition = { id: string; version: number; slug: string; name: string; slots: SlotDef[] }
export function corePageTemplate(id: string) {
  return CORE_PAGE_TEMPLATES.find(template => template.id === id)
}
export function coreTemplateContent(
  templateId: string,
  definitions: readonly CorePageDefinition[],
  title: string,
  intro?: string,
  body?: string,
): SectionInstance[] {
  const template = corePageTemplate(templateId)
  if (!template) throw new Error('Choose a page template from the list.')
  const sections: string[] = [...template.sections]
  if (
    body &&
    !sections.some(slug =>
      definitions.find(definition => definition.slug === `core-${slug}`)?.slots.some(slot => slot.id === 'body'),
    )
  )
    sections.splice(1, 0, 'text-block')
  return sections.map((slug, index) => {
    const definition = definitions.find(definition => definition.slug === `core-${slug}`)
    if (!definition) throw new Error('The shared page sections need to be installed before this template can be used.')
    let values = markSampleValues(sectionStartingValues(definition.slots))
    const options = coreTemplateSectionOptions(template.id, slug)
    const hidden = options?.hidden ?? false
    const label = options?.label ?? definition.name
    if (template.id === 'chapter') {
      const placeholder = (fields: Record<string, unknown>) => markSampleValues(fields)
      if (slug === 'page-header') values = placeholder({ heading: '[Chapter name]', intro: '[Chapter introduction]' })
      if (slug === 'text-block') values = placeholder({ heading: label, body: '<p>[Chapter paragraph]</p>' })
      if (slug === 'image-link-cards') {
        values = placeholder({
          heading: label,
          cards: { items: ['i1', 'i2'] },
          ...Object.fromEntries(
            [1, 2].flatMap(number => [
              [`cards__i${number}__title`, '[Board member ' + number + '] (sample)'],
              [`cards__i${number}__description`, '[Board role]'],
              [
                `cards__i${number}__photo`,
                { src: '/cms-samples/r8-square.png', alt: 'Abstract illustration (sample)', decorative: false },
              ],
              [`cards__i${number}__action`, { label: 'Contact', url: 'mailto:chapter@example.test' }],
            ]),
          ),
        })
      }
      if (slug === 'image-gallery')
        values = placeholder({
          heading: label,
          pictures: { items: ['i1'] },
          pictures__i1__photo: {
            src: '/cms-samples/r8-landscape.png',
            alt: 'Abstract illustration (sample)',
            decorative: false,
          },
          pictures__i1__caption: '[Photo caption]',
        })
      if (slug === 'cta-band')
        values = placeholder({
          heading: label,
          intro: '[Membership information]',
          action: { label: 'Contact the chapter', url: 'mailto:chapter@example.test' },
        })
    }
    if (index === 0) {
      values.heading = title
      values = clearSampleField(values, 'heading')
      if (intro !== undefined && intro !== '') {
        values.intro = intro
        values = clearSampleField(values, 'intro')
      }
    }
    if (template.id === 'event-home' && slug === 'speakers-grid')
      values.speakers = { readerKey: 'speakers', selection: { mode: 'automatic', limit: 6 } }
    if (template.id === 'event-home' && slug === 'schedule')
      values.program = { readerKey: 'program', selection: { mode: 'automatic', limit: 3 } }
    if (slug === 'on-page-navigation' && template.id === 'program') {
      values.links__i1__action = { label: 'Overview', url: '#s0' }
      values.links__i2__action = { label: 'Program', url: '#s2' }
      values.links__i3__action = { label: 'Register', url: '#s3' }
    }
    if (body && definition.slots.some(slot => slot.id === 'body')) {
      values.body = body
      values = clearSampleField(values, 'body')
    }
    const native = echelonSectionContent(template.id, slug, values)
    return {
      section_def_id: definition.id,
      section_def_version: definition.version,
      values: native.values,
      hidden,
      hidden_at: [],
      label,
      ...(native.appearance ? { appearance: native.appearance } : {}),
    }
  })
}
