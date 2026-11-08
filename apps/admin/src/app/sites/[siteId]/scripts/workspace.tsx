'use client'

import { Button, StatusPill } from '../../../../components/ui/index.ts'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import styles from './files.module.css'
import { useSiteFiles, type SiteFilesProps } from './use-site-files.ts'
import { SiteFileUpload } from './site-file-upload.tsx'
import { SiteFileLoading } from './site-file-loading.tsx'
import { OriginalDesignFiles } from './original-design-files.tsx'
import { SiteFileHistory } from './site-file-history.tsx'
import { SiteFileReview } from './site-file-review.tsx'

export function SiteFilesWorkspace(props: SiteFilesProps) {
  const model = useSiteFiles(props)
  const { savedVersion, notice, review, alert, dirty, busy, setBundle, baseline, setNotice, beginReview } = model
  return (
    <div className={styles.workspace}>
      <div className={styles.heading}>
        <div>
          <StatusPill
            status={
              props.publishedVersionId
                ? savedVersion === props.publishedVersionId
                  ? 'Live'
                  : 'Live · changes not published'
                : 'Draft'
            }
          />
          <p>
            {dirty
              ? 'File choices have not been reviewed yet.'
              : 'Every reviewed version is retained. Saving a review keeps it private until you publish.'}
          </p>
        </div>
        <div className={styles.actions}>
          {dirty ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setBundle(structuredClone(baseline))
                  setNotice(null)
                }}
              >
                Discard file choices
              </Button>
              <Button disabled={busy || props.archived} onClick={beginReview}>
                Review file changes
              </Button>
            </>
          ) : savedVersion !== props.publishedVersionId && savedVersion ? (
            <Link className="btn publish" href={'/sites/' + props.siteId + '/publishing?area=site-look'}>
              Review publication
            </Link>
          ) : null}
        </div>
      </div>
      {notice && !review && (
        <p
          ref={alert}
          tabIndex={notice.error ? -1 : undefined}
          role={notice.error ? 'alert' : 'status'}
          className={notice.error ? styles.error : styles.success}
        >
          {notice.text}
        </p>
      )}

      <SiteFileUpload model={model} props={props} />
      <SiteFileLoading model={model} props={props} />
      <OriginalDesignFiles model={model} props={props} />
      <SiteFileHistory model={model} props={props} />
      {review && <SiteFileReview model={model} props={props} />}
    </div>
  )
}
