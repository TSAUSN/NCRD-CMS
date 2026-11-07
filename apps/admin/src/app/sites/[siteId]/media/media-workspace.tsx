'use client'
import {
  useNavigationGuard,
  requestClientNavigation,
  requestLocalDraftNavigation,
} from '../../../../components/navigation-guard.ts'
import styles from './media-workspace.module.css'
import state from '../../../../components/state.module.css'
import mediaUi from '../../../../components/media-ui.module.css'
import { MediaThumbnail as MediaThumb } from '../../../../components/media-thumbnail.tsx'
import {
  Drawer,
  Button,
  DetailPanel,
  Disclosure,
  Field,
  Badge,
  SegmentedControl,
} from '../../../../components/ui/index.ts'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import shared from '../../../../components/workspace.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog, ReasonDialog } from '../../../../components/confirm.tsx'
import {
  IconAlert,
  IconChevronLeft,
  IconChevronRight,
  IconImage,
  IconInfo,
  IconPlus,
  IconSearch,
  IconTrash,
} from '../../../../components/icons.tsx'
import {
  bulkDeleteMedia,
  bulkOrganizeMedia,
  deleteMedia,
  fetchMediaLibrary,
  formatDimensions,
  mediaStatusLabel,
  mediaUploadFailureMessage,
  mediaUploadStatus,
  MediaRequestError,
  restoreMedia,
  type MediaAsset,
  type MediaLibraryQuery,
  type MediaLibraryResult,
  type MediaStatus,
  type MediaUploadIntentStatus,
  type MediaUploadReceipt,
} from '../../../../lib/media-library.ts'
import type { NavigationGuardState } from '../../../../lib/navigation-guard.ts'
import { MediaUploadPanel } from './media-upload-panel.tsx'
import { ImageReplacement } from './image-replacement.tsx'
import { MediaDetail } from './media-detail.tsx'
import { normalizedTags } from './media-tags.ts'

type View = 'grid' | 'list'

type PendingAction = { kind: 'delete' | 'restore'; asset: MediaAsset }

const INITIAL_QUERY: MediaLibraryQuery = {
  search: '',
  status: 'all',
  scope: 'all',
  folder: '',
  tag: '',
  sort: 'newest',
  page: 1,
  pageSize: 24,
}

