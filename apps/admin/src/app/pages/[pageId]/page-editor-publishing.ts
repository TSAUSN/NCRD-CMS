import { visitorPreview } from './visitor-preview.ts'
import { publicationCommands } from './publication-commands.ts'
import { savedReviewCommands } from './saved-review-commands.ts'
import { carriesTrustedCode, isDirty } from '@cms/domain'
import { approveTrustedCode } from '../../actions/section-definitions.ts'
import { hasTrustedSectionTemplate } from '../../../lib/section-version.ts'
import type { PageEditorSession } from './use-page-editor-session.ts'
export function pageEditorPublishing(session: PageEditorSession) {
  const { props, state, dirty, savedVersionId, result, setResult } = session.draft
  const { router, draft, reviewState } = session
  const { sitePreview } = session.view
  const { previewHidden } = session.viewportState
  const { needsRender, canvasRefreshBlocked } = session.canvasSession.document
  const { isolatedCurrent, changeSitePreview } = session.canvasSession.interaction
  const { renderCanvas } = session.canvasBridge
  const { slotsByDef } = session.catalog
  const { save, latestSave, flushForReview } = session.saveSession
  const { withCanvasValues, setCheckpointing } = session.persistence
  const { publishedVersionId, approvedVersionId, setApprovedVersionId } = session.reviewState.publication
  const { review } = session.reviewState.review
  const { transitionPending, startTransition } = session.reviewState.transition
  const { scheduleFlight, scheduleRequest, setScheduling, setScheduleFirstReview } = session.scheduling
  const storedDraft = { ...draft, flushForReview, renderCanvas, latestSave }
  const { openPagePublishReview, confirmPagePublishReview, schedulePageReview } = savedReviewCommands({
    draft: { ...draft, startTransition },
    review: { ...reviewState.review, transitionPending, flushForReview, publish: () => publish() },
    schedule: { scheduleFlight, setScheduling, setScheduleFirstReview, scheduleRequest, router },
  })
  const { publish, submitForReview } = publicationCommands({
    draft: { ...draft, startTransition },
    publishState: { ...storedDraft, ...reviewState.publication, ...reviewState.review },
    canvas: { isolatedCurrent, canvasRefreshBlocked, needsRender, renderCanvas, changeSitePreview },
  })
  const readiness = result?.ok === false && result.kind === 'blocked' ? result.report : props.initialReadiness

  // The warning follows the document on screen. Save and publish verify
  // trusted code again on the server.
  const needsReview =
    carriesTrustedCode(state.document) || hasTrustedSectionTemplate(state.document.sections, slotsByDef)
  const approved = !dirty && approvedVersionId !== null && approvedVersionId === savedVersionId.current
  const hasWorkNotLive = dirty || savedVersionId.current !== publishedVersionId
  const submittedCurrent = review !== null && review.versionId === savedVersionId.current && !dirty
  const openVisitorPreview = visitorPreview({
    props,
    draft: storedDraft,
    canvas: { isolatedCurrent, canvasRefreshBlocked },
    view: { sitePreview, previewHidden },
  })
  function checkpoint() {
    // Like Publish, clear the last notice so the one that follows
    // is this save's, not an earlier one still on screen.
    setResult(null)
    setCheckpointing(true)
    void withCanvasValues(async () => {
      await latestSave.current('checkpoint')
    }).finally(() => setCheckpointing(false))
  }
  function approveCode() {
    // Approval is of a *stored* version, so anything unsaved is
    // saved first — approving a version that does not yet
    // contain the code somebody is looking at is exactly the
    // review that means nothing.
    startTransition(async () => {
      if (isDirty(state)) {
        if (!(await save('checkpoint'))) return
      }
      const id = savedVersionId.current
      if (!id) return
      const outcome = await approveTrustedCode(id)
      setResult(outcome)
      if (outcome.ok) setApprovedVersionId(id)
    })
  }
  return {
    storedDraft,
    openPagePublishReview,
    confirmPagePublishReview,
    schedulePageReview,
    publish,
    submitForReview,
    readiness,
    needsReview,
    approved,
    hasWorkNotLive,
    submittedCurrent,
    openVisitorPreview,
    checkpoint,
    approveCode,
  }
}
