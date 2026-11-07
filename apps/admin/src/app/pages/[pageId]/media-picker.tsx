'use client'

import { requestLocalDraftNavigation } from '../../../components/navigation-guard.ts'
import type { NavigationGuardState } from '../../../lib/navigation-guard.ts'
import { imageFocus } from '@cms/schema'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MediaThumbnail } from '../../../components/media-thumbnail.tsx'
import { Button, Dialog } from '../../../components/ui/index.ts'
import styles from './media-picker.module.css'
import mediaUi from '../../../components/media-ui.module.css'
import { IconAlert, IconImage, IconPlus, IconSearch } from '../../../components/icons.tsx'
import {
  fetchMediaLibrary,
  formatBytes,
  formatDimensions,
  matchesMediaPlacement,
  mediaStatusLabel,
  mediaUploadFailureMessage,
  mediaUploadStatus,
  type ImagePlacementValue,
  type MediaAsset,
  type MediaUploadIntentStatus,
  type MediaUploadReceipt,
} from '../../../lib/media-library.ts'
import { MediaUploadPanel } from '../../sites/[siteId]/media/media-upload-panel.tsx'

/**
 * Reusable image-field chooser. The caller owns the draft update; this component
 * returns the renderer's current `{ src, alt, decorative }` shape plus the
 * optional media id used to preserve provenance once persistence supports it.
 */