const FILTERS: Array<{ value: 'all' | MediaStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
  { value: 'deleted', label: 'Deleted' },
]

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
  const [result, setResult] = useState(initialResult)
  const [metadataBusy, setMetadataBusy] = useState(false),
    [metadataChanged, setMetadataChanged] = useState(false),
    [detailTab, setDetailTab] = useState<'details' | 'usage'>('details')
  const metadataLock = useRef(false),
    metadataDirty = useRef(false)
  const [droppedFile, setDroppedFile] = useState<File | null>(null)
  const [query, setQuery] = useState<MediaLibraryQuery>(INITIAL_QUERY)
  const [searchInput, setSearchInput] = useState('')
  const [view, setView] = useState<View>('grid')
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
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [bulkDeletePending, setBulkDeletePending] = useState(false)
  const [deletionReason, setDeletionReason] = useState('')
  const [working, setWorking] = useState(false)
  const mutationInFlight = useRef(false)
  const [refreshNeeded, setRefreshNeeded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trackedUpload, setTrackedUpload] = useState<MediaUploadReceipt | null>(null)
  const [uploadState, setUploadState] = useState<MediaUploadIntentStatus | null>(null)
  const [pollCycle, setPollCycle] = useState(0)
  const [pollExhausted, setPollExhausted] = useState(false)
  const [bulkFolder, setBulkFolder] = useState('')
  const [bulkTags, setBulkTags] = useState('')
  const [bulkBaseline, setBulkBaseline] = useState({ folder: '', tags: '' })
  const requestSequence = useRef(0)
  const activeQuery = useRef(query)

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
  const folders = useMemo(() => folderTree(result.facets.folders), [result.facets.folders])

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
    activeQuery.current = query
    const sequence = ++requestSequence.current
    setLoading(true)
    fetchMediaLibrary(siteId, query)
      .then(next => {
        if (sequence !== requestSequence.current) return
        setResult(next)
        setSelectedId(current => (next.assets.some(asset => asset.id === current) ? current : null))
      })
      .catch(reason => {
        if (sequence === requestSequence.current)
          setError(reason instanceof MediaRequestError ? reason.message : 'The media library could not be refreshed.')
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false)
      })
  }, [query, siteId])

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

  async function refresh() {
    const sequence = ++requestSequence.current
    try {
      const next = await fetchMediaLibrary(siteId, activeQuery.current)
      if (sequence === requestSequence.current) setResult(next)
      return next
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
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

  function rememberAssets(assets: MediaAsset[]) {
    setResult(current => ({
      ...current,
      assets: current.assets.map(asset => assets.find(changed => changed.id === asset.id) ?? asset),
    }))
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

      {trackedUpload && uploadState?.status !== 'failed' && (
        <p
          className={`notice ${uploadState?.status === 'ready' ? 'notice-ok' : 'notice-info'} media-notice`}
          role="status"
        >
          <IconInfo size={16} />
          <span className="notice-body">
            {uploadState?.status === 'ready'
              ? `${uploadState.originalName} ${selectedId === uploadState.asset?.id ? 'is ready and selected.' : 'is ready in Media.'}`
              : pollExhausted
                ? `${trackedUpload.originalName} is still processing. Check again without uploading it twice.`
                : `${trackedUpload.originalName} is being verified and will be selected when ready.`}
          </span>
          {pollExhausted && (
            <Button
              variant="secondary"
              type="button"
              className="secondary small"
              onClick={() => setPollCycle(value => value + 1)}
            >
              Check status
            </Button>
          )}
        </p>
      )}
      {uploadState?.status === 'failed' && (
        <p className="notice notice-error media-notice" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{mediaUploadFailureMessage(uploadState.failureCode)}</span>
          <Button
            variant="secondary"
            type="button"
            className="secondary small"
            onClick={() => {
              setTrackedUpload(null)
              setUploadState(null)
              setUploadOpen(true)
            }}
          >
            Choose the file again
          </Button>
        </p>
      )}
      {error && (
        <p className="notice notice-error media-notice" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{error}</span>
          {(native || refreshNeeded) && (
            <Button
              variant="secondary"
              type="button"
              className="secondary small"
              disabled={working || loading}
              onClick={() => {
                const retry = () => void refreshLibraryOnly()
                if (native || bulkDirty) leaveDetails(retry)
                else retry()
              }}
            >
              Refresh library
            </Button>
          )}
          <Button
            variant="tertiary"
            type="button"
            className="icon-btn"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </Button>
        </p>
      )}

      {checked.length > 0 && (
        <section className="media-bulk" aria-label="Bulk media actions">
          <div>
            <strong>{checked.length} selected</strong>
            <Button
              variant="tertiary"
              type="button"
              className="link"
              onClick={() => leaveBulk(() => setCheckedIds(new Set()))}
            >
              Clear selection
            </Button>
          </div>
          <p>Folder and tags update selected images in Media. Page and story content stays unchanged.</p>
          <label>
            <span>Move to folder</span>
            <input
              disabled={working || metadataBusy}
              value={bulkFolder}
              placeholder="Campaigns/Fall Appeal"
              onChange={event => {
                const value = event.target.value
                changeBulk(() => setBulkFolder(value))
              }}
            />
          </label>
          <label>
            <span>Add tags</span>
            <input
              disabled={working || metadataBusy}
              value={bulkTags}
              placeholder="appeal, approved"
              onChange={event => {
                const value = event.target.value
                changeBulk(() => setBulkTags(value))
              }}
            />
          </label>
          <Button variant="primary" type="button" disabled={working} onClick={() => void organizeChecked()}>
            Apply organization
          </Button>
          {bulkDirty && (
            <Button variant="secondary" type="button" className="secondary" disabled={working} onClick={discardBulk}>
              Discard organization changes
            </Button>
          )}
          {bulkDirty && checked.every(canDelete) && (
            <p>Apply or discard organization changes before deleting selected images.</p>
          )}
          {checked.every(canDelete) && (
            <Button
              variant="destructive"
              type="button"
              className="danger"
              disabled={working || bulkDirty}
              onClick={() => {
                if (!mutationInFlight.current) {
                  setDeletionReason('')
                  setBulkDeletePending(true)
                }
              }}
            >
              <IconTrash size={15} /> Delete selected
            </Button>
          )}
        </section>
      )}

      <section className="media-library" aria-labelledby="media-library-title" aria-busy={loading}>
        <div className={'media-library-head ' + mediaUi.toolbar}>
          <div>
            {!native && <p className="eyebrow">Browse and organize</p>}
            <h2 id="media-library-title" className={native ? selectionControlsStyles.visuallyHidden : undefined}>
              Image library
            </h2>
          </div>
          <div className="media-search">
            <IconSearch size={16} />
            <label className="sr-only" htmlFor="media-search">
              Search all images
            </label>
            <input
              id="media-search"
              type="search"
              placeholder="Search names, descriptions, credits or tags"
              value={searchInput}
              onChange={event => {
                const value = event.target.value
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
              }}
            />
          </div>
        </div>
        <div className={'media-controls ' + mediaUi.toolbar}>
          <SegmentedControl
            appearance="pills"
            size="s"
            label="Filter images by status"
            value={query.status}
            options={FILTERS.filter(option => option.value !== 'failed')}
            onChange={value => changeQuery({ status: value as MediaLibraryQuery['status'] })}
          />
          <MoreMediaFilters native={native}>
            <Field id="media-filter-scope" label="Library" density="compact">
              <select
                value={query.scope}
                onChange={event => changeQuery({ scope: event.target.value as MediaLibraryQuery['scope'] })}
              >
                <option value="all">Site + shared</option>
                <option value="site">This site ({result.facets.scopes.site})</option>
                <option value="shared">Shared ({result.facets.scopes.shared})</option>
              </select>
            </Field>
            <Field id="media-filter-tag" label="Tag" density="compact">
              <select value={query.tag} onChange={event => changeQuery({ tag: event.target.value })}>
                <option value="">Any tag</option>
                {result.facets.tags.map(tag => (
                  <option key={tag.tag} value={tag.tag}>
                    {tag.tag} ({tag.count})
                  </option>
                ))}
              </select>
            </Field>
            <Field id="media-filter-sort" label="Sort" density="compact">
              <select
                value={query.sort}
                onChange={event => changeQuery({ sort: event.target.value as MediaLibraryQuery['sort'] })}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
              </select>
            </Field>
          </MoreMediaFilters>
          <SegmentedControl
            appearance="pills"
            size="s"
            label="Library view"
            value={view}
            options={[
              { value: 'grid', label: 'Grid' },
              { value: 'list', label: 'List' },
            ]}
            onChange={value => setView(value as View)}
          />
        </div>

        <div className="media-organizer">
          <Disclosure
            title="Folders"
            className={styles.folders + ' ' + mediaUi.folders}
            open={foldersExpanded}
            onToggle={event => {
              if (event.target === event.currentTarget) setFoldersExpanded(event.currentTarget.open)
            }}
            aria-label="Folders"
          >
            <button
              type="button"
              className={query.folder === '' ? 'on' : ''}
              onClick={() => changeQuery({ folder: '' })}
            >
              <span>All images</span>
              <strong>{result.facets.folders.reduce((sum, row) => sum + row.count, 0)}</strong>
            </button>
            {folders.map(folder => (
              <button
                type="button"
                key={folder.path}
                className={query.folder === folder.path ? 'on' : ''}
                style={{ paddingInlineStart: `calc(var(--space-3) + var(--space-4) * ${folder.depth})` }}
                onClick={() => changeQuery({ folder: folder.path })}
              >
                <span className={listInspectorStyles.itemLabel} title={folder.path}>
                  {folder.label || 'Unfiled'}
                </span>
                <strong>{folder.count}</strong>
              </button>
            ))}
          </Disclosure>

          <div className={'media-results ' + mediaUi.results}>
            <div className="media-results-head">
              <p role="status">
                {loading ? 'Loading…' : `${result.total} ${result.total === 1 ? 'result' : 'results'}`}
              </p>
              {result.assets.some(canEdit) && (
                <Button
                  variant="secondary"
                  type="button"
                  className="small secondary"
                  onClick={() =>
                    chooseBulkTargets(() =>
                      setCheckedIds(new Set(result.assets.filter(canEdit).map(asset => asset.id))),
                    )
                  }
                >
                  Select this page
                </Button>
              )}
            </div>
            {result.assets.length === 0 ? (
              <div className={'media-empty ' + state.state}>
                <span>
                  <IconSearch size={24} />
                </span>
                <h3>No images match these filters</h3>
                <p>Try all folders, clear the tag, or use fewer search terms.</p>
                <Button
                  variant="secondary"
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const clear = () => {
                      setCheckedIds(new Set())
                      setSearchInput('')
                      setQuery(INITIAL_QUERY)
                    }
                    if (native || bulkDirty) leaveDetails(clear)
                    else clear()
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              // A plain list: each image opens its details with a button, and its bulk-selection checkbox
              // sits beside that button rather than inside an option, so no control nests in another.
              <ul
                className={`media-assets is-${view} ${mediaUi.gallery}`}
                data-view={view}
                data-compact={native || undefined}
                aria-label="Images"
              >
                {result.assets.map(asset => (
                  <li
                    id={`media-${asset.id}`}
                    key={asset.id}
                    className={'media-asset ' + mediaUi.asset}
                    data-selected={selected?.id === asset.id ? 'true' : undefined}
                  >
                    {canEdit(asset) && (
                      <label className={'media-asset-check ' + selectionControlsStyles.checkRow}>
                        <input
                          type="checkbox"
                          checked={checkedIds.has(asset.id)}
                          onChange={() => toggleChecked(asset)}
                          aria-label={`Select ${asset.name}`}
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      className="media-asset-open"
                      aria-pressed={selected?.id === asset.id}
                      onClick={() => {
                        const select = () => {
                          if (native) setCheckedIds(new Set())
                          setDetailTab('details')
                          metadataDirty.current = false
                          setMetadataChanged(false)
                          setSelectedId(asset.id)
                        }
                        if (native) {
                          if (selectedId !== asset.id) leaveDetails(select)
                        } else select()
                      }}
                    >
                      <MediaThumb asset={asset} />
                      <span className={'media-asset-copy ' + mediaUi.copy}>
                        <strong title={asset.name}>{asset.name}</strong>
                        <small>
                          {asset.folder || 'Unfiled'} · {formatDimensions(asset)}
                        </small>
                        <Badge
                          tone={
                            asset.status === 'ready'
                              ? 'live'
                              : asset.status === 'failed'
                                ? 'error'
                                : asset.status === 'processing'
                                  ? 'info'
                                  : 'neutral'
                          }
                        >
                          {mediaStatusLabel(asset.status)}
                        </Badge>
                        {asset.tags.length > 0 && (
                          <span className="media-card-tags">{asset.tags.slice(0, 3).join(' · ')}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <nav className="media-pagination" aria-label="Media pages">
              <Button
                variant="secondary"
                type="button"
                className="secondary"
                disabled={result.page <= 1 || loading}
                onClick={() => changeQuery({ page: result.page - 1 })}
              >
                <IconChevronLeft size={15} /> Previous
              </Button>
              <span>
                Page {result.page} of {result.pageCount}
              </span>
              <label>
                <span>Items per page</span>
                <select
                  value={query.pageSize}
                  onChange={event =>
                    changeQuery({
                      pageSize: Number(event.target.value),
                    })
                  }
                >
                  <option value="12">12</option>
                  <option value="24">24</option>
                  <option value="48">48</option>
                </select>
              </label>
              <Button
                variant="secondary"
                type="button"
                className="secondary"
                disabled={result.page >= result.pageCount || loading}
                onClick={() => changeQuery({ page: result.page + 1 })}
              >
                Next <IconChevronRight size={15} />
              </Button>
            </nav>
          </div>
        </div>
      </section>

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

      {pending?.kind === 'delete' && pending.asset.usedInVersions > 0 ? (
        <ReasonDialog
          minLength={8}
          tone="destructive"
          pending={working}
          title="Delete an image that is still referenced?"
          explanation={
            <>
              {pending.asset.usedOnItems} content items reference this image across {pending.asset.usedInVersions} saved
              versions. Record why breaking those references is acceptable.
            </>
          }
          label="Reason for breaking these references"
          value={deletionReason}
          confirmLabel="Delete image"
          onChange={value => {
            if (!mutationInFlight.current) setDeletionReason(value)
          }}
          onConfirm={() => {
            if (deletionReason.trim().length >= 8) void confirmMutation()
          }}
          onCancel={() => {
            if (!mutationInFlight.current) setPending(null)
          }}
        />
      ) : pending ? (
        <ConfirmDialog
          tone={pending.kind === 'restore' ? 'primary' : 'danger'}
          pending={working}
          title={pending.kind === 'delete' ? 'Delete this image?' : 'Restore this image?'}
          what={
            pending.kind === 'delete'
              ? 'It will leave the active library.'
              : `“${pending.asset.name}” will return to the active library.`
          }
          reassurance={
            pending.kind === 'delete' ? 'This is a recoverable soft delete.' : 'Restoring does not add it to content.'
          }
          confirmLabel={pending.kind === 'delete' ? 'Delete image' : 'Restore image'}
          onConfirm={() => void confirmMutation()}
          onCancel={() => {
            if (!mutationInFlight.current) setPending(null)
          }}
        />
      ) : null}

      {bulkDeletePending && checked.some(asset => asset.usedInVersions > 0) ? (
        <ReasonDialog
          minLength={8}
          tone="destructive"
          pending={working}
          title={`Delete ${checked.length} selected images?`}
          explanation={
            <>
              At least one selected image is referenced by saved content. The entire delete is atomic: either every
              selected image is deleted or none are.
            </>
          }
          label="Reason for breaking these references"
          value={deletionReason}
          confirmLabel="Delete selected"
          onChange={value => {
            if (!mutationInFlight.current) setDeletionReason(value)
          }}
          onConfirm={() => {
            if (deletionReason.trim().length >= 8) void deleteChecked()
          }}
          onCancel={() => {
            if (!mutationInFlight.current) setBulkDeletePending(false)
          }}
        />
      ) : bulkDeletePending ? (
        <ConfirmDialog
          pending={working}
          title={`Delete ${checked.length} selected images?`}
          what="None of the selected images is currently referenced."
          reassurance="The entire operation is atomic and each image remains recoverable during retention."
          confirmLabel="Delete selected"
          onConfirm={() => void deleteChecked()}
          onCancel={() => {
            if (!mutationInFlight.current) setBulkDeletePending(false)
          }}
        />
      ) : null}
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

function MoreMediaFilters({ native, children }: { native: boolean; children: ReactNode }) {
  return native ? (
    <Disclosure title="More filters" className={mediaUi.options}>
      <div className={mediaUi.optionFields}>{children}</div>
    </Disclosure>
  ) : (
    children
  )
}

function folderTree(rows: Array<{ path: string; count: number }>) {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (!row.path) {
      totals.set('', (totals.get('') ?? 0) + row.count)
      continue
    }
    const parts = row.path.split('/')
    for (let index = 1; index <= parts.length; index += 1) {
      const path = parts.slice(0, index).join('/')
      totals.set(path, (totals.get(path) ?? 0) + row.count)
    }
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, count]) => ({
      path,
      count,
      depth: path ? path.split('/').length - 1 : 0,
      label: path ? path.split('/').at(-1)! : 'Unfiled',
    }))
}
