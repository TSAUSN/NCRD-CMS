import {
  useNavigationGuard,
  requestClientNavigation,
  requestLocalDraftNavigation,
} from '../../../../components/navigation-guard.ts'
import { useEffect, useRef, useState } from 'react'
import {
  bulkDeleteMedia,
  bulkOrganizeMedia,
  deleteMedia,
  MediaRequestError,
  restoreMedia,
  type MediaAsset,
  type MediaLibraryResult,
} from '../../../../lib/media-library.ts'
import type { NavigationGuardState } from '../../../../lib/navigation-guard.ts'
import { type MediaLifecycleAction } from './media-lifecycle-dialogs.tsx'
import { normalizedTags } from './media-tags.ts'
import type { Dispatch, RefObject, SetStateAction } from 'react'

type MediaLifecycleInputs = {
  siteId: string
  native: boolean
  canManage: boolean
  canManageShared: boolean
  assets: MediaAsset[]
  selectedId: string | null
  setSelectedId: Dispatch<SetStateAction<string | null>>
  metadataLock: RefObject<boolean>
  metadataDirty: RefObject<boolean>
  uploadLeave: RefObject<(() => NavigationGuardState) | null>
  refresh: () => Promise<MediaLibraryResult>
  rememberAssets: (assets: MediaAsset[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}
export function useMediaLifecycle({
  siteId,
  native,
  canManage,
  canManageShared,
  assets,
  selectedId,
  setSelectedId,
  metadataLock,
  metadataDirty,
  uploadLeave,
  refresh,
  rememberAssets,
  setLoading,
  setError,
}: MediaLifecycleInputs) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<MediaLifecycleAction | null>(null)
  const [bulkDeletePending, setBulkDeletePending] = useState(false)
  const [deletionReason, setDeletionReason] = useState('')
  const [working, setWorking] = useState(false)
  const mutationInFlight = useRef(false)
  const [refreshNeeded, setRefreshNeeded] = useState(false)
  const [bulkFolder, setBulkFolder] = useState('')
  const [bulkTags, setBulkTags] = useState('')
  const [bulkBaseline, setBulkBaseline] = useState({ folder: '', tags: '' })
  const checked = assets.filter(asset => checkedIds.has(asset.id))
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
    }
    const apply = () => leaveBulk(change)
    if (native && metadataDirty.current) leaveDetails(apply)
    else apply()
  }
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
  return {
    checkedIds,
    setCheckedIds,
    pending,
    setPending,
    bulkDeletePending,
    setBulkDeletePending,
    deletionReason,
    setDeletionReason,
    working,
    mutationInFlight,
    refreshNeeded,
    bulkFolder,
    setBulkFolder,
    bulkTags,
    setBulkTags,
    checked,
    bulkDirty,
    discardBulk,
    bulkState,
    leaveBulk,
    changeBulk,
    chooseBulkTargets,
    leaveDetails,
    canEdit,
    canDelete,
    toggleChecked,
    refreshLibraryOnly,
    confirmMutation,
    organizeChecked,
    deleteChecked,
  }
}
