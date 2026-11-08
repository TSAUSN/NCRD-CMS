import { EditorDialogs } from './editor-dialogs.tsx'
import type { PageEditorScreenProps } from './page-editor-screen.tsx'
export function PageEditorOverlays({ session, commands }: PageEditorScreenProps) {
  const { props, setState } = session.draft
  const { restore, sectionUpdates, reviewState } = session
  const { setPageSettingsOpen, setPane } = session.selection
  const { nameOf } = session.catalog
  const { transitionPending } = session.reviewState.transition
  const { pageDanger, setPageDanger } = session.pageActions
  const { inlineList, setInlineList } = session.list
  const { setLiveSourceIndex } = session.restore
  const { storedDraft, confirmPagePublishReview, schedulePageReview, publish, submitForReview } = commands.publishing
  const { applyLiveReset, applyPageDanger, applyReviewedUpgrade, applyFieldUpdate } = commands
  const { reviewLayoutChange, applyLayoutChange, remapReplacement } = commands.layoutActions
  return (
    <>
      <EditorDialogs
        props={props}
        transitionPending={transitionPending}
        danger={{ pageDanger, setPageDanger, setPageSettingsOpen, applyPageDanger }}
        publication={{
          ...reviewState.publication,
          ...reviewState.review,
          ...reviewState.override,
          props,
          schedulePageReview,
          confirmPagePublishReview,
          setState,
          setPane,
          publish,
          transitionPending,
        }}
        restoration={{ props, restore, applyLiveReset, setLiveSourceIndex, setState, nameOf }}
        lists={{ ...storedDraft, inlineList, setInlineList }}
        sectionChanges={{
          state: sectionUpdates,
          actions: { applyReviewedUpgrade, applyFieldUpdate },
          layout: { reviewLayoutChange, applyLayoutChange, remapReplacement },
        }}
        submission={{ ...reviewState.submission, submitForReview }}
      />
    </>
  )
}
