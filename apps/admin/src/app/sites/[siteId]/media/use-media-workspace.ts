import { requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { useEffect, useRef, useState } from 'react'
import { type MediaAsset, type MediaLibraryQuery, type MediaLibraryResult } from '../../../../lib/media-library.ts'
import type { NavigationGuardState } from '../../../../lib/navigation-guard.ts'
import { type MediaLibraryView } from './media-library-browser.tsx'
import { useMediaLibraryResults } from './use-media-library-results.ts'
import { DEFAULT_MEDIA_LIBRARY_QUERY } from '../../../../lib/media-library-defaults.ts'
import { useMediaLifecycle } from './use-media-lifecycle.ts'
import { useMediaWorkspaceUpload } from './use-media-workspace-upload.ts'

export type MediaWorkspaceProps = {
  native?: boolean
  siteId: string
  initialResult: MediaLibraryResult
  canManage: boolean
  canManageShared: boolean
}

export function useMediaWorkspace({
  siteId,
  initialResult,
  canManage,
  canManageShared,
  native = false,
}: MediaWorkspaceProps) {
  const [metadataBusy, setMetadataBusy] = useState(false)
  const [metadataChanged, setMetadataChanged] = useState(false)
  const [detailTab, setDetailTab] = useState<'details' | 'usage'>('details')
  const metadataLock = useRef(false)
  const metadataDirty = useRef(false)
  const [searchInput, setSearchInput] = useState('')
  const [view, setView] = useState<MediaLibraryView>('grid')
  const [foldersExpanded, setFoldersExpanded] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width:64rem)')
    const update = () => setFoldersExpanded(!query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<MediaAsset | null>(null)
  const uploadLeave = useRef<(() => NavigationGuardState) | null>(null)
  const { result, query, setQuery, loading, setLoading, error, setError, refresh, rememberAssets } =
    useMediaLibraryResults(siteId, initialResult, setSelectedId)

  const selected = result.assets.find(asset => asset.id === selectedId) ?? null
  const lifecycle = useMediaLifecycle({
    siteId,
    native,
    canManage,
    canManageShared,
    assets: result.assets,
    selectedId,
    setSelectedId,
    metadataLock,
    metadataDirty,
    uploadLeave,
    refresh,
    rememberAssets,
    setLoading,
    setError,
  })
  const {
    checkedIds,
    setCheckedIds,
    mutationInFlight,
    bulkFolder,
    bulkTags,
    bulkDirty,
    bulkState,
    chooseBulkTargets,
    leaveDetails,
    canEdit,
    refreshLibraryOnly,
  } = lifecycle
  const upload = useMediaWorkspaceUpload({
    native,
    initialOpen: initialResult.total === 0,
    uploadLeave,
    setSelectedId,
    refresh,
    mutationInFlight,
    leaveDetails,
  })
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
  return {
    lifecycle,
    upload,
    siteId,
    native,
    metadataBusy,
    setMetadataBusy,
    metadataChanged,
    setMetadataChanged,
    detailTab,
    setDetailTab,
    metadataLock,
    metadataDirty,
    searchInput,
    view,
    setView,
    foldersExpanded,
    setFoldersExpanded,
    selectedId,
    setSelectedId,
    replacement,
    setReplacement,
    uploadLeave,
    result,
    query,
    loading,
    error,
    setError,
    refresh,
    selected,
    changeQuery,
    searchMedia,
    selectVisibleImages,
    clearMediaFilters,
    openImage,
    retryMediaLibrary,
  }
}

export type MediaWorkspaceModel = ReturnType<typeof useMediaWorkspace>
