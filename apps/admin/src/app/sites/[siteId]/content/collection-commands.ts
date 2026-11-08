import { submitCollectionReview } from '../../../collection-review-actions.ts'
import { parseCollectionEntryValues, type CollectionModel as CollectionModelValue } from '@cms/schema'
import {
  publishCollectionEntries,
  publishCollectionSchema,
  saveCollectionEntries,
  saveCollectionSchema,
} from '../../../actions/collections.ts'
import { type ActionResult } from '../../../../lib/action-result.ts'
import { EntryState, clone, activeDrafts } from './collection-entries.ts'
import type { RefObject } from 'react'
import type { CollectionDraft } from './use-collection-draft.ts'

function collectionForm(siteId: string, collectionId: string) {
  const data = new FormData()
  data.set('siteId', siteId)
  data.set('collectionId', collectionId)
  return data
}

function publishedEntry(entry: EntryState): EntryState {
  return entry.archived
    ? { ...entry, publishedArchived: true }
    : {
        ...entry,
        publishedValues: clone(entry.values),
        publishedSortIndex: entry.sortIndex,
        publishedArchived: false,
      }
}

type CollectionCommandOptions = {
  siteId: string
  canEdit: boolean
  canPublish: boolean
  reviewOpen: boolean
  submitNote: string
  setSubmitOpen: (open: boolean) => void
  setSubmitNote: (note: string) => void
  setPublishOpen: (open: boolean) => void
  setSchemaOpen: (open: boolean) => void
  refresh: () => void
  busy: () => boolean
  actionInFlight: RefObject<boolean>
  selectionEpoch: RefObject<number>
  runAction: RunCollectionAction
}
type RunCollectionAction = <T>(work: (isCurrent: () => boolean) => Promise<T>) => Promise<T | undefined> | undefined

