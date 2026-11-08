import { useEffect, useRef, useState } from 'react'
import { STORY_DRAFT_GROUPS, type StoryDraftGroup } from '../../../../../lib/story-draft-recovery.ts'
import { MediaPicker } from '../../../../pages/[pageId]/media-picker.tsx'
import { Dialog, Disclosure, Field } from '../../../../../components/ui/index.ts'
import frame from '../../../../../components/content-editor.module.css'
import { Button } from '../../../../../components/ui/button.tsx'
import type { StoryEditInput } from '../../../../../lib/stories-edit.ts'
import styles from '../stories.module.css'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import type { StoryDraftModel } from './use-story-draft.ts'

export function StorySubmissionDialog({ model }: { model: StoryDraftModel }) {
  const {
    pending,
    notice,
    error,
    submission,
    submissionOpen,
    setSubmissionOpen,
    submissionNote,
    setSubmissionNote,
    submitForReview,
  } = model
  return (
    <>
      {submissionOpen && submission && (
        <Dialog
          title="Send story for review"
          size="large"
          pending={pending}
          onClose={() => {
            if (!pending) setSubmissionOpen(false)
          }}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setSubmissionOpen(false)}>
                Cancel
              </Button>
              <Button loading={pending} onClick={submitForReview}>
                Submit for review
              </Button>
            </>
          }
        >
          <p>{submission.presentation.summary}</p>
          <p>This sends only this saved story and its article to a reviewer. Nothing is published.</p>
          {!submission.hasDate && (
            <p>A story date is required before publication. You can return to the story to choose one.</p>
          )}
          <Disclosure title="What changed">
            <dl>
              {submission.presentation.cells.map((cell, index) => (
                <div key={index}>
                  <dt>{cell.label}</dt>
                  <dd>{cell.after}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
          <Field id="story-review-note" label="Note for the reviewer (optional)">
            <textarea
              maxLength={4096}
              rows={3}
              value={submissionNote}
              disabled={pending}
              onChange={event => setSubmissionNote(event.target.value)}
            />
          </Field>
          {notice && <p role={error ? 'alert' : 'status'}>{notice}</p>}
        </Dialog>
      )}
    </>
  )
}

export function SavedStoryPreview({ model }: { model: StoryDraftModel }) {
  const { previewOpen, setPreviewOpen, previewLoaded, setPreviewLoaded, setRefresh, preview } = model
  const [width, setWidth] = useState(600)
  const area = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!area.current) return
    const observer = new ResizeObserver(records => setWidth(records[0]?.contentRect.width ?? 600))
    observer.observe(area.current)
    return () => observer.disconnect()
  }, [previewOpen])
  return (
    <>
      {previewOpen && (
        <Dialog
          title="Saved story preview"
          size="large"
          onClose={() => setPreviewOpen(false)}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setPreviewLoaded(false)
                  setRefresh(n => n + 1)
                }}
              >
                Refresh preview
              </Button>
              <Button onClick={() => setPreviewOpen(false)}>Done</Button>
            </>
          }
        >
          <p className={frame.help}>This private preview uses saved story and site drafts. Nothing is published.</p>
          {!previewLoaded && preview && <p role="status">Loading saved preview…</p>}
          <div
            className={styles.preview + ' ' + styles.previewArea}
            ref={area}
            style={{ height: 'var(--stories-preview-height)' }}
          >
            {preview ? (
              <iframe
                title="Saved story preview"
                src={preview}
                onLoad={() => setPreviewLoaded(true)}
                tabIndex={-1}
                style={{ width: 1440, height: 560 / (width / 1440), transform: 'scale(' + width / 1440 + ')' }}
              />
            ) : (
              <p role="status">The saved article preview is unavailable. Return to Stories and reopen this story.</p>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}

export function LeaveStoryDialog({ model }: { model: StoryDraftModel }) {
  const { pending, uncertain, notice, leaveOpen, error, finishLeave, cancelLeave, save } = model
  return (
    <>
      {leaveOpen && (
        <Dialog
          title="Before you leave"
          role="alertdialog"
          onClose={() => {
            if (!pending) cancelLeave()
          }}
          pending={pending}
          footer={
            <>
              <Button variant="secondary" onClick={cancelLeave} disabled={pending}>
                Keep editing
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => finishLeave()}>
                Discard changes
              </Button>
              <Button loading={pending} disabled={uncertain} onClick={() => save('leave')}>
                Save draft and leave
              </Button>
            </>
          }
        >
          <p>This story has unsaved changes. Save a draft before leaving, or discard the changes.</p>
          {error && notice && <p role="alert">{notice}</p>}
        </Dialog>
      )}
    </>
  )
}

