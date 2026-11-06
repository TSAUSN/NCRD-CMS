import { COLLECTION_LIMITS, type CollectionField } from './collections.ts'
import { orderedNewsroomStories, storyTagIds, type StoryCatalog } from './stories.ts'
export const STORY_WIDGET_SOURCE_LIMIT = COLLECTION_LIMITS.entries
const STORY_WIDGET_FIELDS = new Set([
  'title',
  'summary',
  'newsroom_rank',
  'published_date',
  'tags',
  'regions',
  'region',
  'region_label',
  'countries',
  'photo',
  'photo_note',
  'sector_links',
  'story_url',
  'reviewed',
  'hidden',
  'feed_removed',
  'in_feed',
  'photo_is_sample',
  'body_is_sample',
])
export function storyWidgetCardValues(
  values: Record<string, unknown>,
  fields: readonly CollectionField[],
): Record<string, unknown> {
  const required = new Set(fields.filter(field => field.required).map(field => field.key))
  return Object.fromEntries(Object.entries(values).filter(([key]) => STORY_WIDGET_FIELDS.has(key) || required.has(key)))
}
export function storyWidgetSelection<T extends { mode: string; limit?: number }>(selection: T, widget: boolean): T {
  return widget && selection.mode === 'automatic' ? { ...selection, limit: STORY_WIDGET_SOURCE_LIMIT } : selection
}
type Row = { values: unknown }
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
/** Shared by public widgets and their writing-screen placement explanation. */
export function storyWidgetMaximum(catalog: Pick<StoryCatalog, 'sectorPageLimit'> | undefined, path = ''): number {
  return catalog?.sectorPageLimit === 6 && /^\/ways-we-help\/[^/]+$/.test(path) ? 6 : STORY_WIDGET_SOURCE_LIMIT
}
export function storyWorldLimit(value: unknown): number {
  return String(value) === '200'
    ? STORY_WIDGET_SOURCE_LIMIT
    : /^(1[0-9]{2}|[1-9][0-9]?)$/.test(String(value ?? ''))
      ? Number(value)
      : STORY_WIDGET_SOURCE_LIMIT
}
export function storySplitPageSize(value: unknown): number {
  return /^(3|6|9|12|24)$/.test(String(value)) ? Number(value) : 12
}
export function orderedStoryWidgetRows<T extends Row>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    String(record(b.values).published_date ?? '').localeCompare(String(record(a.values).published_date ?? '')),
  )
}
export function selectedStoryWidgetRows<T extends Row>(
  rows: readonly T[],
  view: 'recent' | 'sectors' | 'map',
  tag: string,
  limit: number,
  featured = true,
): T[] {
  return (
    view === 'recent'
      ? featured
        ? orderedNewsroomStories(rows)
        : orderedStoryWidgetRows(rows)
      : rows.filter(row => storyTagIds(record(row.values), view === 'map' ? 'secondary' : 'main').includes(tag))
  ).slice(0, limit)
}

/** A manual article stays readable; only a definition-owned feed opts into dates. */
export function isStoryFeedSlot(
  slot: { id: string; kind: string; constraints?: Record<string, unknown> },
  slug?: string,
): boolean {
  return (
    slot.kind === 'repeat' &&
    (slot.constraints?.storyFeed === true || (slug === 'core-newsroom' && slot.id === 'stories'))
  )
}
