import { useReorderableList } from '../../../../components/ui/use-reorderable-list.ts'
import { flatReorderIntent, type FlatMove } from '../../../../components/ui/flat-reorder.ts'
import { blankValues, slugifyStableKey } from './collection-workspace-model.ts'
import { EntryState, clone } from './collection-entries.ts'
import { entryIdentity, recordTitle } from './collection-record-display.ts'
import type { CollectionDraft } from './use-collection-draft.ts'

export function useCollectionEntryEditing(draft: CollectionDraft, canEdit: boolean, busy: () => boolean) {
  const { entries, setEntries, model, setNotice, originalEntry, expanded, setExpanded, checked, setChecked } = draft
  const reorder = useReorderableList({
    mimeType: 'application/x-cms-list-item',
    decide: point =>
      busy() || !canEdit
        ? { status: 'blocked', message: 'Wait for the current changes to finish before moving an item.' }
        : flatReorderIntent(entries.filter(entry => !entry.archived).map(entryIdentity), point),
    apply: move => applyEntryMove(move),
  })
  // A saved confirmation belongs to the previous edit, not the new draft.
  function clearEntrySuccess() {
    setNotice(previous => (previous?.ok ? null : previous))
  }

  function updateEntry(key: string, update: (entry: EntryState) => EntryState) {
    if (busy() || !canEdit) return
    clearEntrySuccess()
    setEntries(current => current.map(entry => (entryIdentity(entry) === key ? update(entry) : entry)))
  }

  function setValue(entryKey: string, fieldKey: string, value: unknown) {
    updateEntry(entryKey, entry => ({ ...entry, values: { ...entry.values, [fieldKey]: value } }))
  }

  function addEntry() {
    if (!model || busy() || !canEdit) return
    clearEntrySuccess()
    const used = new Set(entries.map(entry => entry.stableKey))
    const stableKey = slugifyStableKey('new-item', used)
    const next: EntryState = {
      id: null,
      clientId: crypto.randomUUID(),
      schemaVersionId: null,
      stableKey,
      values: blankValues(model.fields),
      revision: 0,
      sortIndex: entries.filter(entry => !entry.archived).length,
      publishedSortIndex: null,
      publishedValues: null,
      archived: false,
      publishedArchived: false,
    }
    setEntries(current => [...current, next])
    originalEntry.current = null
    setExpanded(entryIdentity(next))
  }

  function duplicateEntry(source: EntryState) {
    if (busy() || !canEdit) return
    clearEntrySuccess()
    const used = new Set(entries.map(entry => entry.stableKey))
    const stableKey = slugifyStableKey(`${source.stableKey}-copy`, used)
    const next = {
      ...clone(source),
      id: null,
      clientId: crypto.randomUUID(),
      schemaVersionId: null,
      stableKey,
      revision: 0,
      publishedValues: null,
      archived: false,
    }
    setEntries(current => [...current, next])
    originalEntry.current = null
    setExpanded(entryIdentity(next))
  }

  function applyEntryMove({ from, to }: FlatMove) {
    if (busy() || !canEdit || from === to) return
    const active = entries.filter(entry => !entry.archived)
    const source = active[from]
    if (!source || !active[to] || !model) return
    clearEntrySuccess()
    const key = entryIdentity(source)
    setEntries(current => {
      const active = current.filter(entry => !entry.archived)
      if (!active[from] || entryIdentity(active[from]) !== key || !active[to]) return current
      const [item] = active.splice(from, 1)
      active.splice(to, 0, item!)
      return [
        ...active.map((entry, sortIndex) => ({ ...entry, sortIndex })),
        ...current.filter(entry => entry.archived),
      ]
    })
    return `Moved ${recordTitle(source, model)} to position ${to + 1}.`
  }

  function moveEntry(key: string, direction: -1 | 1) {
    const active = entries.filter(entry => !entry.archived)
    const from = active.findIndex(entry => entryIdentity(entry) === key)
    const to = from + direction
    if (from < 0 || to < 0 || to >= active.length) return
    const moved = applyEntryMove({ from, to })
    if (moved) reorder.announce(moved)
  }

  function openEntry(entry: EntryState) {
    if (busy()) return
    originalEntry.current = clone(entry)
    setExpanded(entryIdentity(entry))
  }
  function cancelEntry() {
    if (busy()) return
    const key = expanded
    const original = originalEntry.current
    setEntries(current =>
      original
        ? current.map(entry => (entryIdentity(entry) === key ? original : entry))
        : current.filter(entry => entryIdentity(entry) !== key),
    )
    setExpanded(null)
  }
  function bulk(hidden: boolean) {
    if (busy() || !canEdit) return
    clearEntrySuccess()
    setEntries(current =>
      current.map(entry => (checked.includes(entryIdentity(entry)) ? { ...entry, archived: hidden } : entry)),
    )
    setChecked([])
  }
  return {
    reorder,
    updateEntry,
    setValue,
    addEntry,
    duplicateEntry,
    openEntry,
    cancelEntry,
    bulk,
    moveEntry,
  }
}
