import { useNavigationGuard, requestClientNavigation } from '../../../../components/navigation-guard.ts'
import type { CollectionReview } from '../../../../lib/collection-review.ts'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { CollectionRights, CollectionWorkspace } from '../../../../lib/collection-queries.ts'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import { type SiteDocument } from '../../../../lib/document-library.ts'
import { clone } from './collection-entries.ts'
import { entryChanged, entryIdentity } from './collection-record-display.ts'
import { useCollectionDraft } from './use-collection-draft.ts'
import { useCollectionEntryEditing } from './use-collection-entry-editing.ts'
import { collectionCommands } from './collection-commands.ts'

export type CollectionsWorkspaceProps = {
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
}

export type EntryFilter = 'active' | 'changed' | 'live' | 'archived'

export function useCollectionsWorkspace({
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
}: CollectionsWorkspaceProps) {
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
  const draft = useCollectionDraft(selected, initialEntryId)
  const {
    entries,
    setEntries,
    model,
    savedEntries,
    savedModel,
    setModel,
    setExpanded,
    setChecked,
    originalEntry,
    setNotice,
    anythingDirty,
  } = draft
  const [view, setView] = useState('table')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<EntryFilter>('active')
  const [createOpen, setCreateOpen] = useState(false)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [imageFor, setImageFor] = useState<{ entryKey: string; fieldKey: string } | null>(null)
  const [documentFor, setDocumentFor] = useState<{ entryKey: string; fieldKey: string } | null>(null)
  const [uploadedDocuments, setUploadedDocuments] = useState<SiteDocument[]>([])
  const [pending, startTransition] = useTransition()
  // Pending is committed on the next render. The ref also closes the same-tick
  // gap for repeated submissions, drag/drop and callbacks from open dialogs.
  const actionInFlight = useRef(false)
  const selectionEpoch = useRef(0)
  const editing = useCollectionEntryEditing(draft, rights.editEntries, busy)
  const { reorder } = editing
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
    reorder.cancel()
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
    reorder.cancel()
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

  const commands = collectionCommands(draft, {
    siteId,
    canEdit: rights.editEntries,
    canPublish: rights.publish,
    reviewOpen: Boolean(currentReview),
    submitNote,
    setSubmitOpen,
    setSubmitNote,
    setPublishOpen,
    setSchemaOpen,
    refresh: () => router.refresh(),
    busy,
    actionInFlight,
    selectionEpoch,
    runAction,
  })
  const { saveBeforeLeaving } = commands
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
  const imageValue = imageFor
    ? entries.find(entry => entryIdentity(entry) === imageFor.entryKey)?.values[imageFor.fieldKey]
    : undefined
  return {
    draft,
    editing,
    commands,
    siteId,
    siteName,
    initial,
    rights,
    documents,
    headerActionsId,
    actorId,
    router,
    headerTarget,
    availableMedia,
    setChosenMedia,
    submitOpen,
    setSubmitOpen,
    publishOpen,
    setPublishOpen,
    submitNote,
    setSubmitNote,
    currentReview,
    lastReview,
    view,
    setView,
    search,
    setSearch,
    filter,
    setFilter,
    createOpen,
    setCreateOpen,
    schemaOpen,
    setSchemaOpen,
    csvOpen,
    setCsvOpen,
    imageFor,
    setImageFor,
    documentFor,
    setDocumentFor,
    uploadedDocuments,
    setUploadedDocuments,
    pending,
    busy,
    openDialog,
    openCreateDialog,
    visible,
    imageValue,
  }
}

export type CollectionsWorkspaceModel = ReturnType<typeof useCollectionsWorkspace>
