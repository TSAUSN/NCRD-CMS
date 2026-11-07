'use client'
import { createPortal } from 'react-dom'
import { listItemUnit } from '../../../../lib/list-items.ts'
import styles from './lists.module.css'
import shared from '../../../../components/workspace.module.css'
import { MediaPicker } from '../../../pages/[pageId]/media-picker.tsx'
import {
  Badge,
  Button,
  Card,
  CardHeading,
  CardContent,
  Disclosure,
  Drawer,
  Menu,
  Field,
  SegmentedControl,
  StatusPill,
  EmptyState,
  RecordBoard,
  TextLink,
} from '../../../../components/ui/index.ts'
import { submitCollectionReview } from '../../../collection-review-actions.ts'
import { ConfirmDialog, ReasonDialog } from '../../../../components/confirm.tsx'
import { useNavigationGuard, requestClientNavigation } from '../../../../components/navigation-guard.ts'
import type { CollectionReview } from '../../../../lib/collection-review.ts'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { CollectionFieldControl, imagePreview } from '../../../../components/collection-field-control.tsx'
import { useRouter } from 'next/navigation'
import { parseCollectionEntryValues, type CollectionModel as CollectionModelValue } from '@cms/schema'
import {
  publishCollectionEntries,
  publishCollectionSchema,
  saveCollectionEntries,
  saveCollectionSchema,
} from '../../../actions/collections.ts'
import { type ActionResult } from '../../../../lib/action-result.ts'
import { IconCollection, IconImage, IconMore, IconPlus } from '../../../../components/icons.tsx'
import type { CollectionRights, CollectionWorkspace } from '../../../../lib/collection-queries.ts'
import type { ImagePlacementValue, MediaAsset } from '../../../../lib/media-library.ts'
import { type SiteDocument } from '../../../../lib/document-library.ts'
import {
  blankValues,
  collectionDraftEqual,
  collectionPublicationChanges,
  slugifyStableKey,
} from './collection-workspace-model.ts'
import { EntryState, clone, activeDrafts } from './collection-entries.ts'
import { CreateCollectionDialog } from './create-collection-dialog.tsx'
import { SchemaDesigner } from './schema-designer.tsx'
import { CsvDialog } from './csv-dialog.tsx'
import { DocumentPickerDialog } from './document-picker-dialog.tsx'

const entryIdentity = (entry: EntryState) => entry.id ?? entry.clientId ?? entry.stableKey

type EntryFilter = 'active' | 'changed' | 'live' | 'archived'

function recordTitle(entry: EntryState, model: CollectionModelValue): string {
  const value = entry.values[model.presentation.titleField]
  const text = typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : ''
  return text || 'Untitled item'
}

/** The record's own picture, from the collection's chosen image field, so a
 * speaker is recognisable in the list as in V1 (reference 27). */
function recordImage(entry: EntryState, model: CollectionModelValue): unknown {
  const key = model.presentation.imageField
  return key ? entry.values[key] : null
}

/** What the admin can show for a stored image. Records keep the governed
 * public delivery address, which the admin does not serve, so a library image
 * is shown through its own admin preview; an external address is shown as it
 * is, and anything else not at all. */

function recordSubtitle(entry: EntryState, model: CollectionModelValue): string {
  const key = model.presentation.subtitleField
  const value = key ? entry.values[key] : null
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : ''
}

function entryChanged(entry: EntryState): boolean {
  return (
    entry.publishedValues === null ||
    !collectionDraftEqual(entry.values, entry.publishedValues) ||
    entry.sortIndex !== entry.publishedSortIndex ||
    entry.archived !== entry.publishedArchived
  )
}

function noticeClass(notice: ActionResult): string {
  return notice.ok ? 'notice notice-ok' : 'notice notice-error'
}

