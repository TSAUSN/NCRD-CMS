'use client'

import { useState } from 'react'

import { useReviewModel, type ReviewWorkspaceProps } from './use-review-model.ts'
import { ReviewDecisionDialogs } from './review-decision-dialogs.tsx'
import { ReviewWorkbench } from './review-workbench.tsx'
import { EmbeddedReviewWorkspace } from './embedded-review-workspace.tsx'

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  // The queue can move to another request as a successful decision refreshes it.
  // Keep that decision receipt outside the selected request's editing state.
  const [receipt, setReceipt] = useState<string | null>(null)
  return <SelectedReview key={props.selected?.id ?? 'none'} props={props} receipt={receipt} setReceipt={setReceipt} />
}

function SelectedReview({
  props,
  receipt,
  setReceipt,
}: {
  props: ReviewWorkspaceProps
  receipt: string | null
  setReceipt: (message: string | null) => void
}) {
  const model = useReviewModel(props, props.fullScreen ? setReceipt : undefined)
  const dialogs = <ReviewDecisionDialogs model={model} />
  return props.fullScreen ? (
    <ReviewWorkbench model={model} dialogs={dialogs} receipt={receipt} />
  ) : (
    <EmbeddedReviewWorkspace model={model} dialogs={dialogs} />
  )
}