export function MediaPicker({
  siteId,
  initialAssets,
  currentValue,
  onChoose,
  onClose,
  confirmLabel = 'Use this image',
  mode = 'placement',
  requireDescription = false,
  excludeId,
  onSelectedAsset,
}: {
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
}) {
  const headingId = useId()
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
          setAssets(current => [
            ...next.assets,
            ...current.filter(asset => !next.assets.some(update => update.id === asset.id)),
          ])
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

  function move(index: number, direction: -1 | 1) {
    if (visible.length === 0) return
    const next = visible[(index + direction + visible.length) % visible.length]!
    select(next)
    window.requestAnimationFrame(() => document.getElementById(`picker-media-${next.id}`)?.focus())
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

  return (
    <Dialog
      title="Choose from the media library"
      closeLabel="Close media library"
      onClose={dismiss}
      size="wide"
      footer={
        <>
          <p>
            {selected?.deliveryUrl
              ? mode === 'replacement'
                ? 'Next, choose which saved drafts should use this image.'
                : mode === 'site-logo'
                  ? 'The chosen logo will be used in the site header. Save the draft when ready.'
                  : 'The image and this accessibility choice will be applied to the field.'
              : 'Choose a ready, visitor-facing image to continue.'}
          </p>
          <Button variant="secondary" onClick={dismiss}>
            Cancel
          </Button>
          <Button disabled={!canUse} onClick={useImage}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.picker}>
        <div className={styles.introduction}>
          <p>
            {mode === 'replacement'
              ? 'Choose a replacement, then review where to use it.'
              : mode === 'site-logo'
                ? 'Choose a site logo.'
                : 'Select an image, then confirm its description for this use.'}
          </p>
          <Button
            variant="secondary"
            aria-expanded={uploadOpen}
            onClick={() => {
              if (!uploadOpen) {
                selectionTouched.current = true
                setSelectedId(null)
              }
              if (uploadOpen) leaveUpload(() => setUploadOpen(false))
              else setUploadOpen(true)
            }}
          >
            <IconPlus size={16} /> Upload
          </Button>
        </div>
        {uploadOpen && (
          <div className="media-picker-upload">
            <MediaUploadPanel
              leaveRef={uploadLeave}
              siteId={siteId}
              onClose={() => setUploadOpen(false)}
              onAccepted={receipt => {
                selectionTouched.current = true
                setSelectedId(null)
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
          </div>
        )}

        {trackedUpload && uploadState?.status !== 'failed' && (
          <p
            className={`notice ${uploadState?.status === 'ready' ? 'notice-ok' : 'notice-info'} media-notice`}
            role="status"
          >
            <span className="notice-body">
              {uploadState?.status === 'ready'
                ? `${uploadState.originalName} ${selectedId === uploadState.asset?.id ? 'is ready and selected.' : 'is ready in Media.'}`
                : pollExhausted
                  ? `${trackedUpload.originalName} is still being processed. You can check again without uploading it twice.`
                  : `${trackedUpload.originalName} is being verified. It will be selected when its responsive images are ready.`}
            </span>
            {pollExhausted && (
              <button type="button" className="secondary small" onClick={() => setPollCycle(value => value + 1)}>
                Check status
              </button>
            )}
          </p>
        )}
        {uploadState?.status === 'failed' && (
          <p className="notice notice-error media-notice" role="alert">
            <IconAlert size={16} />
            <span className="notice-body">{mediaUploadFailureMessage(uploadState.failureCode)}</span>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                setTrackedUpload(null)
                setUploadState(null)
                setPollExhausted(false)
                setUploadOpen(true)
              }}
            >
              Choose the file again
            </button>
          </p>
        )}

        {refreshError && (
          <p className="notice notice-error media-notice" role="alert">
            <span className="notice-body">{refreshError}</span>
          </p>
        )}
        {hasCurrentPlacement && !selected && !currentAsset && (
          <p className="notice notice-info media-notice" role="status">
            <span className="notice-body">
              {refreshing
                ? mode === 'site-logo'
                  ? 'Finding the current site logo…'
                  : 'Finding the current image…'
                : mode === 'site-logo'
                  ? 'The current logo is not available in this library. Choose another logo, or cancel to keep it unchanged.'
                  : 'The current image is not available in this library. Choose a replacement deliberately, or cancel to keep it unchanged.'}
            </span>
          </p>
        )}
        <div className="media-picker-tools">
          <div className="media-search">
            <IconSearch size={16} />
            <label className="sr-only" htmlFor={`${headingId}-search`}>
              Search images
            </label>
            <input
              id={`${headingId}-search`}
              type="search"
              autoFocus
              placeholder="Search images"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <div className="media-density" role="group" aria-label="Library view">
            <button
              type="button"
              className="small secondary"
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
            >
              Grid
            </button>
            <button
              type="button"
              className="small secondary"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              List
            </button>
          </div>
          <button
            type="button"
            className="secondary small"
            disabled={refreshing}
            onClick={() => setRefreshCycle(value => value + 1)}
          >
            {refreshing ? 'Refreshing…' : 'Refresh library'}
          </button>
          <span className="media-result-count" role="status">
            {visible.length} shown
          </span>
        </div>

        <div className="media-picker-body">
          <div
            className={`media-picker-assets is-${view} ${mediaUi.gallery}`}
            data-view={view}
            data-compact="true"
            role="listbox"
            aria-label="Available images"
          >
            {visible.length === 0 ? (
              <div className="media-empty compact" role={refreshing ? 'status' : undefined}>
                <IconSearch size={22} />
                <h3>
                  {refreshError
                    ? 'Images unavailable'
                    : refreshing
                      ? 'Loading images…'
                      : search.trim()
                        ? 'No images match'
                        : 'No images yet'}
                </h3>
                <p>
                  {refreshError
                    ? 'Use Refresh library above to try again.'
                    : refreshing
                      ? 'Checking the images available to this site.'
                      : search.trim()
                        ? 'Try another search.'
                        : 'Use Upload above to add the first image to this site.'}
                </p>
              </div>
            ) : (
              visible.map((asset, index) => (
                <button
                  id={`picker-media-${asset.id}`}
                  key={asset.id}
                  type="button"
                  role="option"
                  aria-selected={selected?.id === asset.id}
                  className={'media-asset ' + mediaUi.asset}
                  onClick={() => select(asset)}
                  onKeyDown={event => {
                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                      event.preventDefault()
                      move(index, 1)
                    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      move(index, -1)
                    }
                  }}
                >
                  <MediaThumbnail readyOnly lazy asset={asset} />
                  <span className={'media-asset-copy ' + mediaUi.copy}>
                    <strong title={asset.name}>{asset.name}</strong>
                    <small>
                      {formatDimensions(asset)} · {formatBytes(asset.bytes)}
                    </small>
                    {asset.status !== 'ready' && (
                      <span className={`media-status status-${asset.status}`}>{mediaStatusLabel(asset.status)}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>

          <aside className="media-picker-choice" aria-label="Selection options">
            {selected ? (
              <>
                <div className="media-picker-preview">
                  <MediaThumbnail readyOnly asset={selected} />
                </div>
                <div>
                  <p className="eyebrow">Selected</p>
                  <h3>{selected.name}</h3>
                  <p>
                    {formatDimensions(selected)} · {formatBytes(selected.bytes)}
                  </p>
                </div>

                {!verifiedIds.has(selected.id) && (
                  <p className="hint" role="status">
                    {refreshing
                      ? 'Checking this image’s current availability…'
                      : 'Refresh the library to verify this image before using it.'}
                  </p>
                )}
                {selected.status !== 'ready' ? (
                  <p className="media-inline-error">
                    <IconAlert size={16} />
                    <span>
                      This image is {mediaStatusLabel(selected.status).toLocaleLowerCase()} and cannot be placed yet.
                    </span>
                  </p>
                ) : mode === 'placement' ? (
                  <fieldset className="media-purpose media-picker-purpose">
                    <legend>In this use, the image…</legend>
                    <label className="media-choice">
                      <input
                        type="radio"
                        name="picker-purpose"
                        checked={!decorative}
                        onChange={() => setDecorative(false)}
                      />
                      <span>
                        <strong>Communicates information</strong>
                        <small>Announce a useful description.</small>
                      </span>
                    </label>
                    {!requireDescription && (
                      <label className="media-choice">
                        <input
                          type="radio"
                          name="picker-purpose"
                          checked={decorative}
                          onChange={() => {
                            setDecorative(true)
                            setAltText('')
                          }}
                        />
                        <span>
                          <strong>Is decorative</strong>
                          <small>People using screen readers can skip it.</small>
                        </span>
                      </label>
                    )}
                  </fieldset>
                ) : (
                  <p className="hint">
                    {mode === 'site-logo'
                      ? 'The logo description is set in Header & menu. Image descriptions in the library stay unchanged.'
                      : 'Each destination keeps its current description. Review those descriptions before publishing the replacement.'}
                  </p>
                )}

                {mode === 'placement' && selected.status === 'ready' && !decorative && (
                  <div className="field">
                    <label htmlFor={`${headingId}-alt`}>Image description</label>
                    <input
                      id={`${headingId}-alt`}
                      value={altText}
                      maxLength={requireDescription ? 1000 : undefined}
                      required={requireDescription}
                      onChange={event => setAltText(event.target.value)}
                    />
                    <p className="hint">Describe what matters in this use, not every visual detail.</p>
                  </div>
                )}
                {selected.status === 'ready' && !selected.deliveryUrl && (
                  <p className="media-delivery-note">
                    <IconAlert size={15} />
                    <span>This image has a private preview but is not ready to use on the site.</span>
                  </p>
                )}
              </>
            ) : (
              <div className="media-detail-empty">
                <IconImage size={25} />
                <p>Select an image to continue.</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </Dialog>
  )
}
