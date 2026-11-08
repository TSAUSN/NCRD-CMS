import { validSectionAnchor } from './section-anchor.ts'
import { z } from 'zod'
const https = z
  .string()
  .max(2048)
  .url()
  .refine(value => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password
    } catch {
      return false
    }
  }, 'Use an https website address.')
export const ChapterSetup = z
  .strictObject({
    name: z.string().trim().min(1).max(160),
    destination: z.enum(['page', 'division', 'external', 'unlisted']),
    pageId: z.uuid().nullable(),
    externalUrl: https.nullable(),
    updateMode: z.enum(['division', 'chapter-editors']).default('division'),
    contact: z.strictObject({
      name: z.string().trim().min(1).max(120),
      role: z.string().trim().min(1).max(120),
      email: z.email().max(254),
    }),
    sections: z.strictObject({
      paragraph: z.boolean().default(true),
      social: z.boolean().default(true),
      socialFirst: z.boolean().default(false),
      events: z.boolean().default(true),
      board: z.boolean().default(true),
      photos: z.boolean().default(false),
      memberLogin: z.boolean().default(false),
    }),
    boardDisplay: z.enum(['all', 'first-eight']).default('all'),
  })
  .superRefine((value, context) => {
    if (['external', 'division'].includes(value.destination) && !value.externalUrl)
      context.addIssue({
        code: 'custom',
        path: ['externalUrl'],
        message:
          value.destination === 'division' ? 'Add the division page address.' : 'Add the chapter website address.',
      })
  })
export type ChapterSetup = z.infer<typeof ChapterSetup>
export const ContactMessage = z.strictObject({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  phone: z.string().trim().min(1).max(60),
  comments: z.string().trim().min(1).max(5000),
})

export function chapterUsesLinkedPage(destination: ChapterSetup['destination']): boolean {
  return destination === 'division' || destination === 'external'
}
export function chapterDestinationLabel(destination: unknown): string {
  return (
    (
      {
        page: 'This chapter page',
        division: 'Their division’s page',
        external: 'Their own website or social page',
        unlisted: 'Not listed yet',
      } as Record<string, string>
    )[String(destination)] ?? 'Not set'
  )
}

/** Chapter pages never offer national-only sections or Story feeds. Postgres enforces the same boundary. */
export function chapterAllowsSection(definition: {
  slug?: string
  slots?: readonly { constraints?: Record<string, unknown> }[]
}): boolean {
  if (
    [
      'core-stories',
      'core-newsroom',
      'core-story-world',
      'core-story-split',
      'core-story-detail',
      'core-echelon-directory',
      'core-echelon-leadership',
      'core-chapter-directory',
      'core-chapter-search',
    ].includes(definition.slug ?? '')
  )
    return false
  return !(definition.slots ?? []).some(
    slot =>
      slot.constraints?.echelonAudience === 'national' ||
      slot.constraints?.storyFeed === true ||
      slot.constraints?.coreList === 'stories' ||
      ['chapter-directory', 'chapter-search'].includes(String(slot.constraints?.siteWidget ?? '')),
  )
}
export function isReviewedChapterComposition(content: readonly { values?: Record<string, unknown> }[]): boolean {
  return content.some(section => section.values?.__cms_echelon_template === 'chapter')
}
/** Generated page links preserve the source labels and use current visible section anchors. */
export function chapterJumpValues(
  content: readonly { hidden?: boolean; values?: Record<string, unknown> }[],
): Record<string, unknown> {
  const definitions = [
    ['paragraph', 'users', 'Who we are'],
    ['what', 'heart', 'What we do'],
    ['events', 'calendar', 'Events'],
    ['board', 'users', 'Our board'],
    ['faq', 'info', 'FAQ'],
    ['form', 'mail', 'Join us'],
  ]
  const values: Record<string, unknown> = {}
  const items: string[] = []
  definitions.forEach(([part, icon, label], index) => {
    const target = content.find(section => section.values?.__cms_chapter_part === part && !section.hidden)
    const anchor = target?.values?.__cms_anchor
    if (!validSectionAnchor(anchor)) return
    const key = 'i' + (index + 1)
    items.push(key)
    values['links__' + key + '__icon'] = icon
    values['links__' + key + '__action'] = { label, url: '#' + anchor }
  })
  return { links: { items }, ...values, __cms_chapter_part: 'jumps', __cms_echelon_template: 'chapter' }
}

/** National Echelon pages use the national section map and never offer chapter events. */
export function echelonNationalAllowsSection(definition: {
  slug?: string
  category?: string
  slots?: readonly { constraints?: Record<string, unknown> }[]
}): boolean {
  return (
    definition.category?.toLowerCase() !== 'events' &&
    !['core-echelon-events', 'core-schedule'].includes(definition.slug ?? '') &&
    !(definition.slots ?? []).some(slot => slot.constraints?.echelonAudience === 'chapter')
  )
}
export function isReviewedNationalComposition(content: readonly { values?: Record<string, unknown> }[]): boolean {
  return content.some(section => section.values?.__cms_echelon_template === 'national')
}
