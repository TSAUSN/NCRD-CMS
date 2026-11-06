import { storyVisible, storyDateInFeed, isStoryFeedSlot, type SlotDef } from '@cms/schema'
import { resolvedCollection } from './structured.ts'
export { isStoryFeedSlot } from '@cms/schema'
export function withStoryFeedDates(
  values: Record<string, unknown>,
  slots: readonly SlotDef[] = [],
  slug?: string,
  now = new Date(),
): Record<string, unknown> {
  let next = values
  for (const slot of slots) {
    if (!isStoryFeedSlot(slot, slug)) continue
    const list = resolvedCollection(values[slot.id])
    if (!list || list.readerKey !== 'stories') continue
    const entries = list.entries.filter(entry =>
      Boolean(
        entry.values &&
        typeof entry.values === 'object' &&
        !Array.isArray(entry.values) &&
        storyDateInFeed((entry.values as Record<string, unknown>).published_date, now),
      ),
    )
    if (entries.length !== list.entries.length) next = { ...next, [slot.id]: { ...list, entries } }
  }
  return next
}

/** Trusted resolved Story bindings can be nested in any section, not just feeds. */
export function withStoryVisibility<T>(value: T): T {
  return storyVisibility(value, 0)
}
function storyVisibility<T>(value: T, depth: number): T {
  if (depth > 64) return value
  const list = resolvedCollection(value)
  if (list?.readerKey === 'stories') {
    const entries = list.entries.filter(
      entry =>
        entry.values &&
        typeof entry.values === 'object' &&
        !Array.isArray(entry.values) &&
        storyVisible(entry.values as Record<string, unknown>),
    )
    return entries.length === list.entries.length ? value : ({ ...list, entries } as T)
  }
  if (Array.isArray(value)) {
    const next = value.map(item => storyVisibility(item, depth + 1))
    return next.some((item, i) => item !== value[i]) ? (next as T) : value
  }
  if (value && typeof value === 'object') {
    let changed = false
    const entries = Object.entries(value).map(([key, item]) => {
      const next = storyVisibility(item, depth + 1)
      changed ||= next !== item
      return [key, next]
    })
    return changed ? (Object.fromEntries(entries) as T) : value
  }
  return value
}
