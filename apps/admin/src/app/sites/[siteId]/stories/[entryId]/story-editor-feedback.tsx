import { StatusPill } from '../../../../../components/ui/index.ts'
import { Button } from '../../../../../components/ui/button.tsx'
import styles from '../stories.module.css'
import type { StoryDraftModel } from './use-story-draft.ts'

export function StoryEditorActions({ model }: { model: StoryDraftModel }) {
  const { rights, publicationStatus, pending, uncertain, disabled, save } = model
  return (
    <>
      <>
        <StatusPill compact status={publicationStatus} />
        <Button variant="secondary" size="standard" disabled={pending || uncertain} onClick={() => save('preview')}>
          Preview
        </Button>
        {rights.editEntries && (
          <Button variant="secondary" size="standard" onClick={() => save()} disabled={disabled}>
            Save draft
          </Button>
        )}
        {rights.editEntries && !rights.publish && (
          <Button size="standard" disabled={disabled} onClick={() => save('review')}>
            Submit for review
          </Button>
        )}
        {rights.publish && (
          <>
            <Button variant="secondary" size="standard" disabled={disabled} onClick={() => save('schedule')}>
              Schedule
            </Button>
            <Button variant="publish" size="standard" disabled={disabled} onClick={() => save('publish')}>
              Publish
            </Button>
          </>
        )}
      </>
    </>
  )
}

export function StoryEditorNotice({ model }: { model: StoryDraftModel }) {
  const {
    site,
    newDraft,
    router,
    pending,
    uncertain,
    creationKind,
    notice,
    firstSiteReview,
    error,
    recovery,
    setRecoveryOpen,
    save,
  } = model
  return (
    <>
      {notice || firstSiteReview ? (
        <>
          {notice && (
            <p role={error ? 'alert' : 'status'} className={styles.status + (error ? ' ' + styles.error : '')}>
              {notice}
            </p>
          )}
          {!newDraft && error && !recovery && (
            <Button variant="secondary" disabled={pending} onClick={() => router.refresh()}>
              Check saved story
            </Button>
          )}
          {recovery && (
            <Button variant="secondary" disabled={pending} onClick={() => setRecoveryOpen(true)}>
              Review saved changes
            </Button>
          )}
          {uncertain && (
            <Button variant="secondary" loading={pending} onClick={() => save(creationKind.current)}>
              Retry draft save
            </Button>
          )}
          {firstSiteReview && (
            <Button variant="secondary" onClick={() => router.push('/sites/' + site.id + '/publishing?lists=1')}>
              Review first site publication
            </Button>
          )}
        </>
      ) : undefined}
    </>
  )
}
