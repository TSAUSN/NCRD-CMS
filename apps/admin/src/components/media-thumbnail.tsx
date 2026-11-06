'use client'
import { useState } from 'react'
import styles from './media-ui.module.css'
import { IconImage } from './icons.tsx'
import type { MediaAsset } from '../lib/media-library.ts'
/** One thumbnail and failed-preview treatment in workspaces and image pickers. */
export function MediaThumbnail({
  asset,
  large = false,
  readyOnly = false,
}: {
  asset: MediaAsset
  large?: boolean
  readyOnly?: boolean
}) {
  const [failedPreview, setFailedPreview] = useState<string | null>(null)
  const preview =
    asset.status !== 'deleted' && (!readyOnly || asset.status === 'ready') && asset.previewUrl !== failedPreview
      ? asset.previewUrl
      : null
  const processing = asset.status === 'processing'
  return (
    <span
      className={`media-thumb ${styles.thumbnail} ${preview ? '' : 'media-thumb-fallback'} ${large ? 'is-large' : ''}`}
      role={preview ? undefined : 'img'}
      aria-label={preview ? undefined : processing ? 'Image preview processing' : 'Image preview unavailable'}
    >
      {preview ? (
        <img src={preview} alt="" onError={() => setFailedPreview(preview)} />
      ) : processing ? (
        <span className="media-spinner" aria-hidden="true" />
      ) : (
        <IconImage size={large ? 30 : 24} />
      )}
    </span>
  )
}