export function StoryRecoveryDialog({ model }: { model: StoryDraftModel }) {
  const { catalog, value, recovery, recoveryOpen, setRecoveryOpen, choices, setChoices, acceptRecovery } = model
  const describeGroup = (draft: StoryEditInput, id: StoryDraftGroup) => {
    const group = STORY_DRAFT_GROUPS.find(group => group.id === id)!
    return (
      group.fields
        .map(field => {
          const item = draft[field]
          if (field === 'body_is_sample') return item ? 'Marked as sample content' : ''
          if (field === 'photo') return draft.photo ? draft.photo.description : 'No photo'
          if (Array.isArray(item))
            return item
              .map(id => [...catalog.mainTags, ...catalog.secondaryTags].find(tag => tag.id === id)?.label ?? id)
              .join(', ')
          return field === 'body'
            ? (new DOMParser().parseFromString(String(item ?? ''), 'text/html').body.textContent ?? '')
            : String(item ?? '')
        })
        .filter(Boolean)
        .join(' · ') || 'Empty'
    )
  }
  return (
    <>
      {recoveryOpen && recovery && (
        <Dialog
          title="Review saved story changes"
          onClose={() => setRecoveryOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRecoveryOpen(false)}>
                Cancel
              </Button>
              <Button disabled={recovery.conflicts.some(id => !choices[id])} onClick={acceptRecovery}>
                Keep selected changes
              </Button>
            </>
          }
        >
          <p>
            Your unsaved words are kept. Changes to different fields are combined. Nothing is saved or published until
            you choose Save draft.
          </p>
          {recovery.conflicts.length === 0 ? (
            <p>The saved changes affect different fields. You can keep both sets of changes.</p>
          ) : (
            recovery.conflicts.map(id => (
              <fieldset key={id} className={workspaceFormsStyles.formChoices}>
                <legend>{STORY_DRAFT_GROUPS.find(group => group.id === id)!.label}: both versions changed</legend>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name={'recover-' + id}
                    checked={choices[id] === 'mine'}
                    onChange={() => setChoices(current => ({ ...current, [id]: 'mine' }))}
                  />
                  Keep my {STORY_DRAFT_GROUPS.find(group => group.id === id)!.label.toLowerCase()}
                </label>
                <Disclosure title="My changes">
                  <p className={frame.help}>{describeGroup(value, id)}</p>
                  {id === 'photo' && value.photo && (
                    <img
                      className={frame.image}
                      src={'/media/' + value.photo.id + '/wide'}
                      alt={value.photo.description}
                    />
                  )}
                </Disclosure>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name={'recover-' + id}
                    checked={choices[id] === 'saved'}
                    onChange={() => setChoices(current => ({ ...current, [id]: 'saved' }))}
                  />
                  Use saved {STORY_DRAFT_GROUPS.find(group => group.id === id)!.label.toLowerCase()}
                </label>
                <Disclosure title="Saved changes">
                  <p className={frame.help}>{describeGroup(recovery.saved, id)}</p>
                  {id === 'photo' && recovery.saved.photo && (
                    <img
                      className={frame.image}
                      src={'/media/' + recovery.saved.photo.id + '/wide'}
                      alt={recovery.saved.photo.description}
                    />
                  )}
                </Disclosure>
              </fieldset>
            ))
          )}
        </Dialog>
      )}
    </>
  )
}

export function StoryPhotoPicker({ model }: { model: StoryDraftModel }) {
  const { site, value, photoOpen, setPhotoOpen, change } = model
  return (
    <>
      {photoOpen && (
        <MediaPicker
          requireDescription
          siteId={site.id}
          initialAssets={[]}
          currentValue={
            value.photo
              ? {
                  media_id: value.photo.id,
                  src: '/media/' + value.photo.id + '/wide',
                  alt: value.photo.description,
                  decorative: false,
                  focal: value.photo.focus,
                }
              : undefined
          }
          onClose={() => setPhotoOpen(false)}
          onChoose={photo => {
            if (photo.media_id)
              change('photo', { id: photo.media_id, description: photo.alt, focus: photo.focal ?? null })
            setPhotoOpen(false)
          }}
        />
      )}
    </>
  )
}
