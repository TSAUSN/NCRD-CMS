'use client'

import { useId } from 'react'
import { Button, Dialog } from '../../../components/ui/index.ts'
import styles from './media-picker.module.css'
import { useMediaPicker, type MediaPickerProps } from './media-picker-state.ts'
import { MediaPickerUpload } from './media-picker-upload.tsx'
import { MediaPickerGallery, MediaPickerSearch } from './media-picker-gallery.tsx'
import { MediaPickerSelection } from './media-picker-selection.tsx'

/** Choose a ready asset and return an image placement for the caller's draft. */
export function MediaPicker(props: MediaPickerProps) {
  const headingId = useId()
  const picker = useMediaPicker(props)
  const { confirmLabel = 'Use this image' } = props
  const { dismiss, useImage, canUse, selected, mode, refreshError, hasCurrentPlacement, currentAsset, refreshing } =
    picker

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
        <MediaPickerUpload picker={picker} />
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

        <MediaPickerSearch picker={picker} headingId={headingId} />
        <div className="media-picker-body">
          <MediaPickerGallery picker={picker} />
          <MediaPickerSelection picker={picker} headingId={headingId} />
        </div>
      </div>
    </Dialog>
  )
}
