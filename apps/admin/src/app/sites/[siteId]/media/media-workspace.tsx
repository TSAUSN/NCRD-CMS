'use client'
import {
  useNavigationGuard,
  requestClientNavigation,
  requestLocalDraftNavigation,
} from '../../../../components/navigation-guard.ts'
import styles from './media-workspace.module.css'
import mediaUi from '../../../../components/media-ui.module.css'
import { Drawer, Button, DetailPanel } from '../../../../components/ui/index.ts'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import shared from '../../../../components/workspace.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { useEffect, useRef, useState } from 'react'
import { IconImage, IconPlus } from '../../../../components/icons.tsx'
import {
  bulkDeleteMedia,
  bulkOrganizeMedia,
  deleteMedia,
  mediaUploadStatus,
  MediaRequestError,
  restoreMedia,
  type MediaAsset,
  type MediaLibraryQuery,
  type MediaLibraryResult,
  type MediaUploadIntentStatus,
  type MediaUploadReceipt,
} from '../../../../lib/media-library.ts'
import type { NavigationGuardState } from '../../../../lib/navigation-guard.ts'
import { MediaUploadPanel } from './media-upload-panel.tsx'
import { ImageReplacement } from './image-replacement.tsx'
import { MediaDetail } from './media-detail.tsx'
import { MediaBulkSelection } from './media-bulk-selection.tsx'
import { MediaNotices } from './media-notices.tsx'
import { MediaLifecycleDialogs, type MediaLifecycleAction } from './media-lifecycle-dialogs.tsx'
import { MediaLibraryBrowser, type MediaLibraryView } from './media-library-browser.tsx'
import { normalizedTags } from './media-tags.ts'
import { useMediaLibraryResults } from './use-media-library-results.ts'
import { DEFAULT_MEDIA_LIBRARY_QUERY } from '../../../../lib/media-library-defaults.ts'

