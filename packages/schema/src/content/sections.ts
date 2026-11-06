import { SLOT_ID } from './slot-id.ts'
import { z } from 'zod'
import { SectionAppearance } from './section-appearance.ts'

export const BREAKPOINTS = ['sm', 'md', 'lg'] as const

// The starting slot vocabulary; §5 leaves the list open, the renderer only
// fills kinds it knows how to sanitize.
//
// `navigation` stores no value: the renderer fills it with the site's own
// navigation tree, so an authored header or footer (ADR 0010) places the menu
// without owning its links. It renders nothing inside a page section.
export const SLOT_KINDS = ['text', 'richtext', 'image', 'link', 'button', 'repeat', 'navigation'] as const

/** Kinds whose value comes from the site, not from an instance's stored values. */
export const SITE_FILLED_SLOT_KINDS = ['navigation'] as const

/**
 * Where a definition may be placed (ADR 0010). Page sections go in page
 * content; header and footer definitions are pinned by the site frame only.
 */
export const SECTION_PLACEMENTS = ['page', 'header', 'footer'] as const
export type SectionPlacement = (typeof SECTION_PLACEMENTS)[number]

/**
 * The slot-id grammar, enforced everywhere a slot id crosses a boundary.
 *
 * Ids used to be "any non-empty string", and a stored id turned out to be an
 * input to context reconstruction: an id of `a}}</p><div title="` closed the
 * synthetic marker it was interpolated into and rewrote the tokenizer's view of
 * every slot after it. The reconstruction no longer interpolates ids at all,
 * and this narrows what one can be so that neither half depends on the other
 * having remembered.
 *
 * A letter, then letters, digits, `_` or `-`, to 64 characters. That is what
 * the template tokenizer has always accepted; the difference is that it is now
 * written down and checked on the way in as well as on the way out.
 */
export { SLOT_ID } from './slot-id.ts'

/**
 * The section-definition slug grammar.
 *
 * A slug is not a label either: it is concatenated into a CSS class name to
 * build the scope a definition's stylesheet is confined to. With no grammar,
 * `sectionScopeSelector('a,body')` produced `.cms-section--a,body` — a selector
 * *list*, one branch of which restyles the document. `.`, `#`, `[`, `>`, a
 * space and a backslash all did something similar.
 *
 * Lowercase alphanumerics in dash-separated groups, to 64 characters: no
 * leading or trailing dash, no doubled dash, nothing that is CSS syntax. The
 * same expression is enforced in the database (`app.is_section_slug`) so a row
 * cannot arrive from another direction.
 */
export const SECTION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isSectionSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && SECTION_SLUG.test(value)
}

export const SlotDef = z.object({
  id: z.string().regex(SLOT_ID, 'a slot id must be a letter followed by letters, digits, _ or -, up to 64 characters'),
  kind: z.enum(SLOT_KINDS),
  label: z.string().min(1),
  constraints: z.record(z.string(), z.unknown()).default({}),
})
export type SlotDef = z.infer<typeof SlotDef>

// One placed section on a page. Pages pin the def version they were built
// with; upgrades are explicit per-page actions (SPEC §5).
export const SectionInstance = z.object({
  section_def_id: z.string().min(1),
  section_def_version: z.number().int().min(1),
  values: z.record(z.string(), z.unknown()).default({}),
  hidden: z.boolean().default(false),
  hidden_at: z.array(z.enum(BREAKPOINTS)).default([]),
  label: z.string().default(''),
  custom_css: z.string().optional(),
  appearance: SectionAppearance.optional(),
})
export type SectionInstance = z.infer<typeof SectionInstance>

export const PageContent = z.array(SectionInstance)
export type PageContent = z.infer<typeof PageContent>
