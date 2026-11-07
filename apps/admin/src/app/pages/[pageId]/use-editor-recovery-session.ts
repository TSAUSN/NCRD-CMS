import { useState, type Dispatch, type SetStateAction } from 'react'
import { isDirty, type EditorState, type SaveQueue } from '@cms/domain'
import type { ActionResult } from '../../../lib/action-result.ts'
import { recoverDocument } from '../../../lib/page-recovery.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { PageEditorProps } from './editor-types.ts'
import type { SaveSnapshot } from './use-draft-save.ts'
import { usePageRecovery } from './use-page-recovery.ts'

type RecoveryDraft = {
  props: Pick<PageEditorProps, 'userId' | 'siteId' | 'pageId'>
  state: EditorState
  currentEditor: { current: EditorState }
  setState: Dispatch<SetStateAction<EditorState>>
  queue: { current: SaveQueue<SaveSnapshot> }
  savedVersionId: { current: string | null }
  revision: number
  result: ActionResult | null
}

type RecoveryBlockers = {
  saving: boolean
  transitionPending: boolean
  upgrade: object | null
  replacement: object | null
  overrideOpen: boolean
  submitOpen: boolean
}

/** Restore a journal only while the loaded draft and edit session are idle. */
export function useEditorRecoverySession(
  { props, state, currentEditor, setState, queue, savedVersionId, revision, result }: RecoveryDraft,
  { saving, transitionPending, upgrade, replacement, overrideOpen, submitOpen }: RecoveryBlockers,
  clearRichText: () => void,
) {
  const [recoveryDefinitions, setRecoveryDefinitions] = useState<LibraryEntry[]>([])
  const recovery = usePageRecovery({
    scope: { userId: props.userId, siteId: props.siteId, pageId: props.pageId },
    document: state.document,
    base: { versionId: savedVersionId.current, revision, document: state.saved },
    canApply: () =>
      !isDirty(currentEditor.current) &&
      !saving &&
      !queue.current.busy() &&
      !transitionPending &&
      upgrade === null &&
      replacement === null &&
      !overrideOpen &&
      !submitOpen &&
      !(result?.ok === false && result.kind === 'conflict'),
    onRecover: (document, definitions) => {
      setRecoveryDefinitions(current => [...current, ...definitions])
      clearRichText()
      setState(current => recoverDocument(current, document))
    },
  })
  return { recovery, recoveryDefinitions }
}
