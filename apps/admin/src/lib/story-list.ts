import {
  featureStoryRows,
  storyDateInFeed,
  storyTagIds,
  storyAllowedInFeeds,
  type StoriesSettings,
  type StoryListPatch,
  applyStoryListPatch,
} from '@cms/schema'
export const STORY_LIST_STATUSES = ['all', 'review', 'untagged', 'live', 'hidden', 'removed'] as const
export type StoryListFilters = {
  q: string
  status: (typeof STORY_LIST_STATUSES)[number]
  main: string
  secondary: string
}
export type StoryListRow = {
  id: string
  stableKey: string
  values: Record<string, unknown>
  published: Record<string, unknown> | null
  changed: boolean
  hasText: boolean
  photoPreview: string | null
}
const keys = [
  'title',
  'summary',
  'newsroom_rank',
  'published_date',
  'tags',
  'region',
  'regions',
  'reviewed',
  'hidden',
  'feed_removed',
  'in_feed',
  'photo',
  'photo_note',
  'photo_is_sample',
  'body_is_sample',
  'story_url',
] as const
export function storyListValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(keys.filter(k => k in values).map(k => [k, values[k]]))
}
export function storyInSource(values: Record<string, unknown>): boolean {
  return values.feed_removed !== true && values.in_feed !== false
}
export function knownStoryTags(
  values: Record<string, unknown>,
  group: 'main' | 'secondary',
  settings: StoriesSettings,
): string[] {
  const tags = group === 'main' ? settings.mainTags : settings.secondaryTags
  return storyTagIds(values, group).filter(id => tags.some(t => t.id === id))
}
export function storyListLive(row: StoryListRow, settings: StoriesSettings, now = new Date()): boolean {
  return Boolean(
    row.published && storyAllowedInFeeds(row.published, settings) && storyDateInFeed(row.published.published_date, now),
  )
}
export function filterStoryList(
  rows: readonly StoryListRow[],
  filters: StoryListFilters,
  settings: StoriesSettings,
  publishedSettings = settings,
): StoryListRow[] {
  const q = filters.q.trim().toLocaleLowerCase('en-US')
  return rows.filter(row => {
    const v = row.values,
      main = knownStoryTags(v, 'main', settings),
      secondary = knownStoryTags(v, 'secondary', settings)
    if (
      q &&
      ![v.title, v.summary].some(value => typeof value === 'string' && value.toLocaleLowerCase('en-US').includes(q))
    )
      return false
    if (filters.status === 'review' && !(storyInSource(v) && v.reviewed !== true)) return false
    if (filters.status === 'untagged' && !(storyInSource(v) && (!main.length || !secondary.length))) return false
    if (filters.status === 'live' && !storyListLive(row, publishedSettings)) return false
    if (filters.status === 'hidden' && v.hidden !== true) return false
    if (filters.status === 'removed' && storyInSource(v)) return false
    if (filters.main === '__none' ? main.length : filters.main && !main.includes(filters.main)) return false
    if (filters.secondary === '__none' ? secondary.length : filters.secondary && !secondary.includes(filters.secondary))
      return false
    return true
  })
}
export function optimisticStoryList(
  rows: readonly StoryListRow[],
  jobs: readonly { entryId: string; patch: StoryListPatch }[],
  settings: StoriesSettings,
): StoryListRow[] {
  let next = [...rows]
  for (const job of jobs) {
    if (job.patch.action === 'featured') {
      next = featureStoryRows(next, job.entryId, job.patch.value)
      continue
    }
    next = next.map(row =>
      row.id === job.entryId
        ? { ...row, values: applyStoryListPatch(row.values, job.patch, settings), changed: true }
        : row,
    )
  }
  return next
}

export function storyListFilters(query: URLSearchParams): StoryListFilters {
  const status = query.get('status') ?? 'all'
  return {
    q: (query.get('q') ?? '').slice(0, 120),
    status: STORY_LIST_STATUSES.includes(status as StoryListFilters['status'])
      ? (status as StoryListFilters['status'])
      : 'all',
    main: (query.get('main') ?? query.get('sector') ?? '').slice(0, 80),
    secondary: (query.get('secondary') ?? '').slice(0, 80),
  }
}
export function storyListQuery(filters: StoryListFilters): URLSearchParams {
  const query = new URLSearchParams()
  if (filters.q) query.set('q', filters.q)
  if (filters.status !== 'all') query.set('status', filters.status)
  if (filters.main) query.set('main', filters.main)
  if (filters.secondary) query.set('secondary', filters.secondary)
  return query
}
export function storyPreviewHref(siteId: string, filters: StoryListFilters): string {
  const query = storyListQuery(filters)
  return '/preview/stories/' + encodeURIComponent(siteId) + (query.size ? '?' + query.toString() : '')
}
