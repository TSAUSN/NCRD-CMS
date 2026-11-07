import type { CollectionModel } from '@cms/schema'
import type { EntryState } from './collection-entries.ts'
import { collectionDraftEqual } from './collection-workspace-model.ts'

export const entryIdentity = (entry: EntryState) => entry.id ?? entry.clientId ?? entry.stableKey

export function recordTitle(entry: EntryState, model: CollectionModel): string {
  const value = entry.values[model.presentation.titleField]
  const text = typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : ''
  return text || 'Untitled item'
}

/** The picture field configured for this list. */
export function recordImage(entry: EntryState, model: CollectionModel): unknown {
  const key = model.presentation.imageField
  return key ? entry.values[key] : null
}

export function recordSubtitle(entry: EntryState, model: CollectionModel): string {
  const key = model.presentation.subtitleField
  const value = key ? entry.values[key] : null
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : ''
}

export function entryChanged(entry: EntryState): boolean {
  return (
    entry.publishedValues === null ||
    !collectionDraftEqual(entry.values, entry.publishedValues) ||
    entry.sortIndex !== entry.publishedSortIndex ||
    entry.archived !== entry.publishedArchived
  )
}
