/** The reviewed chapter composition. Callers supply this site's Media; never fetch reference URLs. */
import {
  sourceSampleValues,
  markSampleValues,
  chapterJumpValues,
  type ChapterSetup,
  type SectionInstance,
} from '@cms/schema'
import { ECHELON_LIBRARY } from './echelon-library.ts'
import { echelonBodyContent } from './echelon-body-library.ts'
import { echelonFaqContactContent } from './echelon-faq-contact.ts'
import { echelonBoardContactsContent } from './echelon-board-contacts.ts'
import { echelonEngagementContent } from './echelon-engagement.ts'
import type { CorePageDefinition } from './core-templates.ts'
export type EchelonChapterMedia = {
  logo: unknown
  photo: unknown
  portrait: unknown
  photo_two: unknown
  photo_three: unknown
}
export function echelonChapterTemplate(
  definitions: readonly CorePageDefinition[],
  media: EchelonChapterMedia,
  config?: ChapterSetup,
): SectionInstance[] {
  for (const key of ['logo', 'photo', 'portrait', 'photo_two', 'photo_three'] as const)
    if (!media[key]) throw new Error('Choose the Echelon logo and all chapter photos first.')
  const one = (slug: string): SectionInstance => {
    const entry = ECHELON_LIBRARY.find(row => row.definition.slug === 'core-echelon-' + slug)
    const definition = definitions.find(row => row.slug === 'core-echelon-' + slug)
    if (!entry || !definition) throw new Error('Install the shared Echelon sections first.')
    return {
      section_def_id: definition.id,
      section_def_version: definition.version,
      label: definition.name,
      hidden: false,
      hidden_at: [],
      values: sourceSampleValues(entry.definition.kind === 'legacy' ? entry.definition.slots : []),
    }
  }
  const hero = one('hero')
  Object.assign(hero.values, {
    heading: config?.name ?? '[Chapter name]',
    logo: media.logo,
    photo: media.photo,
    primary: { label: 'Explore events', url: '#ech-demo-events' },
    __cms_anchor: 'ech-demo-title',
    __cms_chapter_part: 'title',
  })
  const jump = one('jump-links')
  const links = [
    ['users', 'Who we are', '#ech-demo-about'],
    ['heart', 'What we do', '#ech-demo-participate'],
    ['calendar', 'Events', '#ech-demo-events'],
    ['users', 'Our board', '#ech-demo-board'],
    ['info', 'FAQ', '#ech-demo-faq'],
    ['mail', 'Join us', '#ech-demo-contact'],
  ]
  jump.values = {
    links: { items: links.map((_, i) => 'i' + (i + 1)) },
    ...Object.fromEntries(
      links.flatMap(([icon, label, url], i) => [
        ['links__i' + (i + 1) + '__icon', icon],
        ['links__i' + (i + 1) + '__action', { label, url }],
      ]),
    ),
    __cms_chapter_part: 'jumps',
  }
  const [about, who, pillars] = echelonBodyContent('chapter', definitions, media)
  const [faq, contact] = echelonFaqContactContent('chapter', definitions)
  const people = echelonBoardContactsContent(definitions)
  const contacts = people.find(row => row.values.__cms_chapter_part !== 'board')!
  const board = people.find(row => row.values.__cms_chapter_part === 'board')!
  const [events, follow] = echelonEngagementContent(definitions)
  const content: SectionInstance[] = [
    hero,
    jump,
    about!,
    who!,
    pillars!,
    events!,
    contacts,
    follow!,
    board,
    faq!,
    contact!,
  ].map(section => Object.assign(section, { hidden: false, hidden_at: [] as ('lg' | 'md' | 'sm')[] }))
  const parts = ['title', 'jumps', 'about', 'paragraph', 'what', 'events', 'contact', 'social', 'board', 'faq', 'form']
  content.forEach((section, index) => {
    section.values.__cms_echelon_template = 'chapter'
    section.values.__cms_chapter_part = parts[index]!
  })
  // Blank member identities are deliberate placeholders, not invented people.
  const emptyBoard = Object.fromEntries(
    Object.entries(board.values).filter(([key, value]) => /^cards__[^_]+__(name|photo)$/.test(key) && !value),
  )
  Object.assign(board.values, markSampleValues(emptyBoard))
  if (config) {
    for (const section of content) {
      const part = String(section.values.__cms_chapter_part)
      if (['paragraph', 'events', 'board', 'social'].includes(part))
        section.hidden = !config.sections[part as 'paragraph' | 'events' | 'board' | 'social']
      if (part === 'board') section.values.__cms_board_display = config.boardDisplay
    }
    if (config.sections.socialFirst) {
      const at = content.findIndex(row => row.values.__cms_chapter_part === 'social')
      const item = content.splice(at, 1)[0]!
      content.splice(1, 0, item)
    }
  }
  // The jump bar describes exactly the visible template sections.
  const visible = new Set(content.filter(row => !row.hidden).map(row => row.values.__cms_anchor))
  const ids = (jump.values.links as { items: string[] }).items
  for (const id of [...ids]) {
    const action = jump.values['links__' + id + '__action'] as { url: string }
    if (!visible.has(action.url.slice(1))) {
      ids.splice(ids.indexOf(id), 1)
      delete jump.values['links__' + id + '__icon']
      delete jump.values['links__' + id + '__action']
    }
  }
  if (config && !config.sections.events) {
    hero.values.primary = { label: 'Get in touch', url: '#ech-local-contact-title' }
    who!.values.action = { label: 'Get in touch →', url: '#ech-local-contact-title' }
    for (const key of Object.keys(faq!.values))
      if (typeof faq!.values[key] === 'string')
        faq!.values[key] = (faq!.values[key] as string).replace(/<a href="#ech-demo-events">([^<]*)<\/a>/g, '$1')
  }
  return content
}

/** Option changes keep authored fields and Media; only visibility, generated links and approved social placement change. */
export function applyEchelonChapterTemplateSetup(content: SectionInstance[], config: ChapterSetup): SectionInstance[] {
  const next = structuredClone(content)
  for (const section of next) if (section.values.__cms_chapter_part === 'title') section.values.heading = config.name
  for (const section of next) {
    const part = String(section.values.__cms_chapter_part)
    if (part in config.sections) section.hidden = !config.sections[part as keyof typeof config.sections]
    if (part === 'board') section.values.__cms_board_display = config.boardDisplay
  }
  const at = next.findIndex(section => section.values.__cms_chapter_part === 'social')
  if (at >= 0) {
    const social = next.splice(at, 1)[0]!
    const contacts = next.findIndex(section => section.values.__cms_chapter_part === 'contact')
    const target = config.sections.socialFirst ? 1 : contacts >= 0 ? contacts + 1 : next.length
    next.splice(target, 0, social)
  }
  for (const section of next)
    if (section.values.__cms_chapter_part === 'jumps')
      section.values = {
        ...Object.fromEntries(Object.entries(section.values).filter(([key]) => !/^links(?:__|$)/.test(key))),
        ...chapterJumpValues(next),
      }
  if (!config.sections.events) {
    for (const section of next)
      for (const key of ['primary', 'action']) {
        const value = section.values[key]
        if (value && typeof value === 'object' && (value as { url?: unknown }).url === '#ech-demo-events')
          section.values[key] = {
            ...(value as Record<string, unknown>),
            label: key === 'primary' ? 'Get in touch' : 'Get in touch →',
            url: '#ech-local-contact-title',
          }
      }
  }
  return next
}
