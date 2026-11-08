import { useEffect, useRef, useState, useTransition } from 'react'
import type { EditorSection } from '@cms/domain'
import { sampleFieldNames } from '@cms/schema'
import type { PageEditorProps } from './editor-types.ts'
import type { PagePublishReview, SampleConfirmation } from './editor-publish-dialogs.tsx'

/** Keep draft review and published version separate while a command runs. */
export function useEditorReviewState(
  props: Pick<
    PageEditorProps,
    'publishedVersionId' | 'trustedCodeApproved' | 'previewVersionId' | 'openReview' | 'latestReviewFeedback'
  >,
  sections: EditorSection[],
  scheduleFlight: { current: boolean },
  setScheduling: (value: boolean) => void,
) {
  const [publishedVersionId, setPublishedVersionId] = useState(props.publishedVersionId)
  const [approvedVersionId, setApprovedVersionId] = useState(props.trustedCodeApproved ? props.previewVersionId : null)
  const [publishReviewOpen, setPublishReviewOpen] = useState(false)
  const reviewFlight = useRef(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [pageReview, setPageReview] = useState<PagePublishReview | null>(null)
  const [sampleConfirmation, setSampleConfirmation] = useState<SampleConfirmation | null>(null)
  const remainingSamples = sections
    .flatMap((section, index) =>
      section.hidden
        ? []
        : [{ section: section.label || `Section ${index + 1}`, fields: sampleFieldNames(section.values) }],
    )
    .filter(sample => sample.fields.length)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitNote, setSubmitNote] = useState('')
  const [review, setReview] = useState(props.openReview)
  const [reviewFeedback, setReviewFeedback] = useState(props.latestReviewFeedback)
  const [transitionPending, startTransition] = useTransition()
  useEffect(() => {
    if (!transitionPending) {
      if (!reviewFlight.current) setReviewBusy(false)
      if (!scheduleFlight.current) setScheduling(false)
    }
  }, [transitionPending])
  return {
    publication: {
      publishedVersionId,
      setPublishedVersionId,
      approvedVersionId,
      setApprovedVersionId,
      remainingSamples,
      sampleConfirmation,
      setSampleConfirmation,
    },
    review: {
      publishReviewOpen,
      setPublishReviewOpen,
      reviewFlight,
      reviewBusy,
      setReviewBusy,
      pageReview,
      setPageReview,
      review,
      setReview,
      reviewFeedback,
      setReviewFeedback,
    },
    override: { overrideOpen, setOverrideOpen, overrideReason, setOverrideReason },
    submission: { submitOpen, setSubmitOpen, submitNote, setSubmitNote },
    transition: { transitionPending, startTransition },
  }
}
