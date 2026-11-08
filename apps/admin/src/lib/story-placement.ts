import {
  storyWidgetSelection,
  newsroomSelection,
  storyVisible,
  storyAllowedInFeeds,
  storyDateInFeed,
  isStoryFeedSlot,
  storyCatalog,
  storyWidgetMaximum,
  storyWorldLimit,
  storySplitPageSize,
  orderedStoryWidgetRows,
  selectedStoryWidgetRows,
  type StoriesSettings,
  type StructuredRepeatBinding,
  type SlotDef,
} from '@cms/schema'
import { readCollectionBinding, selectListRows } from './collection-binding.ts'
export type StoryPlacementRow = {
  id: string
  stableKey: string
  createdAt: string
  sortIndex: number
  values: Record<string, unknown>
}
export type StoryPlacementFeed = {
  selection: StructuredRepeatBinding['selection']
  kind: 'feed' | 'world' | 'split'
  heading: string
  perRegion: unknown
  pageSize: unknown
  hiddenAt: string[]
  dateWindow: boolean
}
export type StoryPlacementPage = {
  id: string
  title: string
  path: string
  article: boolean
  feeds: StoryPlacementFeed[]
}
export type StoryPlacementContext = {
  pages: StoryPlacementPage[]
  rows: StoryPlacementRow[]
  candidate: Omit<StoryPlacementRow, 'values'>
  privateSite: boolean
  readAt: string
  fields: string[]
  hasArticle: boolean
}
const STORY_PLACEMENT_FIELDS = [
  'tags',
  'regions',
  'region',
  'published_date',
  'reviewed',
  'hidden',
  'feed_removed',
  'in_feed',
]
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
/** Read the saved bindings, not guessed sector/home/newsroom names. */
export function storyPlacementFeeds(
  sections: unknown,
  slugs: ReadonlyMap<string, string>,
  slotsByVersion: ReadonlyMap<string, readonly Pick<SlotDef, 'id' | 'kind' | 'constraints'>[]> = new Map(),
): StoryPlacementFeed[] {
  if (!Array.isArray(sections)) return []
  const feeds: StoryPlacementFeed[] = []
  for (const value of sections) {
    const section = record(value)
    if (section.hidden === true) continue
    const values = record(section.values),
      slug = slugs.get(String(section.section_def_id)) ?? '',
      kind = slug === 'core-story-world' ? 'world' : slug === 'core-story-split' ? 'split' : 'feed',
      hiddenAt = Array.isArray(section.hidden_at)
        ? section.hidden_at.filter((v): v is string => typeof v === 'string')
        : []
    if (['sm', 'md', 'lg'].every(size => hiddenAt.includes(size))) continue
    const slots = slotsByVersion.get(String(section.section_def_id) + ':' + String(section.section_def_version))
    function walk(node: unknown, key: string, direct: boolean) {
      const binding = readCollectionBinding(node)
      if (binding) {
        if (binding.readerKey === 'stories') {
          const slot = slots?.find(slot => slot.id === key),
            dateWindow =
              direct &&
              (slot
                ? isStoryFeedSlot(slot, slug)
                : !slots &&
                  ['core-stories', 'core-newsroom', 'core-story-world', 'core-story-split'].includes(slug) &&
                  key === 'stories')
          feeds.push({
            selection: binding.selection,
            kind,
            heading: typeof values.heading === 'string' ? values.heading : 'Stories',
            perRegion: values.per_region ?? null,
            pageSize: values.page_size ?? null,
            hiddenAt,
            dateWindow,
          })
        }
        return
      }
      if (Array.isArray(node)) node.forEach(value => walk(value, key, false))
      else if (node && typeof node === 'object') Object.values(node).forEach(value => walk(value, key, false))
    }
    for (const [key, node] of Object.entries(values)) walk(node, key, true)
  }
  return feeds
}
export function storyPlacementFields(pages: readonly StoryPlacementPage[]): string[] {
  return [
    ...new Set([
      ...STORY_PLACEMENT_FIELDS,
      ...pages.flatMap(page =>
        page.feeds.flatMap(feed =>
          feed.selection.mode === 'automatic'
            ? [feed.selection.dateField, feed.selection.filter?.field].filter((key): key is string => Boolean(key))
            : [],
        ),
      ),
    ]),
  ]
}
const validDay = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(new Date(value + 'T00:00:00Z').getTime()) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
/** Project this one draft over other published rows. Publication still rechecks. */
export function storyPlacement(
  context: StoryPlacementContext,
  values: Record<string, unknown>,
  settings: StoriesSettings,
) {
  const now = new Date(context.readAt),
    today = now.toISOString().slice(0, 10),
    date = values.published_date
  if (!validDay(date))
    return {
      asOf: today,
      future: false,
      places: [] as { id: string; title: string; path: string; article: boolean; views: string[] }[],
      reason: 'Choose a story date before publishing. This draft stays out of feeds.',
      hasArticle: context.hasArticle && storyVisible(values),
      privateSite: context.privateSite,
    }
  const future = date > today,
    asOf = future ? date : today,
    at = new Date(asOf + 'T00:00:00Z'),
    candidate = { ...context.candidate, values },
    rows = [...context.rows.filter(row => row.id !== candidate.id), candidate].sort(
      (a, b) => a.sortIndex - b.sortIndex || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    ),
    eligible = rows.filter(
      row => storyAllowedInFeeds(row.values, settings) && storyDateInFeed(row.values.published_date, at),
    ),
    catalog = storyCatalog(settings),
    has = (pool: readonly StoryPlacementRow[]) => pool.some(row => row.id === candidate.id)
  const places = context.pages
    .flatMap(page => {
      const views = new Set<string>(),
        maximum = storyWidgetMaximum(catalog, page.path)
      for (const feed of page.feeds) {
        const selection = storyWidgetSelection(feed.selection, feed.kind !== 'feed')
        const selected = selectListRows(
            selection.mode === 'automatic' ? eligible : rows.filter(row => storyVisible(row.values)),
            selection,
            at,
            settings,
          ),
          chosen = feed.dateWindow ? selected.filter(row => storyDateInFeed(row.values.published_date, at)) : selected,
          pool = feed.kind === 'split' ? orderedStoryWidgetRows(chosen) : chosen,
          suffix = feed.hiddenAt.length
            ? ' (hidden on ' +
              feed.hiddenAt
                .map(size => (size === 'sm' ? 'phones' : size === 'md' ? 'tablets' : size === 'lg' ? 'desktop' : size))
                .join(', ') +
              ')'
            : ''
        if (feed.kind === 'feed') {
          if (has(pool)) views.add((feed.heading || 'Stories') + suffix)
          continue
        }
        if (
          feed.kind === 'split' &&
          has(selectedStoryWidgetRows(pool, 'recent', '', maximum, maximum !== 6 && newsroomSelection(feed.selection)))
        ) {
          const initial = Math.min(storySplitPageSize(feed.pageSize), maximum),
            more =
              selectedStoryWidgetRows(
                pool,
                'recent',
                '',
                maximum,
                maximum !== 6 && newsroomSelection(feed.selection),
              ).findIndex(row => row.id === candidate.id) >= initial
          views.add('Recently Published' + (more ? ' · after Show more stories' : '') + suffix)
        }
        if (feed.kind === 'split')
          for (const tag of catalog.mainTags)
            if (has(selectedStoryWidgetRows(pool, 'sectors', tag.id, maximum)))
              views.add(
                (catalog.mainLabel === 'Project Sectors' ? 'By Project Sector' : 'By ' + catalog.mainLabel) +
                  ' · ' +
                  tag.label +
                  suffix,
              )
        const limit = feed.kind === 'world' ? Math.min(storyWorldLimit(feed.perRegion), maximum) : maximum
        for (const tag of catalog.secondaryTags)
          if (has(selectedStoryWidgetRows(pool, 'map', tag.id, limit)))
            views.add((tag.areas.length ? 'By Map' : 'Region list (map area not set)') + ' · ' + tag.label + suffix)
      }
      return views.size
        ? [{ id: page.id, title: page.title, path: page.path, article: page.article, views: [...views] }]
        : []
    })
    .sort(
      (a, b) =>
        Number(a.article) - Number(b.article) ||
        Number(b.path === '/') - Number(a.path === '/') ||
        a.title.localeCompare(b.title),
    )
  const reason =
    values.hidden === true
      ? 'Hidden from pages and feeds.'
      : values.feed_removed === true || values.in_feed === false
        ? 'No longer in the connected source feed; kept out of pages and feeds.'
        : !settings.publishUnreviewed && values.reviewed !== true
          ? 'Mark the tags Reviewed in Stories before this story can enter automatic feeds.'
          : !storyDateInFeed(date, at)
            ? 'Outside the 13-month automatic feed window.'
            : places.length
              ? ''
              : 'No saved page feed matches these choices or this story is beyond its display limit.'
  return {
    asOf,
    future,
    places,
    reason,
    hasArticle: context.hasArticle && storyVisible(values),
    privateSite: context.privateSite,
  }
}
