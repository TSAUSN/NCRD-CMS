import {
  orderedNewsroomStories,
  newsroomSelection,
  storyVisible,
  storyDateInFeed,
  storyMatchesTags,
  storyAllowedInFeeds,
  type StoriesSettings,
  StructuredRepeatBinding,
  structuredRepeatItemFieldNodes,
  type CollectionField,
  type StructuredRepeatFieldNode,
} from '@cms/schema'

export type CollectionBindingOption = {
  id: string
  readerKey: string
  name: string
  compatible: boolean
  problem: string | null
  filters?: { key: string; label: string; values: string[] }[]
  storyTags?: StoryFeedTags
  entries: { stableKey: string; title: string }[]
}

export type StoryFeedTags = Pick<StoriesSettings, 'mainLabel' | 'secondaryLabel' | 'source'> & {
  mainTags: { id: string; label: string }[]
  secondaryTags: { id: string; label: string }[]
}

/** Same sink compatibility as the renderer and SQL collection-repeat gate. */
export function collectionBindingProblem(
  repeat: StructuredRepeatFieldNode,
  fields: readonly CollectionField[],
): string | null {
  const byKey = new Map(fields.map(field => [field.key, field.type]))
  for (const node of structuredRepeatItemFieldNodes(repeat)) {
    const type = byKey.get(node.field)
    const allowed =
      node.type === 'text'
        ? ['text', 'number', 'date', 'boolean', 'select']
        : node.type === 'icon'
          ? ['text', 'select']
          : node.type === 'link'
            ? ['url']
            : [node.type]
    if (node.type === 'repeat' || type === undefined || !allowed.includes(type)) {
      return `This layout needs “${node.field}” as ${node.type === 'link' ? 'a link' : node.type}.`
    }
  }
  return null
}

export function readCollectionBinding(value: unknown): StructuredRepeatBinding | null {
  const parsed = StructuredRepeatBinding.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Manual selection is ordered; add/remove never silently sorts chosen records. */
export function toggleCollectionEntry(keys: readonly string[], key: string, selected: boolean): string[] {
  if (!selected) return keys.filter(current => current !== key)
  return keys.includes(key) || keys.length >= 200 ? [...keys] : [...keys, key]
}
export function moveCollectionEntry(keys: readonly string[], index: number, offset: -1 | 1): string[] {
  const next = [...keys]
  const destination = index + offset
  if (index < 0 || index >= next.length || destination < 0 || destination >= next.length) return next
  ;[next[index], next[destination]] = [next[destination]!, next[index]!]
  return next
}

/** Dynamic page choices use the same bounded ordering and exact category match as SQL. */
export function selectListRows<T extends { id: string; stableKey: string; values: unknown; createdAt: string | Date }>(
  rows: readonly T[],
  selection: StructuredRepeatBinding['selection'],
  now = new Date(),
  stories?: StoriesSettings,
): T[] {
  if (selection.mode === 'manual')
    return selection.stableKeys.flatMap(key =>
      rows.filter(
        row =>
          row.stableKey === key &&
          (!stories ||
            Boolean(
              row.values && typeof row.values === 'object' && storyVisible(row.values as Record<string, unknown>),
            )),
      ),
    )
  let chosen = [...rows]
  if (stories)
    chosen = chosen.filter(row =>
      Boolean(
        row.values &&
        typeof row.values === 'object' &&
        storyAllowedInFeeds(row.values as Record<string, unknown>, stories) &&
        storyDateInFeed((row.values as Record<string, unknown>).published_date, now),
      ),
    )
  if (selection.filter) {
    const { field, value } = selection.filter
    chosen = chosen.filter(row => {
      const actual =
        row.values && typeof row.values === 'object' ? (row.values as Record<string, unknown>)[field] : undefined
      return (
        typeof actual === 'string' &&
        (field === 'tag' || field === 'tags' ? actual.split(',') : [actual]).some(
          tag => tag.trim().toLowerCase() === value.trim().toLowerCase(),
        )
      )
    })
  }
  if (selection.storyTags)
    chosen = chosen.filter(row =>
      Boolean(
        row.values &&
        typeof row.values === 'object' &&
        storyMatchesTags(
          row.values as Record<string, unknown>,
          selection.storyTags!.main,
          selection.storyTags!.secondary,
        ),
      ),
    )
  if (selection.excludeStableKey) chosen = chosen.filter(row => row.stableKey !== selection.excludeStableKey)
  if (selection.dateField) {
    const field = selection.dateField
    const date = (row: T) => {
      const v = row.values && typeof row.values === 'object' ? (row.values as Record<string, unknown>)[field] : null
      return typeof v === 'string' ? v : ''
    }
    if (selection.maxAgeMonths) {
      const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - selection.maxAgeMonths, 1))
      const last = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate()
      cutoff.setUTCDate(Math.min(now.getUTCDate(), last))
      const key = cutoff.toISOString().slice(0, 10)
      chosen = chosen.filter(row => date(row) >= key)
    }
    chosen.sort((a, b) => date(b).localeCompare(date(a)))
  } else if (selection.order === 'newest') {
    const dateKey = (value: string | Date) => (value instanceof Date ? value.toISOString() : value)
    chosen.sort((a, b) => dateKey(b.createdAt).localeCompare(dateKey(a.createdAt)) || b.id.localeCompare(a.id))
  }
  return (
    stories && selection.limit <= 200 && newsroomSelection(selection) ? orderedNewsroomStories(chosen) : chosen
  ).slice(0, selection.limit)
}
