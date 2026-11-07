import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import type { EditorDocument, EditorState } from '@cms/domain'
import { ConfirmDialog, ReasonDialog } from '../../../components/confirm.tsx'
import type { ActionResult } from '../../../lib/action-result.ts'
import { EditorPublishDialogs } from './editor-publish-dialogs.tsx'
import { EditorRestoreDialogs } from './editor-live-restore.tsx'
import { EditorSectionUpdateDialogs } from './editor-section-update-dialogs.tsx'
import { InlineListDrawer } from './inline-list-drawer.tsx'
import type { PageEditorProps } from './editor-types.ts'

type Setter<T> = Dispatch<SetStateAction<T>>
type Current<T> = { current: T }
type PageDanger = 'archive' | 'unpublish' | null
type InlineList = { readerKey: string; stableKey?: string; unit: string } | null
type Inputs = {
  props: Pick<PageEditorProps, 'pageId' | 'mediaAssets'>
  transitionPending: boolean
  danger: {
    pageDanger: PageDanger
    setPageDanger: Setter<PageDanger>
    setPageSettingsOpen: Setter<boolean>
    applyPageDanger: () => void | Promise<void>
  }
  publication: ComponentProps<typeof EditorPublishDialogs>
  restoration: ComponentProps<typeof EditorRestoreDialogs>
  sectionChanges: ComponentProps<typeof EditorSectionUpdateDialogs>
  lists: {
    inlineList: InlineList
    setInlineList: Setter<InlineList>
    renderCanvas: (snapshot: EditorDocument) => void
    currentEditor: Current<EditorState>
    savedVersionId: Current<string | null>
    revision: number
    setResult: Setter<ActionResult | null>
  }
  submission: {
    submitOpen: boolean
    setSubmitOpen: Setter<boolean>
    submitNote: string
    setSubmitNote: Setter<string>
    submitForReview: (note: string) => void
  }
}

/** Keep the editor's confirmation dialogs together in their focus order. */
export function EditorDialogs({
  props,
  transitionPending,
  danger,
  publication,
  restoration,
  sectionChanges,
  lists,
  submission,
}: Inputs) {
  const { pageDanger, setPageDanger, setPageSettingsOpen, applyPageDanger } = danger
  const { inlineList, setInlineList, renderCanvas, currentEditor, savedVersionId, revision, setResult } = lists
  const { submitOpen, setSubmitOpen, submitNote, setSubmitNote, submitForReview } = submission
  return (
    <>
      {pageDanger && (
        <ConfirmDialog
          title={pageDanger === 'archive' ? 'Archive this page?' : 'Unpublish this page?'}
          what={
            pageDanger === 'archive'
              ? 'This page will be removed from the live site and active Pages list.'
              : 'This page will be removed from the live site.'
          }
          reassurance="Its draft and history are kept. You can restore it later."
          confirmLabel={pageDanger === 'archive' ? 'Archive page' : 'Unpublish page'}
          pending={transitionPending}
          onCancel={() => {
            setPageDanger(null)
            setPageSettingsOpen(true)
          }}
          onConfirm={() => void applyPageDanger()}
        />
      )}
      <EditorPublishDialogs {...publication} />
      <EditorRestoreDialogs {...restoration} />
      {inlineList && (
        <InlineListDrawer
          pageId={props.pageId}
          readerKey={inlineList.readerKey}
          stableKey={inlineList.stableKey}
          unit={inlineList.unit}
          media={props.mediaAssets}
          onClose={() => setInlineList(null)}
          onSaved={() => {
            setInlineList(null)
            renderCanvas(currentEditor.current.saved)
            setResult({
              ok: true,
              revision,
              versionId: savedVersionId.current,
              message: 'List draft saved. Publish the list when it is ready for visitors.',
            })
          }}
        />
      )}
      <EditorSectionUpdateDialogs {...sectionChanges} />

      {submitOpen && (
        <ReasonDialog
          pending={transitionPending}
          title="Submit this page for review?"
          explanation="The reviewer will see the exact saved version on your screen. The live page will not change until they approve it. A note is helpful, but optional."
          label="Note for the reviewer"
          value={submitNote}
          confirmLabel="Submit for review"
          required={false}
          onChange={setSubmitNote}
          onCancel={() => {
            setSubmitOpen(false)
            setSubmitNote('')
          }}
          onConfirm={() => {
            const note = submitNote.trim()
            setSubmitOpen(false)
            setSubmitNote('')
            submitForReview(note)
          }}
        />
      )}
    </>
  )
}