export function CollectionsWorkspace({
  siteId,
  siteName,
  initial,
  rights,
  media,
  initialEntryId,
  documents = [],
  reviews = [],
  headerActionsId,
  actorId = '',
}: {
  actorId?: string
  headerActionsId?: string
  initialEntryId?: string
  siteId: string
  siteName: string
  initial: CollectionWorkspace
  rights: CollectionRights
  media: MediaAsset[]
  documents?: SiteDocument[]
  reviews?: CollectionReview[]
}) {
  const router = useRouter()
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null)
  useEffect(() => setHeaderTarget(headerActionsId ? document.getElementById(headerActionsId) : null), [headerActionsId])
  const [chosenMedia, setChosenMedia] = useState<MediaAsset[]>([])
  const availableMedia = [...chosenMedia, ...media.filter(asset => !chosenMedia.some(chosen => chosen.id === asset.id))]
  useEffect(() => setChosenMedia([]), [siteId])
  const [submitOpen, setSubmitOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [submitNote, setSubmitNote] = useState('')
  const selected = initial.selected
  const currentReview = reviews.find(review => review.collectionId === selected?.id && review.status === 'open')
  const lastReview = reviews.find(review => review.collectionId === selected?.id)
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
  const [view, setView] = useState('table'),
    [checked, setChecked] = useState<string[]>([]),
    [deleteOpen, setDeleteOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<EntryFilter>('active')
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [imageFor, setImageFor] = useState<{ entryKey: string; fieldKey: string } | null>(null)
  const [documentFor, setDocumentFor] = useState<{ entryKey: string; fieldKey: string } | null>(null)
  const [uploadedDocuments, setUploadedDocuments] = useState<SiteDocument[]>([])
  const [dragKey, setDragKey] = useState<string | null>(null)
  // The dragover handshake must answer synchronously: the first dragover can
  // arrive before React commits the dragstart state, and an unanswered
  // dragover forbids the drop. State still drives the styling.
  const dragKeyRef = useRef<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Pending is committed on the next render. The ref also closes the same-tick
  // gap for repeated submissions, drag/drop and callbacks from open dialogs.
  const actionInFlight = useRef(false)
  const selectionEpoch = useRef(0)
  useEffect(() => {
    selectionEpoch.current += 1
    setCreateOpen(false)
    setSchemaOpen(false)
    setCsvOpen(false)
    setImageFor(null)
    setDocumentFor(null)
    setSubmitOpen(false)
    setSubmitNote('')
    setPublishOpen(false)
    dragKeyRef.current = null
    setDragKey(null)
    return () => {
      selectionEpoch.current += 1
    }
  }, [siteId, selected?.id])

  function busy() {
    return pending || actionInFlight.current
  }

  function runAction<T>(work: (isCurrent: () => boolean) => Promise<T>): Promise<T | undefined> | undefined {
    if (busy()) return
    actionInFlight.current = true
    dragKeyRef.current = null
    setDragKey(null)
    const epoch = selectionEpoch.current
    const isCurrent = () => selectionEpoch.current === epoch
    return new Promise(resolve => {
      startTransition(async () => {
        let result: T | undefined
        try {
          result = await work(isCurrent)
        } catch {
          if (isCurrent())
            setNotice({
              ok: false,
              kind: 'error',
              message:
                'The action could not be confirmed. Check the saved state before retrying if the connection was interrupted.',
            })
        } finally {
          actionInFlight.current = false
        }
        resolve(result)
      })
    })
  }

  function openDialog(open: () => void, opener?: HTMLElement) {
    if (!busy()) {
      opener?.focus()
      open()
    }
  }

  function openCreateDialog(event?: { currentTarget: HTMLButtonElement }) {
    if (busy()) return
    event?.currentTarget.focus()
    const open = () => setCreateOpen(true)
    if (requestClientNavigation(open)) open()
  }

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
  // A server action refreshes this route with the new immutable head. That is
  // confirmation arriving, not navigation, so keep the action's notice. Only
  // moving to another collection makes the previous collection's feedback
  // irrelevant.
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
  useNavigationGuard(() => ({
    dirty: anythingDirty,
    pending: pending || actionInFlight.current,
    draft: {
      label: selected?.name ?? 'List items',
      saveDraft: saveBeforeLeaving,
      discard: () => {
        setEntries(clone(savedEntries))
        setModel(clone(savedModel))
        setExpanded(null)
        setChecked([])
        originalEntry.current = null
        setNotice(null)
      },
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (anythingDirty || pending || actionInFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [anythingDirty, pending])

  const visible = useMemo(() => {
    if (!model) return []
    const needle = search.trim().toLocaleLowerCase()
    return entries.filter(entry => {
      if (filter === 'archived' ? !entry.archived : entry.archived) return false
      if (filter === 'changed' && !entryChanged(entry)) return false
      if (filter === 'live' && (entry.publishedValues === null || entryChanged(entry))) return false
      if (!needle) return true
      return [
        entry.stableKey,
        ...Object.values(entry.values).filter((value): value is string => typeof value === 'string'),
      ].some(value => value.toLocaleLowerCase().includes(needle))
    })
  }, [entries, filter, model, search])
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

  function updateEntry(key: string, update: (entry: EntryState) => EntryState) {
    if (busy() || !rights.editEntries) return
    setEntries(current => current.map(entry => (entryIdentity(entry) === key ? update(entry) : entry)))
  }

  function setValue(entryKey: string, fieldKey: string, value: unknown) {
    updateEntry(entryKey, entry => ({ ...entry, values: { ...entry.values, [fieldKey]: value } }))
  }

  function addEntry() {
    if (!model || busy() || !rights.editEntries) return
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
    if (busy() || !rights.editEntries) return
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

  function moveEntry(key: string, direction: -1 | 1) {
    if (busy() || !rights.editEntries) return
    setEntries(current => {
      const active = current.filter(entry => !entry.archived)
      const index = active.findIndex(entry => entryIdentity(entry) === key)
      const destination = index + direction
      if (index < 0 || destination < 0 || destination >= active.length) return current
      ;[active[index], active[destination]] = [active[destination]!, active[index]!]
      const ordered = active.map((entry, sortIndex) => ({ ...entry, sortIndex }))
      return [...ordered, ...current.filter(entry => entry.archived)]
    })
  }

  function dropEntry(destinationKey: string) {
    const sourceKey = dragKeyRef.current
    dragKeyRef.current = null
    if (busy() || !rights.editEntries || !sourceKey || sourceKey === destinationKey) {
      setDragKey(null)
      return
    }
    setEntries(current => {
      const active = current.filter(entry => !entry.archived)
      const from = active.findIndex(entry => entryIdentity(entry) === sourceKey)
      const to = active.findIndex(entry => entryIdentity(entry) === destinationKey)
      if (from < 0 || to < 0) return current
      const [dragged] = active.splice(from, 1)
      active.splice(to, 0, dragged!)
      return [
        ...active.map((entry, sortIndex) => ({ ...entry, sortIndex })),
        ...current.filter(entry => entry.archived),
      ]
    })
    setDragKey(null)
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
        router.refresh()
      }
    })
  }

  async function saveBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    if (busy()) return { ok: false, message: 'Wait for the current list action to finish.' }
    if (!selected || !model || !rights.editEntries)
      return { ok: false, message: 'You do not have access to save this list.' }
    if (schemaDirty) return { ok: false, message: 'Finish the list field changes before saving its items.' }
    if (!entryDirty) return { ok: true }
    const epoch = selectionEpoch.current,
      snapshot = clone(entries),
      drafts = activeDrafts(snapshot),
      data = new FormData()
    for (const draft of drafts) {
      const parsed = parseCollectionEntryValues(model.fields, draft.values)
      if (!parsed.ok) {
        const message = parsed.problems.join(' ')
        setNotice({ ok: false, kind: 'error', message })
        return { ok: false, message }
      }
    }
    data.set('siteId', siteId)
    data.set('collectionId', selected.id)
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
      const saved = snapshot.map(entry => (entry.archived ? entry : { ...entry, schemaVersionId: draftSchemaId }))
      setEntryRevision(result.revision)
      setEntries(clone(saved))
      setSavedEntries(clone(saved))
      setExpanded(null)
      setChecked([])
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
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('collectionId', selected.id)
    data.set('entryRevision', String(entryRevision))
    data.set('entries', JSON.stringify(drafts))
    runAction(async isCurrent => {
      const result = await saveCollectionEntries(data)
      if (!isCurrent()) return
      setNotice(result)
      if (result.ok) {
        setEntryRevision(result.revision)
        const saved = entries.map(entry => (entry.archived ? entry : { ...entry, schemaVersionId: draftSchemaId }))
        setEntries(clone(saved))
        setSavedEntries(clone(saved))
        setExpanded(null)
        setChecked([])
      }
    })
  }

  function publishEntriesNow() {
    if (
      !selected ||
      busy() ||
      !rights.publish ||
      entryDirty ||
      !!currentReview ||
      entryRevision === publishedEntryRevision
    )
      return
    setNotice(null)
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('collectionId', selected.id)
    data.set('entryRevision', String(entryRevision))
    runAction(async isCurrent => {
      const result = await publishCollectionEntries(data)
      if (!isCurrent()) return
      setNotice(result)
      if (result.ok) {
        setPublishOpen(false)
        setEntryRevision(result.revision)
        setPublishedEntryRevision(result.revision)
        setEntries(current =>
          current.map(entry =>
            entry.archived
              ? { ...entry, publishedArchived: true }
              : {
                  ...entry,
                  publishedValues: clone(entry.values),
                  publishedSortIndex: entry.sortIndex,
                  publishedArchived: false,
                },
          ),
        )
        setSavedEntries(current =>
          current.map(entry =>
            entry.archived
              ? { ...entry, publishedArchived: true }
              : {
                  ...entry,
                  publishedValues: clone(entry.values),
                  publishedSortIndex: entry.sortIndex,
                  publishedArchived: false,
                },
          ),
        )
      }
    })
  }

  function saveSchemaDraft(nextModel: CollectionModelValue) {
    if (!selected || busy() || entryDirty) return
    setNotice(null)
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('collectionId', selected.id)
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
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('collectionId', selected.id)
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

  const readableValue = (value: unknown): string =>
    typeof value === 'string'
      ? value.replace(/<[^>]*>/g, '').trim() || 'Empty'
      : typeof value === 'boolean'
        ? value
          ? 'Yes'
          : 'No'
        : typeof value === 'number'
          ? String(value)
          : value && typeof value === 'object'
            ? 'Picture selected'
            : 'Empty'
  const noun = listItemUnit(selected?.readerKey ?? '')
  const opened = entries.find(entry => entryIdentity(entry) === expanded)
  const imageValue = imageFor
    ? entries.find(entry => entryIdentity(entry) === imageFor.entryKey)?.values[imageFor.fieldKey]
    : undefined
  const changes = publicationChanges.length + (draftSchemaId !== publishedSchemaId ? 1 : 0)
  function openEntry(entry: EntryState) {
    if (busy()) return
    originalEntry.current = clone(entry)
    setExpanded(entryIdentity(entry))
  }
  function cancelEntry() {
    if (busy()) return
    const key = expanded,
      original = originalEntry.current
    setEntries(current =>
      original
        ? current.map(entry => (entryIdentity(entry) === key ? original : entry))
        : current.filter(entry => entryIdentity(entry) !== key),
    )
    setExpanded(null)
  }
  function bulk(hidden: boolean) {
    if (busy() || !rights.editEntries) return
    setEntries(current =>
      current.map(entry => (checked.includes(entryIdentity(entry)) ? { ...entry, archived: hidden } : entry)),
    )
    setChecked([])
  }
  return (
    <div className={styles.workspace}>
      {headerTarget &&
        rights.manageSchema &&
        createPortal(
          <Button variant="secondary" disabled={pending} onClick={openCreateDialog}>
            <IconPlus size={16} />
            New list
          </Button>,
          headerTarget,
        )}
      {publishOpen && selected && (
        <ConfirmDialog
          tone="publish"
          title={`Publish ${selected.name}?`}
          what={
            <div className={styles.publication}>
              <p>The saved items, order and removals will become live on every page that uses this list.</p>
              {publicationChanges.length ? (
                <ul>
                  {publicationChanges.map(item => (
                    <li key={item.key}>
                      <strong>{item.title}</strong>
                      <ul>
                        {item.changes.map((change, index) => (
                          <li key={index}>{change}</li>
                        ))}
                      </ul>
                      <Disclosure title="View item details">
                        <dl>
                          {model?.fields.map(field => (
                            <div key={field.key}>
                              <dt>{field.label}</dt>
                              <dd>
                                {readableValue(
                                  savedEntries.find(entry => (entry.id ?? entry.stableKey) === item.key)?.values[
                                    field.key
                                  ],
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </Disclosure>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No visible content differences.</p>
              )}
            </div>
          }
          reassurance="Other saved work stays private until published."
          confirmLabel="Publish this list"
          pending={pending}
          error={notice && !notice.ok ? notice.message : undefined}
          onCancel={() => {
            if (!busy()) setPublishOpen(false)
          }}
          onConfirm={publishEntriesNow}
        />
      )}
      {submitOpen && (
        <ReasonDialog
          pending={pending}
          required={false}
          title="Submit this list for review?"
          explanation="An editor will inspect the saved items, order and removals before publishing."
          label="What should the reviewer know?"
          value={submitNote}
          onChange={value => {
            if (!busy()) setSubmitNote(value)
          }}
          confirmLabel="Submit for review"
          onCancel={() => {
            if (!busy()) setSubmitOpen(false)
          }}
          onConfirm={submitForReview}
        />
      )}
      {deleteOpen && (
        <ConfirmDialog
          title={`Delete ${checked.length} selected items?`}
          what="The selected items will be removed from this list when you save and publish."
          reassurance="Their earlier content is kept in history. Hidden items can be restored."
          confirmLabel="Delete selected items"
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => {
            bulk(true)
            setDeleteOpen(false)
          }}
        />
      )}
      {notice && (
        <p className={noticeClass(notice)} role={notice.ok ? 'status' : 'alert'}>
          {notice.message}
          {!notice.ok && notice.kind === 'conflict' && (
            <Button variant="secondary" size="s" onClick={() => router.refresh()}>
              Reload
            </Button>
          )}
        </p>
      )}
      {!rights.editEntries && <p>You can look through this list. A contributor or editor can update it.</p>}
      {!selected || !model ? (
        <>
          <div className={styles.heading}>
            <h2>Your lists</h2>
            {rights.manageSchema && !headerActionsId && <Button onClick={openCreateDialog}>New list</Button>}
          </div>
          {initial.collections.length === 0 ? (
            <EmptyState title="Keep shared items in a list">
              Add speakers, sessions or resources once, then show them on any page.
            </EmptyState>
          ) : (
            <div className={styles.tiles}>
              {initial.collections.map(list => (
                <Link
                  className={shared.optionCard + ' ' + shared.workspaceTile}
                  key={list.id}
                  href={'?collection=' + list.id}
                >
                  <IconCollection size={24} />
                  <strong>{list.name}</strong>
                  <span>
                    {list.totalEntries} {list.totalEntries === 1 ? 'item' : 'items'} · {list.liveEntries} live
                  </span>
                  <StatusPill
                    status={
                      list.changedEntries || list.draftSchemaVersionId !== list.publishedSchemaVersionId
                        ? list.publishedSchemaVersionId
                          ? 'Live · changes not published'
                          : 'Draft'
                        : 'Live'
                    }
                  />
                  <small>
                    {list.usedOn?.length
                      ? `Used on ${list.usedOn.length} ${list.usedOn.length === 1 ? 'page' : 'pages'}`
                      : 'No pages yet'}
                  </small>
                </Link>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className={shared.workspaceSplit + ' ' + styles.split}>
          <nav className={shared.workspaceRail} aria-label="Site lists">
            {initial.collections.map(list => (
              <Link
                key={list.id}
                href={'?collection=' + list.id}
                aria-current={list.id === selected.id ? 'page' : undefined}
                aria-disabled={pending || undefined}
                tabIndex={pending ? -1 : undefined}
                onClick={event => {
                  if (busy()) event.preventDefault()
                }}
              >
                <IconCollection size={18} />
                <span className={shared.rowCopy}>
                  <strong>{list.name}</strong>
                  <span className={shared.meta}>
                    {list.totalEntries} {list.totalEntries === 1 ? 'item' : 'items'}
                  </span>
                </span>
              </Link>
            ))}
            <Link
              href={'/sites/' + siteId + '/content?all=1'}
              aria-disabled={pending || undefined}
              tabIndex={pending ? -1 : undefined}
              onClick={event => {
                if (busy()) event.preventDefault()
              }}
            >
              All lists
            </Link>
          </nav>
          <Card density="compact">
            <CardHeading>
              <div>
                <h2 title={selected.name}>{selected.name}</h2>
                <p>
                  {entries.filter(entry => !entry.archived).length}{' '}
                  {entries.filter(entry => !entry.archived).length === 1 ? 'item' : 'items'} ·{' '}
                  <StatusPill
                    compact
                    status={
                      entryDirty || entryRevision !== publishedEntryRevision || draftSchemaId !== publishedSchemaId
                        ? publishedSchemaId
                          ? 'Live · changes not published'
                          : 'Draft'
                        : 'Live'
                    }
                  />
                </p>
              </div>
              <div className={shared.actions}>
                {' '}
                {rights.editEntries && (
                  <Button disabled={pending} onClick={addEntry}>
                    <IconPlus size={16} />
                    Add {noun}
                  </Button>
                )}
                <Menu appearance="button" label="Import / Export">
                  <Button
                    variant="tertiary"
                    disabled={pending}
                    onClick={event => openDialog(() => setCsvOpen(true), event.currentTarget)}
                  >
                    Import / Export CSV
                  </Button>
                </Menu>
                {rights.manageSchema && (
                  <Menu appearance="button" label="More" accessibleLabel="More list actions">
                    {!headerActionsId && (
                      <Button variant="tertiary" disabled={pending} onClick={openCreateDialog}>
                        New list
                      </Button>
                    )}
                    <Button
                      variant="tertiary"
                      disabled={pending || entryDirty}
                      onClick={event => {
                        if (!entryDirty)
                          openDialog(() => {
                            setNotice(null)
                            setSchemaOpen(true)
                          }, event.currentTarget)
                      }}
                    >
                      List settings
                    </Button>
                    {draftSchemaId !== publishedSchemaId && (
                      <Button
                        variant="tertiary"
                        disabled={entryDirty || schemaDirty || Boolean(currentReview) || pending}
                        onClick={publishSchemaNow}
                      >
                        Publish field changes
                      </Button>
                    )}
                  </Menu>
                )}
              </div>
            </CardHeading>
            <CardContent>
              <div className={styles.listChoices + ' ' + styles.actions}>
                <Link
                  href={'/sites/' + siteId + '/content?all=1'}
                  aria-disabled={pending || undefined}
                  tabIndex={pending ? -1 : undefined}
                  onClick={event => {
                    if (busy()) event.preventDefault()
                  }}
                >
                  ← All lists
                </Link>
                <Field id="list-switcher" label="List">
                  <select
                    value={selected.id}
                    disabled={pending}
                    onChange={event => {
                      if (busy()) return
                      const href = '?collection=' + event.target.value,
                        go = () => router.push(href)
                      if (requestClientNavigation(go)) go()
                    }}
                  >
                    {initial.collections.map(list => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {rights.manageSchema && entryDirty && (
                <p className="hint">
                  {entryEdits
                    ? 'Save your item changes before changing or publishing list fields.'
                    : 'Save the items to apply saved field changes before publishing.'}
                </p>
              )}
              {selected.usedOn?.length ? (
                <Disclosure
                  title={`Used on ${selected.usedOn.length} ${selected.usedOn.length === 1 ? 'page' : 'pages'}`}
                >
                  <ul className={shared.usageLinks}>
                    {selected.usedOn.map(page => (
                      <li key={page.id}>
                        <TextLink title={page.title} href={'/pages/' + page.id}>
                          {page.title}
                        </TextLink>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">Save a draft, then publish this list to update those pages.</p>
                </Disclosure>
              ) : (
                <p className={shared.meta}>Used on: No pages yet.</p>
              )}
              {lastReview && (
                <p className="notice">
                  <span>
                    {lastReview.status === 'open'
                      ? 'In review'
                      : lastReview.status === 'rejected'
                        ? 'Changes requested'
                        : lastReview.status === 'approved'
                          ? 'Approved and published'
                          : 'Previous review'}
                    {lastReview.decisionNote && ': ' + lastReview.decisionNote} ·{' '}
                    <TextLink href={`/sites/${siteId}/publishing?collectionReview=${lastReview.id}#collection-reviews`}>
                      View discussion
                    </TextLink>
                  </span>
                </p>
              )}
              <div className={styles.tools}>
                <Field id="collection-search" label="Search items" density="compact">
                  <input
                    type="search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Name or words in any field"
                  />
                </Field>
                <SegmentedControl
                  appearance="pills"
                  size="s"
                  label="Filter items"
                  value={filter}
                  onChange={value => setFilter(value as EntryFilter)}
                  options={[
                    { value: 'active', label: 'All' },
                    { value: 'live', label: 'Live' },
                    { value: 'changed', label: 'Draft' },
                    { value: 'archived', label: 'Hidden' },
                  ]}
                />
                <SegmentedControl
                  appearance="pills"
                  size="s"
                  label="List view"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'table', label: 'Table' },
                    { value: 'cards', label: 'Cards' },
                  ]}
                />
              </div>
              {checked.length > 0 && rights.editEntries && (
                <div className={styles.bulk}>
                  <strong>{checked.length} selected</strong>
                  <Button variant="secondary" size="s" disabled={pending} onClick={() => bulk(true)}>
                    Hide
                  </Button>
                  <Button variant="secondary" size="s" disabled={pending} onClick={() => bulk(false)}>
                    Show
                  </Button>
                  <Button variant="destructive" size="s" disabled={pending} onClick={() => setDeleteOpen(true)}>
                    Delete
                  </Button>
                  <Button variant="tertiary" size="s" onClick={() => setChecked([])}>
                    Clear selection
                  </Button>
                </div>
              )}
              <RecordBoard
                label={selected.name + ' records'}
                footerLabel="List publishing status"
                footer={
                  <>
                    <span>
                      <strong>
                        {entryEdits
                          ? 'Unsaved changes'
                          : entriesNeedResave
                            ? 'Apply saved field changes'
                            : changes + ' ' + (changes === 1 ? 'change' : 'changes') + ' not live'}
                      </strong>
                      <small>
                        {entryEdits
                          ? 'Save your draft before publishing.'
                          : entriesNeedResave
                            ? 'The saved list fields need applying to item drafts.'
                            : 'Visitors see the published list.'}
                      </small>
                    </span>
                    <div className={styles.actions}>
                      {rights.editEntries && (
                        <Button
                          variant="secondary"
                          disabled={!entryDirty || invalidEntryKeys.size > 0}
                          loading={pending}
                          onClick={saveEntries}
                        >
                          Save draft
                        </Button>
                      )}
                      {rights.editEntries && (
                        <Button
                          variant={rights.publish ? 'secondary' : 'primary'}
                          disabled={
                            anythingDirty ||
                            Boolean(currentReview) ||
                            pending ||
                            (entryRevision === publishedEntryRevision && draftSchemaId === publishedSchemaId)
                          }
                          onClick={() => setSubmitOpen(true)}
                        >
                          {currentReview ? 'Waiting for review' : 'Submit for review'}
                        </Button>
                      )}
                      {rights.publish && (
                        <>
                          <Button
                            variant="secondary"
                            disabled={
                              entryDirty ||
                              entryRevision === publishedEntryRevision ||
                              Boolean(currentReview) ||
                              pending
                            }
                            onClick={event =>
                              openDialog(() => {
                                setNotice(null)
                                setPublishOpen(true)
                              }, event.currentTarget)
                            }
                          >
                            Review
                          </Button>
                          <Button
                            variant="publish"
                            disabled={
                              entryDirty ||
                              entryRevision === publishedEntryRevision ||
                              Boolean(currentReview) ||
                              pending
                            }
                            onClick={event =>
                              openDialog(() => {
                                setNotice(null)
                                setPublishOpen(true)
                              }, event.currentTarget)
                            }
                          >
                            Publish list
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                }
              >
                <div className={styles.recordTable} data-view={view}>
                  {view === 'table' && visible.length > 0 && (
                    <div className={shared.recordHeader} aria-hidden="true" data-editable={rights.editEntries}>
                      {rights.editEntries && <span />}
                      <span>
                        {model.fields.find(field => field.key === model.presentation.titleField)?.label ?? 'Name'}
                      </span>
                      <span>
                        {model.fields.find(field => field.key === model.presentation.subtitleField)?.label ?? 'Details'}
                      </span>
                      <span>Status</span>
                      <span data-secondary>Updated</span>
                      {rights.editEntries && <span />}
                    </div>
                  )}
                  {visible.length === 0 ? (
                    <EmptyState title={entries.length ? 'No matching items' : 'Add the first ' + noun}>
                      {entries.length ? 'Try another search or filter.' : 'Your list starts as a private draft.'}
                    </EmptyState>
                  ) : (
                    <div
                      className={styles.results + ' ' + shared.recordRows}
                      data-view={view}
                      role="list"
                      aria-label={selected.name + ' items'}
                    >
                      {visible.map(entry => {
                        const key = entryIdentity(entry),
                          title = recordTitle(entry, model),
                          position = entries
                            .filter(item => !item.archived)
                            .findIndex(item => entryIdentity(item) === key),
                          photo = imagePreview(recordImage(entry, model), availableMedia)
                        return (
                          <article
                            key={key}
                            role="listitem"
                            className={styles.item + ' ' + shared.recordRow}
                            data-selected={checked.includes(key)}
                            draggable={rights.editEntries && !pending && !entry.archived}
                            onDragStart={event => {
                              if (busy()) {
                                event.preventDefault()
                                return
                              }
                              dragKeyRef.current = key
                              setDragKey(key)
                            }}
                            onDragEnd={() => {
                              dragKeyRef.current = null
                              setDragKey(null)
                            }}
                            onDragOver={event => {
                              if (!busy() && rights.editEntries && dragKeyRef.current) event.preventDefault()
                            }}
                            onDrop={() => dropEntry(key)}
                          >
                            {rights.editEntries && (
                              <label className={styles.select + ' ' + shared.checkRow}>
                                <input
                                  type="checkbox"
                                  aria-label={'Select ' + title}
                                  checked={checked.includes(key)}
                                  onChange={event =>
                                    setChecked(current =>
                                      event.target.checked ? [...current, key] : current.filter(id => id !== key),
                                    )
                                  }
                                />
                              </label>
                            )}
                            <button
                              type="button"
                              className={styles.open + ' ' + shared.recordOpen}
                              onClick={() => openEntry(entry)}
                              aria-label={'Edit ' + title}
                            >
                              <span className={styles.entryName}>
                                {model.presentation.imageField && (
                                  <span className={styles.photo + ' ' + shared.recordPhoto}>
                                    {photo ? <img src={photo} alt="" /> : <IconImage size={20} />}
                                  </span>
                                )}
                                <span className={styles.identity}>
                                  <strong className={shared.recordName} title={title}>
                                    {title}
                                  </strong>
                                </span>
                              </span>
                              <span className={shared.recordValue} title={recordSubtitle(entry, model)}>
                                {recordSubtitle(entry, model)}
                              </span>
                              <Badge tone={entry.archived ? 'neutral' : entryChanged(entry) ? 'pending' : 'live'}>
                                {entry.archived
                                  ? 'Hidden'
                                  : entryChanged(entry)
                                    ? entry.publishedValues === null
                                      ? 'Draft'
                                      : 'Changes not live'
                                    : 'Live'}
                              </Badge>
                              <small
                                data-secondary
                                className={shared.recordValue}
                                title={
                                  (entry.editedBy ?? 'Not saved yet') +
                                  (entry.editedAt ? ' · ' + new Date(entry.editedAt).toLocaleString('en-US') : '')
                                }
                              >
                                {entry.editedBy ?? 'Not saved yet'}
                                {entry.editedAt &&
                                  ' · ' +
                                    new Date(entry.editedAt).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                              </small>
                            </button>
                            {rights.editEntries && (
                              <span className={shared.recordAction}>
                                {!entry.archived && (
                                  <Menu label={<IconMore size={16} />} accessibleLabel={'Actions for ' + title}>
                                    <Button
                                      variant="tertiary"
                                      aria-label={'Move ' + title + ' up'}
                                      disabled={pending || position <= 0}
                                      onClick={() => moveEntry(key, -1)}
                                    >
                                      Move up
                                    </Button>
                                    <Button
                                      variant="tertiary"
                                      aria-label={'Move ' + title + ' down'}
                                      disabled={
                                        pending || position >= entries.filter(item => !item.archived).length - 1
                                      }
                                      onClick={() => moveEntry(key, 1)}
                                    >
                                      Move down
                                    </Button>
                                  </Menu>
                                )}
                              </span>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  )}
                </div>
              </RecordBoard>
            </CardContent>
          </Card>
        </div>
      )}
      {opened && model && (
        <Drawer
          density="compact"
          title={(opened.id ? 'Edit ' : 'Add ') + noun}
          onClose={cancelEntry}
          pending={pending}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={cancelEntry}>
                Cancel
              </Button>
              <Button
                disabled={!rights.editEntries || !entryDirty || invalidEntryKeys.size > 0}
                loading={pending}
                onClick={saveEntries}
              >
                Save {noun}
              </Button>
            </>
          }
        >
          <p className={shared.meta}>Save keeps this item private until you publish the list.</p>
          {opened.editedAt && (
            <p className={shared.meta}>
              Updated {new Date(opened.editedAt).toLocaleString('en-US')} ·{' '}
              <span title={opened.editedBy ?? undefined}>{opened.editedBy ?? 'Not saved yet'}</span>
            </p>
          )}
          {notice && !notice.ok && <p role="alert">{notice.message}</p>}
          <div className={shared.formStack}>
            {model.fields.map(field => (
              <CollectionFieldControl
                key={field.key}
                field={field}
                entry={opened}
                media={availableMedia}
                disabled={!rights.editEntries || opened.archived || pending}
                onChange={value => setValue(entryIdentity(opened), field.key, value)}
                onChooseImage={() =>
                  openDialog(() => setImageFor({ entryKey: entryIdentity(opened), fieldKey: field.key }))
                }
                onChooseDocument={() =>
                  openDialog(() => setDocumentFor({ entryKey: entryIdentity(opened), fieldKey: field.key }))
                }
              />
            ))}
          </div>
          {rights.editEntries && (
            <div className={styles.actions}>
              <Button variant="secondary" disabled={pending} onClick={() => duplicateEntry(opened)}>
                Duplicate
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => updateEntry(entryIdentity(opened), entry => ({ ...entry, archived: !entry.archived }))}
              >
                {opened.archived ? 'Show in list' : 'Hide from list'}
              </Button>
            </div>
          )}
          <Disclosure title="Advanced">
            <Field
              id={'stable-' + entryIdentity(opened)}
              label="Record key"
              help="Pages use this permanent key to identify the item."
            >
              <input
                value={opened.stableKey}
                disabled={!rights.editEntries || pending || opened.id !== null}
                onChange={event =>
                  updateEntry(entryIdentity(opened), entry => ({ ...entry, stableKey: event.target.value }))
                }
              />
            </Field>
          </Disclosure>
        </Drawer>
      )}
      {createOpen && (
        <CreateCollectionDialog
          siteId={siteId}
          siteName={siteName}
          onDraftCreated={() => {
            setNotice({
              ok: true,
              revision,
              versionId: null,
              message: 'List saved as a private draft. Nothing was published.',
            })
            router.refresh()
          }}
          onClose={() => setCreateOpen(false)}
          onCreatedAfterClose={() => {
            setNotice({
              ok: true,
              revision,
              versionId: null,
              message: 'The list was created after you closed the window. Your current list is unchanged.',
            })
            router.refresh()
          }}
          onResult={result => {
            setCreateOpen(false)
            router.push(`/sites/${siteId}/content?collection=${result.collectionId}`)
            router.refresh()
          }}
        />
      )}
      {schemaOpen && selected && model && (
        <SchemaDesigner
          initial={model}
          pending={pending}
          notice={notice}
          onClose={() => setSchemaOpen(false)}
          onSave={saveSchemaDraft}
        />
      )}
      {csvOpen && selected && model && (
        <CsvDialog
          actorId={actorId}
          siteId={siteId}
          collectionId={selected.id}
          name={selected.name}
          model={model}
          entries={entries}
          canImport={rights.editEntries && !pending}
          onClose={() => setCsvOpen(false)}
          onImport={imported => {
            if (busy() || !rights.editEntries) return
            setEntries(current => [
              ...current,
              ...imported.map((entry, offset) => ({
                ...entry,
                clientId: crypto.randomUUID(),
                schemaVersionId: null,
                revision: 0,
                sortIndex: current.filter(item => !item.archived).length + offset,
                publishedSortIndex: null,
                publishedValues: null,
                archived: false,
                publishedArchived: false,
              })),
            ])
            setCsvOpen(false)
          }}
        />
      )}
      {imageFor && (
        <MediaPicker
          siteId={siteId}
          initialAssets={availableMedia}
          currentValue={
            imageValue && typeof imageValue === 'object' ? (imageValue as Partial<ImagePlacementValue>) : undefined
          }
          onClose={() => setImageFor(null)}
          onSelectedAsset={asset => setChosenMedia(current => [asset, ...current.filter(item => item.id !== asset.id)])}
          onChoose={({ src, alt, decorative }) => {
            setValue(imageFor.entryKey, imageFor.fieldKey, { src, alt, decorative })
            setImageFor(null)
          }}
        />
      )}
      {documentFor && (
        <DocumentPickerDialog
          siteId={siteId}
          documents={[
            ...uploadedDocuments,
            ...documents.filter(document => !uploadedDocuments.some(upload => upload.id === document.id)),
          ]}
          onClose={() => setDocumentFor(null)}
          onUploaded={document =>
            setUploadedDocuments(current => [document, ...current.filter(item => item.id !== document.id)])
          }
          onChoose={document => {
            setValue(documentFor.entryKey, documentFor.fieldKey, document.url)
            setDocumentFor(null)
          }}
        />
      )}
    </div>
  )
}