export function collectionCommands(
  draft: CollectionDraft,
  {
    siteId,
    canEdit,
    canPublish,
    reviewOpen,
    submitNote,
    setSubmitOpen,
    setSubmitNote,
    setPublishOpen,
    setSchemaOpen,
    refresh,
    busy,
    actionInFlight,
    selectionEpoch,
    runAction,
  }: CollectionCommandOptions,
) {
  const {
    selected,
    model,
    revision,
    entryRevision,
    publishedEntryRevision,
    setNotice,
    schemaDirty,
    entryDirty,
    entries,
    draftSchemaId,
    setEntryRevision,
    setEntries,
    setSavedEntries,
    setExpanded,
    setChecked,
    setPublishedEntryRevision,
    setRevision,
    setDraftSchemaId,
    setModel,
    setSavedModel,
    setPublishedSchemaId,
  } = draft
  function acknowledgeEntries(snapshot: EntryState[], savedRevision: number) {
    const saved = snapshot.map(entry => (entry.archived ? entry : { ...entry, schemaVersionId: draftSchemaId }))
    setEntryRevision(savedRevision)
    setEntries(clone(saved))
    setSavedEntries(clone(saved))
    setExpanded(null)
    setChecked([])
  }

  function submitForReview() {
    if (!selected || busy()) return
    const data = new FormData()
    data.set('collectionId', selected.id)
    data.set('schemaRevision', String(revision))
    data.set('entryRevision', String(entryRevision))
    data.set('note', submitNote)
    runAction(async isCurrent => {
      const outcome = await submitCollectionReview(data)
      if (!isCurrent()) return
      setNotice(
        outcome.ok
          ? { ok: true, revision, versionId: null, message: outcome.message }
          : { ok: false, kind: 'error', message: outcome.message },
      )
      if (outcome.ok) {
        setSubmitOpen(false)
        setSubmitNote('')
        window.dispatchEvent(new Event('cms:inbox-changed'))
        refresh()
      }
    })
  }

  async function saveBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    if (busy()) return { ok: false, message: 'Wait for the current list action to finish.' }
    if (!selected || !model || !canEdit) return { ok: false, message: 'You do not have access to save this list.' }
    if (schemaDirty) return { ok: false, message: 'Finish the list field changes before saving its items.' }
    if (!entryDirty) return { ok: true }
    const epoch = selectionEpoch.current
    const snapshot = clone(entries)
    const drafts = activeDrafts(snapshot)
    const data = collectionForm(siteId, selected.id)
    for (const draft of drafts) {
      const parsed = parseCollectionEntryValues(model.fields, draft.values)
      if (!parsed.ok) {
        const message = parsed.problems.join(' ')
        setNotice({ ok: false, kind: 'error', message })
        return { ok: false, message }
      }
    }
    data.set('entryRevision', String(entryRevision))
    data.set('entries', JSON.stringify(drafts))
    actionInFlight.current = true
    setNotice(null)
    try {
      const result = await saveCollectionEntries(data)
      if (selectionEpoch.current !== epoch)
        return { ok: false, message: 'The selected list changed. Check its saved items before leaving.' }
      setNotice(result)
      if (!result.ok) return { ok: false, message: result.message }
      acknowledgeEntries(snapshot, result.revision)
      return { ok: true }
    } catch {
      const message =
        'The list draft could not be saved. Your items are still here. Check the saved list before trying again.'
      setNotice({ ok: false, kind: 'error', message })
      return { ok: false, message }
    } finally {
      actionInFlight.current = false
    }
  }

  function saveEntries() {
    if (!selected || !model || busy()) return
    const drafts = activeDrafts(entries)
    setNotice(null)
    const data = collectionForm(siteId, selected.id)
    data.set('entryRevision', String(entryRevision))
    data.set('entries', JSON.stringify(drafts))
    runAction(async isCurrent => {
      const result = await saveCollectionEntries(data)
      if (!isCurrent()) return
      setNotice(result)
      if (result.ok) {
        acknowledgeEntries(entries, result.revision)
      }
    })
  }

  function publishEntriesNow() {
    if (!selected || busy() || !canPublish || entryDirty || reviewOpen || entryRevision === publishedEntryRevision)
      return
    setNotice(null)
    const data = collectionForm(siteId, selected.id)
    data.set('entryRevision', String(entryRevision))
    runAction(async isCurrent => {
      const result = await publishCollectionEntries(data)
      if (!isCurrent()) return
      setNotice(result)
      if (result.ok) {
        setPublishOpen(false)
        setEntryRevision(result.revision)
        setPublishedEntryRevision(result.revision)
        setEntries(current => current.map(publishedEntry))
        setSavedEntries(current => current.map(publishedEntry))
      }
    })
  }

  function saveSchemaDraft(nextModel: CollectionModelValue) {
    if (!selected || busy() || entryDirty) return
    setNotice(null)
    const data = collectionForm(siteId, selected.id)
    data.set('revision', String(revision))
    data.set('model', JSON.stringify(nextModel))
    return runAction(async (isCurrent): Promise<ActionResult> => {
      const result = await saveCollectionSchema(data)
      if (!isCurrent())
        return {
          ok: false,
          kind: 'error',
          message: 'The selected list changed. Check its saved fields before leaving.',
        }
      setNotice(result)
      if (result.ok) {
        setRevision(result.revision)
        setDraftSchemaId(result.versionId)
        setModel(clone(nextModel))
        setSavedModel(clone(nextModel))
        setEntries(current =>
          current.map(entry => ({
            ...entry,
            values: Object.fromEntries(
              nextModel.fields.map(field => [
                field.key,
                entry.values[field.key] ?? (field.type === 'boolean' ? false : ''),
              ]),
            ),
          })),
        )
        setSchemaOpen(false)
      }
      return result
    })
  }

  function publishSchemaNow() {
    if (!selected || busy() || entryDirty) return
    const data = collectionForm(siteId, selected.id)
    data.set('revision', String(revision))
    runAction(async isCurrent => {
      const result = await publishCollectionSchema(data)
      if (!isCurrent()) return
      setNotice(result)
      if (result.ok) {
        setRevision(result.revision)
        setDraftSchemaId(result.versionId)
        setPublishedSchemaId(result.versionId)
      }
    })
  }

  return { submitForReview, saveBeforeLeaving, saveEntries, publishEntriesNow, saveSchemaDraft, publishSchemaNow }
}
