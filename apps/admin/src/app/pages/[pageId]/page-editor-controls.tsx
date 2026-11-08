import { EditorToolbar } from './editor-toolbar.tsx'
import { LargeScreenEditing } from '../../../components/content-editor.tsx'
import { PageRecoveryPanel } from './page-recovery-panel.tsx'
import { EditorNotices } from './editor-notices.tsx'
import type { PageEditorScreenProps } from './page-editor-screen.tsx'
import type { ReactNode } from 'react'
export function PageEditorControls({ session, commands, viewTools }: PageEditorScreenProps & { viewTools: ReactNode }) {
  const { props, state, dirty, result, setResult } = session.draft
  const { canManageSections } = session.sectionRules
  const { sitePreview } = session.view
  const { sectionTool } = session.sectionTools
  const { libraryPreview, libraryPreparing } = session.libraryState
  const { previewHidden, setPreviewHidden } = session.viewportState
  const { changeSitePreview } = session.canvasSession.interaction
  const { recovery, limitedHistory, saving, checkpointing, requiresReload } = session.persistence
  const { publishedVersionId } = session.reviewState.publication
  const { reviewBusy, review, reviewFeedback } = session.reviewState.review
  const { setOverrideOpen } = session.reviewState.override
  const { setSubmitOpen } = session.reviewState.submission
  const { transitionPending } = session.reviewState.transition
  const { scheduling, scheduleFirstReview } = session.scheduling
  const { setDiscardConfirmation } = session.restore
  const { siteWide } = session.siteFrame
  const {
    openPagePublishReview,
    schedulePageReview,
    needsReview,
    approved,
    hasWorkNotLive,
    submittedCurrent,
    openVisitorPreview,
    checkpoint,
    approveCode,
  } = commands.publishing
  const { openPageSettings, duplicateCurrentPage } = commands
  const pageTitle = state.document.identity?.title ?? props.title
  return (
    <>
      <EditorToolbar
        page={props}
        pageTitle={pageTitle}
        viewTools={viewTools}
        publication={{
          submittedCurrent,
          publishedVersionId,
          hasWorkNotLive,
          reviewId: review?.id,
          scheduling,
          reviewBusy,
        }}
        draft={{ saving, dirty, recovery, limitedHistory, requiresReload, checkpointing, transitionPending }}
        preview={{
          editingFrame: siteWide?.editing,
          previewBlocked: Boolean(sectionTool) || Boolean(libraryPreview) || libraryPreparing,
          canManageSections,
          sitePreview,
          previewHidden,
          changeSitePreview,
          setPreviewHidden,
          openVisitorPreview,
        }}
        commands={{
          checkpoint,
          duplicateCurrentPage,
          discardUnpublished: () => setDiscardConfirmation(true),
          openPageSettings,
          schedulePageReview,
          openPagePublishReview,
          submitForReview: () => setSubmitOpen(true),
        }}
      />

      <LargeScreenEditing>
        <PageRecoveryPanel recovery={recovery} />
      </LargeScreenEditing>

      <EditorNotices
        result={result}
        needsReview={needsReview}
        approved={approved}
        reviewFeedback={reviewFeedback}
        scheduleFirstReview={scheduleFirstReview}
        siteId={props.siteId}
        pageId={props.pageId}
        canPublish={props.canPublish}
        canApproveTrustedCode={props.canApproveTrustedCode}
        dismissResult={() => setResult(null)}
        confirmOverride={() => setOverrideOpen(true)}
        approveCode={approveCode}
      />
    </>
  )
}
