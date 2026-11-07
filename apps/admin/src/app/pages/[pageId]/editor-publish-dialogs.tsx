import type { Dispatch, SetStateAction } from 'react'
import { setSelection, type EditorState } from '@cms/domain'
import { Button, Dialog } from '../../../components/ui/index.ts'
import { ReasonDialog } from '../../../components/confirm.tsx'
import type { ReleasePresentation } from '../../../lib/release-copy.ts'
import type { EditorPane, PageEditorProps } from './editor-types.ts'

type Set<T> = Dispatch<SetStateAction<T>>

export type PagePublishReview = {
  title: string
  revision: string
  versionId: string
  presentation: ReleasePresentation
}

export type SampleConfirmation = {
  overrideReason?: string
  together: boolean
  siteWide: boolean
}

type Props = {
  props: Pick<PageEditorProps, 'canPublish' | 'siteName'>
  publishReviewOpen: boolean
  pageReview: PagePublishReview | null
  setPublishReviewOpen: Set<boolean>
  schedulePageReview: () => void
  confirmPagePublishReview: () => void
  setState: Set<EditorState>
  setPane: Set<EditorPane>
  remainingSamples: { section: string; fields: string[] }[]
  sampleConfirmation: SampleConfirmation | null
  setSampleConfirmation: Set<SampleConfirmation | null>
  publish: (reason?: string, together?: boolean, siteWide?: boolean, samplesConfirmed?: boolean) => void
  overrideOpen: boolean
  overrideReason: string
  setOverrideReason: Set<string>
  setOverrideOpen: Set<boolean>
  transitionPending: boolean
}

export function EditorPublishDialogs({
  props,
  publishReviewOpen,
  pageReview,
  setPublishReviewOpen,
  schedulePageReview,
  confirmPagePublishReview,
  setState,
  setPane,
  remainingSamples,
  sampleConfirmation,
  setSampleConfirmation,
  publish,
  overrideOpen,
  overrideReason,
  setOverrideReason,
  setOverrideOpen,
  transitionPending,
}: Props) {
  return (
    <>
      {publishReviewOpen && pageReview && props.canPublish && (
        <Dialog
          title="Publish this page"
          size="medium"
          pending={transitionPending}
          onClose={() => setPublishReviewOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPublishReviewOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setPublishReviewOpen(false)
                  schedulePageReview()
                }}
              >
                Schedule instead
              </Button>
              <Button variant="publish" onClick={confirmPagePublishReview}>
                Publish
              </Button>
            </>
          }
        >
          <p>
            <strong>{pageReview.title}</strong> · {props.siteName}
          </p>
          <p>What changed since it was last published</p>
          {pageReview.presentation.changes?.length ? (
            <ul>
              {pageReview.presentation.changes.map((change, index) => (
                <li key={index}>
                  {change.text}
                  {change.sectionIndex !== undefined && (
                    <Button
                      variant="tertiary"
                      size="s"
                      onClick={() => {
                        setPublishReviewOpen(false)
                        setState(current => setSelection(current, { section: change.sectionIndex!, slot: null }))
                        setPane('inspector')
                      }}
                    >
                      Show
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No page changes.</p>
          )}
          {remainingSamples.length > 0 && (
            <p>This page still contains sample content. You will review it before publishing.</p>
          )}
          <p>The menu and footer aren't part of this. They have their own publish.</p>
          <p>Visitors will see these changes after you confirm.</p>
        </Dialog>
      )}
      {sampleConfirmation && (
        <Dialog
          title="Publish with sample content?"
          onClose={() => setSampleConfirmation(null)}
          pending={transitionPending}
        >
          <p>These sections still contain the examples that came with them. Visitors will see them.</p>
          <ul>
            {remainingSamples.map((sample, index) => (
              <li key={index}>
                {sample.section} · {sample.fields.length}{' '}
                {sample.fields.length === 1 ? 'sample field' : 'sample fields'}
              </li>
            ))}
          </ul>
          <div className="actions">
            <Button variant="secondary" onClick={() => setSampleConfirmation(null)}>
              Keep editing
            </Button>
            <Button
              variant="publish"
              onClick={() => {
                const choice = sampleConfirmation
                setSampleConfirmation(null)
                publish(choice.overrideReason, choice.together, choice.siteWide, true)
              }}
            >
              Publish with sample content
            </Button>
          </div>
        </Dialog>
      )}
      {overrideOpen && (
        <ReasonDialog
          pending={transitionPending}
          title="Publish despite the readiness warning?"
          explanation="This exception is recorded with the version that goes live. Explain why publishing now is the right decision."
          label="Reason for publishing"
          value={overrideReason}
          confirmLabel="Publish and record reason"
          onChange={setOverrideReason}
          onCancel={() => {
            setOverrideOpen(false)
            setOverrideReason('')
          }}
          onConfirm={() => {
            const reason = overrideReason.trim()
            if (!reason) return
            setOverrideOpen(false)
            setOverrideReason('')
            publish(reason)
          }}
        />
      )}
    </>
  )
}
