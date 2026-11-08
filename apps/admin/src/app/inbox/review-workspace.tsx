'use client'

import { useReviewModel, type ReviewWorkspaceProps } from './use-review-model.ts'
import { ReviewDecisionDialogs } from './review-decision-dialogs.tsx'
import { ReviewWorkbench } from './review-workbench.tsx'
import { EmbeddedReviewWorkspace } from './embedded-review-workspace.tsx'

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  const model = useReviewModel(props)
  const dialogs = <ReviewDecisionDialogs model={model} />
  return props.fullScreen ? (
    <ReviewWorkbench model={model} dialogs={dialogs} />
  ) : (
    <EmbeddedReviewWorkspace model={model} dialogs={dialogs} />
  )
}