export function MediaWorkspace({
  siteId,
  initialResult,
  canManage,
  canManageShared,
  native = false,
}: {
  native?: boolean
  siteId: string
  initialResult: MediaLibraryResult
  canManage: boolean
  canManageShared: boolean
}) {
  const [metadataBusy, setMetadataBusy] = useState(false),
    [metadataChanged, setMetadataChanged] = useState(false),
    [detailTab, setDetailTab] = useState<'details' | 'usage'>('details')
  const metadataLock = useRef(false),
    metadataDirty = useRef(false)
  const [droppedFile, setDroppedFile] = useState<File | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [view, setView] = useState<MediaLibraryView>('grid')
  const [foldersExpanded, setFoldersExpanded] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width:64rem)'),
      update = () => setFoldersExpanded(!query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<MediaAsset | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const uploadLeave = useRef<(() => NavigationGuardState) | null>(null)
  const [uploadOpen, setUploadOpen] = useState(initialResult.total === 0)
  const [pending, setPending] = useState<MediaLifecycleAction | null>(null)
  const [bulkDeletePending, setBulkDeletePending] = useState(false)
  const [deletionReason, setDeletionReason] = useState('')
  const [working, setWorking] = useState(false)
  const mutationInFlight = useRef(false)
  const [refreshNeeded, setRefreshNeeded] = useState(false)
  const [trackedUpload, setTrackedUpload] = useState<MediaUploadReceipt | null>(null)
  const [uploadState, setUploadState] = useState<MediaUploadIntentStatus | null>(null)
  const [pollCycle, setPollCycle] = useState(0)
  const [pollExhausted, setPollExhausted] = useState(false)
  const [bulkFolder, setBulkFolder] = useState('')
  const [bulkTags, setBulkTags] = useState('')
  const [bulkBaseline, setBulkBaseline] = useState({ folder: '', tags: '' })
  const { result, query, setQuery, loading, setLoading, error, setError, refresh, rememberAssets } =
    useMediaLibraryResults(siteId, initialResult, setSelectedId)

  const selected = result.assets.find(asset => asset.id === selectedId) ?? null
  const checked = result.assets.filter(asset => checkedIds.has(asset.id))
  const bulkDirty = checked.length > 0 && (bulkFolder !== bulkBaseline.folder || bulkTags !== bulkBaseline.tags)
  const discardBulk = () => {
    setBulkFolder(bulkBaseline.folder)
    setBulkTags(bulkBaseline.tags)
  }
  const bulkState = (): NavigationGuardState => ({
    dirty: bulkDirty,
    pending: working || mutationInFlight.current,
    draft: {
      label: 'Selected image organization',
      saveMode: 'library',
      saveDraft: organizeChecked,
      discard: discardBulk,
    },
  })
  function leaveBulk(proceed: () => void) {
    if (!bulkDirty && !working && !mutationInFlight.current) {
      proceed()
      return
    }
    if (requestLocalDraftNavigation(bulkState, proceed)) proceed()
  }
  function changeBulk(change: () => void) {
    if (mutationInFlight.current || metadataLock.current) return
    const apply = () => {
      if (native) setSelectedId(null)
      change()
    }
    if (native && metadataDirty.current) leaveDetails(apply)
    else apply()
  }
  function chooseBulkTargets(proceed: () => void) {
    const change = () => {
        if (native) setSelectedId(null)
        proceed()
      },
      apply = () => leaveBulk(change)
    if (native && metadataDirty.current) leaveDetails(apply)
    else apply()
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      const needle = searchInput.trim()
      if (query.search === needle) return
      const apply = () => {
        setSearchInput(needle)
        setCheckedIds(new Set())
        setQuery(current => ({ ...current, search: needle, page: 1 }))
      }
      if (bulkDirty) {
        if (requestLocalDraftNavigation(bulkState, apply)) apply()
        else setSearchInput(query.search)
      } else apply()
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, query.search, bulkDirty, bulkFolder, bulkTags, checkedIds])

  useEffect(() => {
    if (!trackedUpload) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    setPollExhausted(false)
    async function poll() {
      attempts += 1
      try {
        const next = await mediaUploadStatus(trackedUpload!.intentId)
        if (cancelled) return
        setUploadState(next)
        if (next.status === 'ready' && next.asset) {
          const uploadDraft = uploadLeave.current?.()
          if (!uploadDraft?.dirty && !uploadDraft?.pending) {
            setSelectedId(next.asset.id)
            setUploadOpen(false)
          }
          await refresh()
          return
        }
        if (next.status === 'failed') {
          const uploadDraft = uploadLeave.current?.()
          if (!uploadDraft?.dirty && !uploadDraft?.pending) setUploadOpen(false)
          return
        }
      } catch {
        /* the worker's durable state remains authoritative */
      }
      if (!cancelled && attempts < 48) timer = setTimeout(poll, 1_250)
      else if (!cancelled) setPollExhausted(true)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [trackedUpload, pollCycle])

  useEffect(() => {
    const drag = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length || (event.target as Element)?.closest?.('.media-upload')) return
      event.preventDefault()
      if (mutationInFlight.current) return
      const file = event.dataTransfer.files[0]!
      const open = () => {
        if (native) setSelectedId(null)
        setDroppedFile(file)
        setUploadOpen(true)
      }
      if (native) leaveDetails(open)
      else open()
    }
    window.addEventListener('dragover', drag)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', drag)
      window.removeEventListener('drop', drop)
    }
  }, [])

  useNavigationGuard(bulkState)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const warn = (event: BeforeUnloadEvent) => {
      if (bulkDirty || working || mutationInFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [bulkDirty, working])
  function leaveDetails(proceed: () => void) {
    if (metadataLock.current || mutationInFlight.current) return
    if (requestClientNavigation(proceed)) proceed()
  }

  function changeQuery(change: Partial<MediaLibraryQuery>) {
    if (mutationInFlight.current) return
    const apply = () => {
      setCheckedIds(new Set())
      if (native) {
        setSelectedId(null)
        metadataDirty.current = false
        setMetadataChanged(false)
      }
      setQuery(current => ({ ...current, ...change, page: change.page ?? 1 }))
    }
    if (native || bulkDirty) leaveDetails(apply)
    else apply()
  }

  function canEdit(asset: MediaAsset) {
    return asset.status === 'ready' && (asset.scope === 'site' || canManageShared)
  }

  // Deletion and restoration are two ends of the same permission: a deleted
  // asset must remain restorable by whoever could have deleted it.
  function canDelete(asset: MediaAsset) {
    return (
      (asset.status === 'ready' || asset.status === 'deleted') &&
      (asset.scope === 'shared' ? canManageShared : canManage)
    )
  }

  function toggleChecked(asset: MediaAsset) {
    if (!canEdit(asset) || mutationInFlight.current) return
    chooseBulkTargets(() =>
      setCheckedIds(current => {
        const next = new Set(current)
        if (next.has(asset.id)) next.delete(asset.id)
        else next.add(asset.id)
        return next
      }),
    )
  }

  async function refreshLibraryOnly() {
    if (mutationInFlight.current) return
    setLoading(true)
    setError(null)
    try {
      await refresh()
      setRefreshNeeded(false)
    } catch {
      setError('The library could not be refreshed. The last confirmed changes are still applied.')
      setRefreshNeeded(true)
    }
  }

  async function confirmMutation() {
    if (!pending || mutationInFlight.current) return
    mutationInFlight.current = true
    const action = pending
    let completed = false
    setWorking(true)
    setError(null)
    setRefreshNeeded(false)
    try {
      const next =
        action.kind === 'delete' ? await deleteMedia(action.asset, deletionReason) : await restoreMedia(action.asset)
      completed = true
      rememberAssets([next])
      setPending(null)
      setSelectedId(next.id)
      await refresh()
    } catch (reason) {
      setPending(null)
      setRefreshNeeded(true)
      setError(
        completed
          ? `The image was ${action.kind === 'delete' ? 'deleted' : 'restored'}, but the library could not be refreshed. Refresh the list without repeating the action.`
          : reason instanceof MediaRequestError
            ? reason.message
            : 'The media action could not be confirmed. Refresh the library before trying again.',
      )
    } finally {
      mutationInFlight.current = false
      setWorking(false)
    }
  }

  async function organizeChecked(): Promise<{ ok: boolean; message?: string }> {
    if (checked.length === 0 || mutationInFlight.current)
      return { ok: false, message: 'Choose images or wait for the current action to finish.' }
    mutationInFlight.current = true
    let completed = false
    setWorking(true)
    setError(null)
    setRefreshNeeded(false)
    try {
      const changed = await bulkOrganizeMedia(siteId, {
        assets: checked,
        folder: bulkFolder.trim() === '' ? null : bulkFolder.trim(),
        addTags: normalizedTags(bulkTags),
        removeTags: [],
      })
      completed = true
      rememberAssets(changed)
      const uploadDraft = uploadLeave.current?.()
      if (!uploadDraft?.dirty && !uploadDraft?.pending) setSelectedId(changed[0]?.id ?? selectedId)
      setCheckedIds(new Set())
      setBulkFolder(bulkFolder.trim())
      setBulkTags('')
      setBulkBaseline({ folder: bulkFolder.trim(), tags: '' })
      await refresh()
      return { ok: true }
    } catch (reason) {
      setRefreshNeeded(true)
      const message = completed
        ? 'The selected images were organized, but the library could not be refreshed. Refresh the list without repeating the action.'
        : reason instanceof MediaRequestError
          ? reason.message
          : 'The organization changes could not be confirmed. Refresh the library before trying again.'
      setError(message)
      return { ok: completed, message }
    } finally {
      mutationInFlight.current = false
      setWorking(false)
    }
  }

  async function deleteChecked() {
    if (checked.length === 0 || mutationInFlight.current) return
    mutationInFlight.current = true
    let completed = false
    setWorking(true)
    setError(null)
    setRefreshNeeded(false)
    try {
      const deleted = await bulkDeleteMedia(siteId, {
        assets: checked,
        breakReferences: checked.some(asset => asset.usedInVersions > 0),
        reason: deletionReason.trim() || null,
      })
      completed = true
      rememberAssets(deleted)
      setBulkDeletePending(false)
      setCheckedIds(new Set())
      setDeletionReason('')
      await refresh()
    } catch (reason) {
      setBulkDeletePending(false)
      setRefreshNeeded(true)
      setError(
        completed
          ? 'The selected images were deleted, but the library could not be refreshed. Refresh the list without repeating the action.'
          : reason instanceof MediaRequestError
            ? reason.message
            : 'Deletion could not be confirmed. Refresh the library before trying again.',
      )
    } finally {
      mutationInFlight.current = false
      setWorking(false)
    }
  }

  const DetailsPanel = native ? DetailPanel : Drawer
  const imageDetails =
    selected && !replacement ? (
      <DetailsPanel
        density="compact"
        size="narrow"
        title="Image details"
        onClose={() => {
          if (metadataLock.current || mutationInFlight.current) return
          leaveDetails(() => {
            setSelectedId(null)
            metadataDirty.current = false
            setMetadataChanged(false)
          })
        }}
        pending={working || metadataBusy}
        footer={
          detailTab === 'details' && canEdit(selected) ? (
            <Button
              type="submit"
              form={'media-metadata-' + selected.id}
              disabled={!metadataChanged || working || metadataBusy}
            >
              {metadataBusy ? 'Saving…' : 'Save image details'}
            </Button>
          ) : undefined
        }
      >
        <div className={styles.details + ' ' + mediaUi.details + ' ' + shared.singleColumn}>
          <MediaDetail
            key={selected.id}
            onReplace={() => {
              if (metadataLock.current || mutationInFlight.current) return
              leaveDetails(() => {
                metadataDirty.current = false
                setMetadataChanged(false)
                setReplacement(selected)
              })
            }}
            externalSave
            onTabChange={setDetailTab}
            onBusyChange={value => {
              metadataLock.current = value
              setMetadataBusy(value)
            }}
            onDirtyChange={value => {
              metadataDirty.current = value
              setMetadataChanged(value)
            }}
            asset={selected}
            canEdit={canEdit(selected)}
            canDelete={canDelete(selected)}
            working={working || metadataBusy}
            onSaved={async asset => {
              setSelectedId(asset.id)
              await refresh()
            }}
            onDelete={() =>
              leaveDetails(() => {
                setDeletionReason('')
                setPending({ kind: 'delete', asset: selected })
              })
            }
            onRestore={() => leaveDetails(() => setPending({ kind: 'restore', asset: selected }))}
          />
        </div>
      </DetailsPanel>
    ) : null
  const uploadActions = (
    <>
      <Button
        onClick={() => {
          if (!uploadOpen) {
            const open = () => {
              if (native) setSelectedId(null)
              setUploadOpen(true)
            }
            if (native) leaveDetails(open)
            else open()
            return
          }
          if (!uploadLeave.current) {
            setUploadOpen(false)
            return
          }
          const close = () => setUploadOpen(false)
          if (requestLocalDraftNavigation(() => uploadLeave.current?.() ?? { dirty: false, pending: false }, close))
            close()
        }}
        aria-expanded={uploadOpen}
      >
        <IconPlus size={16} />
        {uploadOpen ? 'Close upload' : 'Upload images'}
      </Button>
      {result.facets.statuses.failed > 0 && (
        <Button
          variant="secondary"
          aria-pressed={query.status === 'failed'}
          onClick={() => changeQuery({ status: query.status === 'failed' ? 'all' : 'failed' })}
        >
          Needs attention ({result.facets.statuses.failed})
        </Button>
      )}
    </>
  )

  function searchMedia(value: string) {
    const apply = () => {
      if (native) {
        setSelectedId(null)
        metadataDirty.current = false
        setMetadataChanged(false)
      }
      setSearchInput(value)
    }
    if (native || bulkDirty) leaveDetails(apply)
    else apply()
  }
  function selectVisibleImages() {
    chooseBulkTargets(() => setCheckedIds(new Set(result.assets.filter(canEdit).map(asset => asset.id))))
  }
  function clearMediaFilters() {
    const clear = () => {
      setCheckedIds(new Set())
      setSearchInput('')
      setQuery(DEFAULT_MEDIA_LIBRARY_QUERY)
    }
    if (native || bulkDirty) leaveDetails(clear)
    else clear()
  }
  function openImage(id: string) {
    const select = () => {
      if (native) setCheckedIds(new Set())
      setDetailTab('details')
      metadataDirty.current = false
      setMetadataChanged(false)
      setSelectedId(id)
    }
    if (native) {
      if (selectedId !== id) leaveDetails(select)
    } else select()
  }

  function retryMediaLibrary() {
    const retry = () => void refreshLibraryOnly()
    if (native || bulkDirty) leaveDetails(retry)
    else retry()
  }

  const workspace = (
    <div
      className={styles.workspace + (native ? ' ' + listInspectorStyles.formStack : '')}
      data-native={native || undefined}
    >
      {native ? (
        <>
          <PageHeader
            title="Media"
            stacked
            density="compact"
            showWayfinding={false}
            sub="Photos for pages and stories. Large photos are resized for the web."
            actions={uploadActions}
            tabs={siteAreaTabs(siteId, 'media', 'media')}
          />
          <p className={mediaUi.dropHint}>
            <IconImage size={16} />
            Drop a JPEG, PNG or WebP image anywhere on this page
          </p>
        </>
      ) : (
        <div className={styles.actions}>{uploadActions}</div>
      )}

      {uploadOpen && (
        <MediaUploadPanel
          leaveRef={uploadLeave}
          siteId={siteId}
          defaultFolder={query.folder}
          droppedFile={droppedFile}
          onClose={() => setUploadOpen(false)}
          onAccepted={receipt => {
            setTrackedUpload(receipt)
            setPollExhausted(false)
            setUploadState({
              intentId: receipt.intentId,
              status: 'processing',
              originalName: receipt.originalName,
              failureCode: null,
              asset: null,
            })
          }}
        />
      )}

      <MediaNotices
        trackedUpload={trackedUpload}
        uploadState={uploadState}
        selectedId={selectedId}
        pollExhausted={pollExhausted}
        error={error}
        retrying={working || loading}
        checkStatus={() => setPollCycle(value => value + 1)}
        chooseFileAgain={() => {
          setTrackedUpload(null)
          setUploadState(null)
          setUploadOpen(true)
        }}
        retryLibrary={native || refreshNeeded ? retryMediaLibrary : undefined}
        dismissError={() => setError(null)}
      />

      {checked.length > 0 && (
        <MediaBulkSelection
          count={checked.length}
          bulkFolder={bulkFolder}
          bulkTags={bulkTags}
          working={working}
          metadataBusy={metadataBusy}
          bulkDirty={bulkDirty}
          canDeleteSelection={checked.every(canDelete)}
          clearSelection={() => leaveBulk(() => setCheckedIds(new Set()))}
          changeFolder={value => changeBulk(() => setBulkFolder(value))}
          changeTags={value => changeBulk(() => setBulkTags(value))}
          applyOrganization={() => void organizeChecked()}
          discardChanges={discardBulk}
          openDelete={() => {
            if (!mutationInFlight.current) {
              setDeletionReason('')
              setBulkDeletePending(true)
            }
          }}
        />
      )}

      <MediaLibraryBrowser
        browse={{
          native,
          loading,
          result,
          query,
          view,
          searchInput,
          foldersExpanded,
          selectedId: selected?.id,
          checkedIds,
        }}
        actions={{
          changeSearch: searchMedia,
          changeQuery,
          changeView: setView,
          changeFoldersExpanded: setFoldersExpanded,
          selectPage: selectVisibleImages,
          clearFilters: clearMediaFilters,
          canEdit,
          toggleChecked,
          openImage,
        }}
      />

      {!native && imageDetails}

      {replacement && (
        <ImageReplacement
          siteId={siteId}
          source={replacement}
          assets={result.assets}
          onClose={() => setReplacement(null)}
          onSaved={() => {
            setReplacement(null)
            setSelectedId(null)
            void refreshLibraryOnly()
          }}
        />
      )}

      <MediaLifecycleDialogs
        pending={pending}
        bulkDeletePending={
          bulkDeletePending
            ? { count: checked.length, referenced: checked.some(asset => asset.usedInVersions > 0) }
            : null
        }
        working={working}
        deletionReason={deletionReason}
        changeReason={value => {
          if (!mutationInFlight.current) setDeletionReason(value)
        }}
        confirmSingle={() => void confirmMutation()}
        closeSingle={() => {
          if (!mutationInFlight.current) setPending(null)
        }}
        confirmBulk={() => void deleteChecked()}
        closeBulk={() => {
          if (!mutationInFlight.current) setBulkDeletePending(false)
        }}
      />
    </div>
  )
  return native ? (
    <div className={mediaUi.layout} data-details={Boolean(selected && !replacement)}>
      {workspace}
      {imageDetails}
    </div>
  ) : (
    workspace
  )
}
