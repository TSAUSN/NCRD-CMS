'use client'

import { ContentEditor } from '../../../../../components/content-editor.tsx'
import { useStoryDraft, type StoryEditorProps } from './use-story-draft.ts'
import { StoryContentFields } from './story-content-fields.tsx'
import { StorySettings } from './story-settings.tsx'
import { StoryEditorActions, StoryEditorNotice } from './story-editor-feedback.tsx'
import {
  StorySubmissionDialog,
  SavedStoryPreview,
  LeaveStoryDialog,
  StoryRecoveryDialog,
  StoryPhotoPicker,
} from './story-editor-dialogs.tsx'

export function StoryEditor(props: StoryEditorProps) {
  const model = useStoryDraft(props)
  const { site, value, pending, dirty, newDraft, savedEditor, back, notice, firstSiteReview } = model
  return (
    <>
      <ContentEditor
        locationLabel={site.name + ' / Stories'}
        title={value.title || (newDraft ? 'New story' : 'Untitled story')}
        status={
          pending
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes'
              : newDraft && !savedEditor
                ? 'Not saved yet'
                : 'All changes saved'
        }
        pending={pending}
        onBack={back}
        actions={<StoryEditorActions model={model} />}
        notice={notice || firstSiteReview ? <StoryEditorNotice model={model} /> : undefined}
        aside={<StorySettings model={model} />}
      >
        <StoryContentFields model={model} />
      </ContentEditor>
      <StorySubmissionDialog model={model} />
      <SavedStoryPreview model={model} />
      <LeaveStoryDialog model={model} />
      <StoryRecoveryDialog model={model} />
      <StoryPhotoPicker model={model} />
    </>
  )
}
