import type { MouseEventHandler } from 'react'
import { Button } from '../../../../components/ui/index.ts'
import styles from './lists.module.css'

/** The list's draft, review and publication controls below the item records. */
export function CollectionPublishingStatus({
  entryEdits,
  entriesNeedResave,
  changes,
  pending,
  canEdit,
  canPublish,
  hasOpenReview,
  saveReady,
  submitReady,
  publishReady,
  onSave,
  onSubmit,
  onReview,
}: {
  entryEdits: boolean
  entriesNeedResave: boolean
  changes: number
  pending: boolean
  canEdit: boolean
  canPublish: boolean
  hasOpenReview: boolean
  saveReady: boolean
  submitReady: boolean
  publishReady: boolean
  onSave: () => void
  onSubmit: () => void
  onReview: MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <>
      <span>
        <strong>
          {entryEdits
            ? 'Unsaved changes'
            : entriesNeedResave
              ? 'Apply saved field changes'
              : changes + ' ' + (changes === 1 ? 'change' : 'changes') + ' not live'}
        </strong>
        <small>
          {entryEdits
            ? 'Save your draft before publishing.'
            : entriesNeedResave
              ? 'The saved list fields need applying to item drafts.'
              : 'Visitors see the published list.'}
        </small>
      </span>
      <div className={styles.actions}>
        {canEdit && (
          <Button variant="secondary" disabled={!saveReady} loading={pending} onClick={onSave}>
            Save draft
          </Button>
        )}
        {canEdit && (
          <Button variant={canPublish ? 'secondary' : 'primary'} disabled={!submitReady} onClick={onSubmit}>
            {hasOpenReview ? 'Waiting for review' : 'Submit for review'}
          </Button>
        )}
        {canPublish && (
          <>
            <Button variant="secondary" disabled={!publishReady} onClick={onReview}>
              Review
            </Button>
            <Button variant="publish" disabled={!publishReady} onClick={onReview}>
              Publish list
            </Button>
          </>
        )}
      </div>
    </>
  )
}
