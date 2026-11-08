'use client'
import { Button } from '../../../../components/ui/index.ts'
import { IconAlert, IconInfo } from '../../../../components/icons.tsx'
import {
  mediaUploadFailureMessage,
  type MediaUploadIntentStatus,
  type MediaUploadReceipt,
} from '../../../../lib/media-library.ts'

type Props = {
  trackedUpload: MediaUploadReceipt | null
  uploadState: MediaUploadIntentStatus | null
  selectedId: string | null
  pollExhausted: boolean
  error: string | null
  retrying: boolean
  checkStatus: () => void
  chooseFileAgain: () => void
  retryLibrary: (() => void) | undefined
  dismissError: () => void
}

/** Show progress or a recovery action beside the library that owns it. */
export function MediaNotices({
  trackedUpload,
  uploadState,
  selectedId,
  pollExhausted,
  error,
  retrying,
  checkStatus,
  chooseFileAgain,
  retryLibrary,
  dismissError,
}: Props) {
  return (
    <>
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
            <Button variant="secondary" type="button" className="secondary small" onClick={checkStatus}>
              Check status
            </Button>
          )}
        </p>
      )}
      {uploadState?.status === 'failed' && (
        <p className="notice notice-error media-notice" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{mediaUploadFailureMessage(uploadState.failureCode)}</span>
          <Button variant="secondary" type="button" className="secondary small" onClick={chooseFileAgain}>
            Choose the file again
          </Button>
        </p>
      )}
      {error && (
        <p className="notice notice-error media-notice" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{error}</span>
          {retryLibrary && (
            <Button
              variant="secondary"
              type="button"
              className="secondary small"
              disabled={retrying}
              onClick={retryLibrary}
            >
              Refresh library
            </Button>
          )}
          <Button
            variant="tertiary"
            type="button"
            className="icon-btn"
            aria-label="Dismiss error"
            onClick={dismissError}
          >
            ×
          </Button>
        </p>
      )}
    </>
  )
}
