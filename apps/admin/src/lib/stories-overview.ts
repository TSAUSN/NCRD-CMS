import { StoryTagFilter, storyAllowedInFeeds, type StoriesSettings } from '@cms/schema'
import { knownStoryTags, storyInSource, type StoryListRow } from './story-list.ts'
import { storyFeedState } from './stories-model.ts'
export type StoryFeedUse = { id: string; title: string; path: string; main: string[] | null }
export function storyFeedUse(page: { id: string; title: string; slug: string; bindings: unknown }): StoryFeedUse[] {
  if (!Array.isArray(page.bindings)) return []
  return page.bindings.flatMap(value => {
    if (!value || typeof value !== 'object' || value.readerKey !== 'stories' || value.selection?.mode !== 'automatic')
      return []
    const filter = value.selection.filter
    if (filter && (!['tags', 'tag', 'region', 'regions'].includes(filter.field) || typeof filter.value !== 'string'))
      return []
    let main: string[] | null = filter && ['tags', 'tag'].includes(filter.field) ? [filter.value] : null
    if (value.selection.storyTags !== undefined) {
      const parsed = StoryTagFilter.safeParse(value.selection.storyTags)
      if (!parsed.success) return []
      if (parsed.data.main.length) main = main ? main.filter(id => parsed.data.main.includes(id)) : parsed.data.main
    }
    return [{ id: page.id, title: page.title, path: '/' + page.slug, main }]
  })
}
/** Current coverage uses saved draft dates/tags; Live uses published dates/tags/policy. */
export function storiesOverview(
  rows: readonly StoryListRow[],
  settings: StoriesSettings,
  published: StoriesSettings,
  uses: readonly StoryFeedUse[] = [],
  now = new Date(),
) {
  const today = now.toISOString().slice(0, 10),
    eligible = (row: StoryListRow) =>
      String(row.values.published_date ?? '') <= today && storyFeedState(row, now).active
  const source = rows.filter(row => storyInSource(row.values)),
    current = source.filter(eligible)
  const live = rows.filter(
    row =>
      row.published && storyAllowedInFeeds(row.published, published) && eligible({ ...row, values: row.published }),
  )
  const tagged = (row: StoryListRow, id: string, values = row.values) =>
    knownStoryTags(values, 'main', settings).includes(id)
  const groups = settings.mainTags.map(tag => ({
    ...tag,
    rows: current.filter(row => tagged(row, tag.id)),
    live: live.filter(row => tagged(row, tag.id, row.published!)).length,
    uses: uses
      .filter(use => !use.main || use.main.includes(tag.id))
      .filter((use, i, all) => all.findIndex(other => other.id === use.id) === i)
      .sort(
        (a, b) =>
          Number(a.path.startsWith('/stories/')) - Number(b.path.startsWith('/stories/')) ||
          Number(b.path === '/' + 'ways-we-help/' + tag.id) - Number(a.path === '/' + 'ways-we-help/' + tag.id) ||
          a.path.localeCompare(b.path),
      ),
  }))
  const noMain = current.filter(row => !knownStoryTags(row.values, 'main', settings).length),
    noMainLive = live.filter(row => !knownStoryTags(row.published!, 'main', published).length).length
  const missing = source.filter(
    row =>
      !knownStoryTags(row.values, 'main', settings).length || !knownStoryTags(row.values, 'secondary', settings).length,
  )
  const leaving = current
    .filter(row => storyAllowedInFeeds(row.values, settings))
    .map(row => ({ row, ...storyFeedState(row, now) }))
    .filter(row => row.days <= 30)
    .sort((a, b) => a.days - b.days || a.row.stableKey.localeCompare(b.row.stableKey))
  const noMainUses = uses
    .filter(use => !use.main)
    .filter((use, i, all) => all.findIndex(other => other.id === use.id) === i)
    .sort((a, b) => a.path.localeCompare(b.path))
  return {
    groups,
    noMain,
    noMainLive,
    noMainUses,
    missing,
    leaving,
    currentCount: current.length,
    liveCount: live.length,
  }
}
