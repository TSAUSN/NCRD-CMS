import { Button } from '../../../components/ui/index.ts'
import { IconAlert, IconPlus } from '../../../components/icons.tsx'
import { mediaUploadFailureMessage } from '../../../lib/media-library.ts'
import { MediaUploadPanel } from '../../sites/[siteId]/media/media-upload-panel.tsx'
import type { MediaPickerModel } from './media-picker-state.ts'
import styles from './media-picker.module.css'

export function MediaPickerUpload({ picker }: { picker: MediaPickerModel }) {
  const {
    mode,
    uploadOpen,
    toggleUpload,
    uploadLeave,
    trackUpload,
    siteId,
    closeUpload,
    trackedUpload,
    uploadState,
    pollExhausted,
    selectedId,
    checkUploadStatus,
    chooseFileAgain,
  } = picker
  return (
    <>
      <div className={styles.introduction}>
        <p>
          {mode === 'replacement'
            ? 'Choose a replacement, then review where to use it.'
            : mode === 'site-logo'
              ? 'Choose a site logo.'
              : 'Select an image, then confirm its description for this use.'}
        </p>
        <Button variant="secondary" aria-expanded={uploadOpen} onClick={toggleUpload}>
          <IconPlus size={16} /> Upload
        </Button>
      </div>
      {uploadOpen && (
        <div className="media-picker-upload">
          <MediaUploadPanel leaveRef={uploadLeave} siteId={siteId} onClose={closeUpload} onAccepted={trackUpload} />
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
            <button type="button" className="secondary small" onClick={checkUploadStatus}>
              Check status
            </button>
          )}
        </p>
      )}
      {uploadState?.status === 'failed' && (
        <p className="notice notice-error media-notice" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{mediaUploadFailureMessage(uploadState.failureCode)}</span>
          <button type="button" className="secondary small" onClick={chooseFileAgain}>
            Choose the file again
          </button>
        </p>
      )}
    </>
  )
}
