import { type CollectionEntryDraft } from '@cms/schema'
import type { CollectionWorkspace } from '../../../../lib/collection-queries.ts'

export type EntryState = NonNullable<CollectionWorkspace['selected']>['entries'][number] & { clientId?: string }

export const clone = <T>(value: T): T => structuredClone(value)

export function activeDrafts(entries: readonly EntryState[]): CollectionEntryDraft[] {
  return entries.filter(entry => !entry.archived).map(({ id, stableKey, values }) => ({ id, stableKey, values }))
}
