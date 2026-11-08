import { listItemUnit } from '../../../../lib/list-items.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseCollectionEntryValues, type CollectionModel as CollectionModelValue } from '@cms/schema'
import { type ActionResult } from '../../../../lib/action-result.ts'
import type { CollectionWorkspace } from '../../../../lib/collection-queries.ts'
import { collectionDraftEqual, collectionPublicationChanges } from './collection-workspace-model.ts'
import { EntryState, clone } from './collection-entries.ts'
import { entryIdentity } from './collection-record-display.ts'

export function useCollectionDraft(selected: CollectionWorkspace['selected'], initialEntryId: string | undefined) {
  const [entries, setEntries] = useState<EntryState[]>(() => clone(selected?.entries ?? []))
  const [model, setModel] = useState<CollectionModelValue | null>(() => clone(selected?.draft ?? null))
  const [savedEntries, setSavedEntries] = useState(() => clone(selected?.entries ?? []))
  const [savedModel, setSavedModel] = useState<CollectionModelValue | null>(() => clone(selected?.draft ?? null))
  const [revision, setRevision] = useState(selected?.revision ?? 0)
  const [entryRevision, setEntryRevision] = useState(selected?.entryRevision ?? 0)
  const [publishedEntryRevision, setPublishedEntryRevision] = useState(selected?.publishedEntryRevision ?? 0)
  const [draftSchemaId, setDraftSchemaId] = useState(selected?.draftSchemaVersionId ?? null)
  const [publishedSchemaId, setPublishedSchemaId] = useState(selected?.publishedSchemaVersionId ?? null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const originalEntry = useRef<EntryState | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  useEffect(() => {
    setEntries(clone(selected?.entries ?? []))
    setSavedEntries(clone(selected?.entries ?? []))
    setModel(clone(selected?.draft ?? null))
    setSavedModel(clone(selected?.draft ?? null))
    setRevision(selected?.revision ?? 0)
    setEntryRevision(selected?.entryRevision ?? 0)
    setPublishedEntryRevision(selected?.publishedEntryRevision ?? 0)
    setDraftSchemaId(selected?.draftSchemaVersionId ?? null)
    setPublishedSchemaId(selected?.publishedSchemaVersionId ?? null)
    setExpanded(null)
    setChecked([])
  }, [
    selected?.id,
    selected?.revision,
    selected?.entryRevision,
    selected?.publishedEntryRevision,
    selected?.draftSchemaVersionId,
    selected?.publishedSchemaVersionId,
  ])
  // Keep the save result while the server sends the updated draft of the same list.
  useEffect(() => {
    setNotice(null)
  }, [selected?.id])

  useEffect(() => {
    if (!initialEntryId || !selected) return
    const entry = selected.entries.find(item => item.id === initialEntryId && !item.archived)
    if (entry) {
      originalEntry.current = clone(entry)
      setExpanded(entryIdentity(entry))
    } else
      setNotice({
        ok: false,
        kind: 'error',
        message: 'This item is no longer available. Choose another item from this list.',
      })
  }, [selected?.id, initialEntryId])

  const entriesNeedResave = entries.some(
    entry => !entry.archived && entry.id !== null && entry.schemaVersionId !== draftSchemaId,
  )
  const entryEdits = !collectionDraftEqual(entries, savedEntries)
  const entryDirty = entriesNeedResave || entryEdits
  const schemaDirty = !collectionDraftEqual(model, savedModel)
  const anythingDirty = entryDirty || schemaDirty
  const publicationChanges = model ? collectionPublicationChanges(savedEntries, model) : []
  const invalidEntryKeys = useMemo(
    () =>
      new Set(
        model
          ? entries
              .filter(entry => !entry.archived && !parseCollectionEntryValues(model.fields, entry.values).ok)
              .map(entry => entry.stableKey)
          : [],
      ),
    [entries, model],
  )
  const noun = listItemUnit(selected?.readerKey ?? '')
  const opened = entries.find(entry => entryIdentity(entry) === expanded)
  const changes = publicationChanges.length + (draftSchemaId !== publishedSchemaId ? 1 : 0)
  return {
    selected,
    entries,
    setEntries,
    model,
    setModel,
    savedEntries,
    setSavedEntries,
    savedModel,
    setSavedModel,
    revision,
    setRevision,
    entryRevision,
    setEntryRevision,
    publishedEntryRevision,
    setPublishedEntryRevision,
    draftSchemaId,
    setDraftSchemaId,
    publishedSchemaId,
    setPublishedSchemaId,
    expanded,
    setExpanded,
    originalEntry,
    checked,
    setChecked,
    deleteOpen,
    setDeleteOpen,
    notice,
    setNotice,
    entriesNeedResave,
    entryEdits,
    entryDirty,
    schemaDirty,
    anythingDirty,
    publicationChanges,
    invalidEntryKeys,
    noun,
    opened,
    changes,
  }
}

export type CollectionDraft = ReturnType<typeof useCollectionDraft>
