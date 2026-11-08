import { storySourceCapabilities, type StoryTagFilter, type StructuredRepeatBinding } from '@cms/schema'
import { readCollectionBinding, type StoryFeedTags } from './collection-binding.ts'
export function storyFeedChoice(value: unknown): {
  selection: Extract<StructuredRepeatBinding['selection'], { mode: 'automatic' }> | null
  tags: StoryTagFilter
  keepEarlierFilter: boolean
} {
  const binding = readCollectionBinding(value)
  const selection =
    binding?.readerKey === 'stories' && binding.selection.mode === 'automatic' ? binding.selection : null
  const filter = selection?.filter
  const main = filter?.field === 'tags' ? [filter.value] : []
  const secondary = filter && ['region', 'regions'].includes(filter.field) ? [filter.value] : []
  return {
    selection,
    tags: selection?.storyTags ?? { main, secondary },
    keepEarlierFilter: Boolean(
      filter && (selection?.storyTags || !['tags', 'region', 'regions'].includes(filter.field)),
    ),
  }
}
export function storyFeedBinding(value: unknown, tags: StoryTagFilter, limit: number): StructuredRepeatBinding {
  const previous = storyFeedChoice(value)
  return {
    readerKey: 'stories',
    selection: {
      mode: 'automatic',
      order: 'newest',
      dateField: 'published_date',
      maxAgeMonths: 13,
      limit,
      storyTags: tags,
      ...(previous.selection?.excludeStableKey ? { excludeStableKey: previous.selection.excludeStableKey } : {}),
      ...(previous.keepEarlierFilter ? { filter: previous.selection!.filter } : {}),
    },
  }
}
export function storyFeedMaximum(catalog: StoryFeedTags, path: string): number {
  const { sectorPages } = storySourceCapabilities(catalog.source)
  if (!sectorPages || !path.startsWith(sectorPages.pathPrefix)) return 200
  return /^[^/]+\/?$/.test(path.slice(sectorPages.pathPrefix.length)) ? sectorPages.limit : 200
}
