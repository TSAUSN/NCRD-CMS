import { requestLocalDraftNavigation } from '../../../components/navigation-guard.ts'
import type { NavigationGuardState } from '../../../lib/navigation-guard.ts'
import { imageFocus } from '@cms/schema'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMediaLibrary,
  matchesMediaPlacement,
  mediaUploadStatus,
  type ImagePlacementValue,
  type MediaAsset,
  type MediaUploadIntentStatus,
  type MediaUploadReceipt,
} from '../../../lib/media-library.ts'

export type MediaPickerProps = {
  requireDescription?: boolean
  onSelectedAsset?: (asset: MediaAsset) => void
  mode?: 'placement' | 'replacement' | 'site-logo'
  excludeId?: string
  confirmLabel?: string
  siteId: string
  initialAssets: MediaAsset[]
  currentValue?: Partial<ImagePlacementValue>
  onChoose: (value: ImagePlacementValue) => void
  onClose: () => void
}

export function useMediaPicker({
  siteId,
  initialAssets,
  currentValue,
  onChoose,
  onClose,
  onSelectedAsset,
  mode = 'placement',
  requireDescription = false,
  excludeId,
}: MediaPickerProps) {
  const [assets, setAssets] = useState(initialAssets)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const hasCurrentPlacement = Boolean(currentValue?.media_id || currentValue?.src)
  const initialSelected = useMemo(
    () =>
      initialAssets.find(asset => matchesMediaPlacement(asset, currentValue)) ??
      (hasCurrentPlacement
        ? null
        : (initialAssets.find(asset => asset.status === 'ready') ?? initialAssets[0] ?? null)),
    [currentValue?.media_id, currentValue?.src, hasCurrentPlacement, initialAssets],
  )
  // An image uploaded in the last opening may not be in the page's original
  // server props. Never silently substitute a different library image for it.
  const [selectedId, setSelectedId] = useState(initialSelected?.id ?? null)
  const [decorative, setDecorative] = useState(
    requireDescription
      ? false
      : hasCurrentPlacement
        ? (currentValue?.decorative ?? false)
        : (initialSelected?.decorative ?? false),
  )
  const [altText, setAltText] = useState(
    hasCurrentPlacement ? (currentValue?.alt ?? '') : (initialSelected?.altText ?? ''),
  )
  const selectionTouched = useRef(false)
  const alive = useRef(true)
  const [verifiedIds, setVerifiedIds] = useState<Set<string>>(() => new Set())
  const refreshUploads = useRef<Map<string, MediaAsset> | null>(null)
  const [refreshCycle, setRefreshCycle] = useState(0)
  const [refreshing, setRefreshing] = useState(true)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const uploadLeave = useRef<(() => NavigationGuardState) | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [trackedUpload, setTrackedUpload] = useState<MediaUploadReceipt | null>(null)
  const [uploadState, setUploadState] = useState<MediaUploadIntentStatus | null>(null)
  const [pollCycle, setPollCycle] = useState(0)
  const [pollExhausted, setPollExhausted] = useState(false)

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return assets
      .filter(asset => asset.id !== excludeId)
      .filter(
        asset =>
          !needle ||
          [asset.name, asset.altText, asset.mimeType].some(value => value.toLocaleLowerCase().includes(needle)),
      )
  }, [assets, search, excludeId])
  const selected = assets.find(asset => asset.id === selectedId) ?? null
  const currentAsset = assets.find(asset => matchesMediaPlacement(asset, currentValue)) ?? null
  const uploadProcessing = Boolean(trackedUpload && uploadState?.status !== 'ready' && uploadState?.status !== 'failed')
  const canUse =
    !uploadProcessing &&
    selected !== null &&
    verifiedIds.has(selected.id) &&
    selected.status === 'ready' &&
    Boolean(selected.deliveryUrl) &&
    (mode !== 'placement' || (!requireDescription && decorative) || altText.trim().length > 0)

  useEffect(() => {
    let cancelled = false
    const uploads = new Map<string, MediaAsset>()
    refreshUploads.current = uploads
    setRefreshing(true)
    setRefreshError(null)
    setVerifiedIds(new Set())
    async function refresh() {
      try {
        // A complete paginated snapshot also withdraws deleted/unavailable
        // cached assets. Verify each returned item before it can be accepted;
        // do not treat absence from only the first page as deletion.
        const snapshot = new Map<string, MediaAsset>()
        for (let page = 1; ; page += 1) {
          const next = await fetchMediaLibrary(siteId, {
            search: '',
            status: 'all',
            scope: 'all',
            folder: '',
            tag: '',
            sort: 'newest',
            page,
            pageSize: 48,
          })
          if (cancelled || !alive.current) return
          for (const asset of next.assets) snapshot.set(asset.id, asset)
          setVerifiedIds(new Set([...snapshot.keys(), ...uploads.keys()]))
          const receivedIds = new Set(next.assets.map(asset => asset.id))
          setAssets(current => [...next.assets, ...current.filter(asset => !receivedIds.has(asset.id))])
          const current = next.assets.find(asset => matchesMediaPlacement(asset, currentValue))
          if (current && !selectionTouched.current) setSelectedId(current.id)
          if (page >= next.pageCount || next.page < page) break
        }
        if (!cancelled && alive.current) {
          for (const [id, asset] of uploads) snapshot.set(id, asset)
          setAssets([...snapshot.values()])
          setVerifiedIds(new Set(snapshot.keys()))
        }
      } catch {
        if (!cancelled && alive.current)
          setRefreshError(
            mode === 'site-logo'
              ? 'The image library could not be fully refreshed. Your current logo is unchanged. Try refreshing the library.'
              : 'The image library could not be fully refreshed. Your current image is unchanged. Try refreshing the library.',
          )
      } finally {
        if (refreshUploads.current === uploads) refreshUploads.current = null
        if (!cancelled && alive.current) setRefreshing(false)
      }
    }
    void refresh()
    return () => {
      cancelled = true
      if (refreshUploads.current === uploads) refreshUploads.current = null
    }
  }, [siteId, refreshCycle, mode])

  function leaveUpload(proceed: () => void) {
    if (!uploadLeave.current) {
      proceed()
      return
    }
    if (requestLocalDraftNavigation(() => uploadLeave.current?.() ?? { dirty: false, pending: false }, proceed))
      proceed()
  }
  function dismiss() {
    leaveUpload(() => {
      alive.current = false
      onClose()
    })
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

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
        if (cancelled || !alive.current) return
        setUploadState(next)
        if (next.status === 'ready' && next.asset) {
          refreshUploads.current?.set(next.asset.id, next.asset)
          setVerifiedIds(current => new Set([...current, next.asset!.id]))
          setAssets(current =>
            current.some(asset => asset.id === next.asset!.id)
              ? current.map(asset => (asset.id === next.asset!.id ? next.asset! : asset))
              : [next.asset!, ...current],
          )
          const uploadDraft = uploadLeave.current?.()
          if (!uploadDraft?.dirty && !uploadDraft?.pending) {
            select(next.asset)
            setUploadOpen(false)
          }
          return
        }
        if (next.status === 'failed') {
          const uploadDraft = uploadLeave.current?.()
          if (!uploadDraft?.dirty && !uploadDraft?.pending) setUploadOpen(false)
          return
        }
      } catch {
        // Status reads may fail transiently while the durable worker continues.
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

  function select(asset: MediaAsset) {
    selectionTouched.current = true
    setSelectedId(asset.id)
    setDecorative(requireDescription ? false : asset.decorative)
    setAltText(!requireDescription && asset.decorative ? '' : asset.altText)
  }

  function useImage() {
    if (!alive.current || !selected || !selected.deliveryUrl || !canUse) return
    const src = selected.deliveryUrl
    leaveUpload(() => {
      onSelectedAsset?.(selected)
      const focal =
        mode === 'placement'
          ? imageFocus(
              matchesMediaPlacement(selected, currentValue) && currentValue?.focal !== undefined
                ? currentValue.focal
                : selected.focal,
            )
          : null
      onChoose({
        ...(focal ? { focal } : {}),
        media_id: selected.id,
        variant: 'wide',
        src,
        alt: decorative ? '' : altText.trim(),
        decorative,
      })
    })
  }

  function clearSelection() {
    selectionTouched.current = true
    setSelectedId(null)
  }

  function toggleUpload() {
    if (uploadOpen) leaveUpload(() => setUploadOpen(false))
    else {
      clearSelection()
      setUploadOpen(true)
    }
  }

  function trackUpload(receipt: MediaUploadReceipt) {
    clearSelection()
    setTrackedUpload(receipt)
    setPollExhausted(false)
    setUploadState({
      intentId: receipt.intentId,
      status: 'processing',
      originalName: receipt.originalName,
      failureCode: null,
      asset: null,
    })
  }

  function chooseFileAgain() {
    setTrackedUpload(null)
    setUploadState(null)
    setPollExhausted(false)
    setUploadOpen(true)
  }

  return {
    mode,
    requireDescription,
    siteId,
    selected,
    selectedId,
    selectedVerified: selected !== null && verifiedIds.has(selected.id),
    search,
    setSearch,
    view,
    setView,
    visible,
    select,
    hasCurrentPlacement,
    currentAsset,
    canUse,
    dismiss,
    useImage,
    altText,
    setAltText,
    decorative,
    setDecorative,
    refreshing,
    refreshError,
    refreshLibrary: () => setRefreshCycle(value => value + 1),
    uploadOpen,
    toggleUpload,
    uploadLeave,
    trackUpload,
    closeUpload: () => setUploadOpen(false),
    trackedUpload,
    uploadState,
    pollExhausted,
    checkUploadStatus: () => setPollCycle(value => value + 1),
    chooseFileAgain,
  }
}
export type MediaPickerModel = ReturnType<typeof useMediaPicker>
