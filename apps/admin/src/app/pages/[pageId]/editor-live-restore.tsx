import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  commitSaved,
  removeSection,
  replaceSection,
  type EditorDocument,
  type EditorSection,
  type EditorState,
  type SaveQueue,
} from '@cms/domain'
import { ConfirmDialog } from '../../../components/confirm.tsx'
import { Button, Dialog } from '../../../components/ui/index.ts'
import type { ActionResult } from '../../../lib/action-result.ts'
import { recoverDocument } from '../../../lib/page-recovery.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { PageEditorProps } from './editor-types.ts'
import { resetPageFromLive } from './live-reset-actions.ts'
import type { SaveSnapshot } from './use-draft-save.ts'

type Set<T> = Dispatch<SetStateAction<T>>
type Current<T> = { current: T }
type Confirmation = { origin: string; action: 'delete' | 'reset' } | null

type RestoreState = {
  sectionConfirmation: Confirmation
  setSectionConfirmation: Set<Confirmation>
  discardConfirmation: boolean
  setDiscardConfirmation: Set<boolean>
  resetting: boolean
  liveSourceIndex: number
}

type Inputs = {
  page: {
    props: Pick<PageEditorProps, 'pageId'>
    publishedVersionId: string | null
    currentEditor: Current<EditorState>
    queue: Current<SaveQueue<SaveSnapshot>>
    savedVersionId: Current<string | null>
    flushForReview: () => Promise<boolean>
  }
  acknowledge: {
    setReplacementDefinitions: Set<LibraryEntry[]>
    setState: Set<EditorState>
    setRevision: Set<number>
    setApprovedVersionId: Set<string | null>
    setReview: Set<PageEditorProps['openReview']>
    setResult: Set<ActionResult | null>
    renderCanvas: (snapshot: EditorDocument) => void
  }
  restore: Omit<RestoreState, 'discardConfirmation'> & { setResetting: Set<boolean> }
}

/** Restore the acknowledged draft against the exact published version. */
export function liveRestore({ page, acknowledge, restore }: Inputs) {
  const { props, publishedVersionId, currentEditor, queue, savedVersionId, flushForReview } = page
  const { setReplacementDefinitions, setState, setRevision, setApprovedVersionId, setReview, setResult, renderCanvas } =
    acknowledge
  const {
    sectionConfirmation,
    setSectionConfirmation,
    setDiscardConfirmation,
    resetting,
    setResetting,
    liveSourceIndex,
  } = restore
  async function applyLiveReset(wholePage: boolean) {
    if (!publishedVersionId || resetting) return
    setResetting(true)
    try {
      if (!(await flushForReview())) return
      const index = sectionConfirmation ? currentEditor.current.sectionOrigins.indexOf(sectionConfirmation.origin) : -1
      if (!wholePage && index < 0) return
      let restored: Awaited<ReturnType<typeof resetPageFromLive>> | undefined
      const outcome = await queue.current.enqueue({
        snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
        run: async expectedRevision => {
          restored = await resetPageFromLive({
            pageId: props.pageId,
            expectedRevision,
            expectedLiveVersionId: publishedVersionId,
            ...(wholePage ? {} : { sectionIndex: index, liveSectionIndex: liveSourceIndex }),
          })
          if (!restored.ok) {
            setResult(restored)
            return { ok: false, conflict: restored.kind === 'conflict' }
          }
          savedVersionId.current = restored.versionId
          return { ok: true, revision: restored.revision }
        },
      })
      if (outcome.status !== 'acknowledged' || !restored?.ok) return
      const definitions = restored.definitions
      setReplacementDefinitions(previous => [...previous, ...definitions])
      const next = wholePage
        ? recoverDocument(currentEditor.current, restored.document)
        : replaceSection(currentEditor.current, index, restored.document.sections[index]!)
      setState(commitSaved(next, restored.document))
      setRevision(outcome.revision)
      setApprovedVersionId(null)
      setReview(null)
      renderCanvas(restored.document)
      setResult(restored)
      setSectionConfirmation(null)
      setDiscardConfirmation(false)
    } finally {
      setResetting(false)
    }
  }
  return applyLiveReset
}

/** Confirm deleting a section or replacing unpublished work with live content. */
export function EditorRestoreDialogs({
  props,
  restore,
  applyLiveReset,
  setLiveSourceIndex,
  setState,
  nameOf,
}: {
  props: Pick<PageEditorProps, 'liveSections'>
  restore: RestoreState
  applyLiveReset: (wholePage: boolean) => Promise<void>
  setLiveSourceIndex: Set<number>
  setState: Set<EditorState>
  nameOf: (section: EditorSection) => string
}) {
  const {
    sectionConfirmation,
    setSectionConfirmation,
    discardConfirmation,
    setDiscardConfirmation,
    resetting,
    liveSourceIndex,
  } = restore
  return (
    <>
      {sectionConfirmation?.action === 'delete' && (
        <ConfirmDialog
          title="Delete section?"
          what="This section will be removed from this page's draft."
          reassurance="You can undo this change. The live page stays as it is until you publish."
          confirmLabel="Delete section"
          onCancel={() => setSectionConfirmation(null)}
          onConfirm={() => {
            setState(current => {
              const index = current.sectionOrigins.indexOf(sectionConfirmation.origin)
              return index < 0 ? current : removeSection(current, index)
            })
            setSectionConfirmation(null)
          }}
        />
      )}
      {sectionConfirmation?.action === 'reset' && (
        <Dialog title="Reset to live version?" onClose={() => setSectionConfirmation(null)} pending={resetting}>
          <p>
            Choose the section from the live page. It replaces this section in a new draft. Earlier work stays in page
            history, and Undo brings it back.
          </p>
          <label htmlFor="live-section-source">Section on the live page</label>
          <select
            id="live-section-source"
            value={liveSourceIndex}
            onChange={event => setLiveSourceIndex(Number(event.target.value))}
            disabled={resetting}
          >
            {props.liveSections.map((section, index) => (
              <option key={index} value={index}>
                {index + 1}. {nameOf(section)}
              </option>
            ))}
          </select>
          <div className="actions">
            <Button variant="secondary" onClick={() => setSectionConfirmation(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button onClick={() => void applyLiveReset(false)} loading={resetting}>
              Reset to live version
            </Button>
          </div>
        </Dialog>
      )}
      {discardConfirmation && (
        <ConfirmDialog
          title="Discard all unpublished changes?"
          what="The entire page will return to its live version in a new draft."
          reassurance="Earlier work stays in page history. Undo restores it during this session."
          confirmLabel="Discard unpublished changes"
          pending={resetting}
          onCancel={() => setDiscardConfirmation(false)}
          onConfirm={() => void applyLiveReset(true)}
        />
      )}
    </>
  )
}

/** A pending restore or discard belongs to the confirmation, not the draft. */
export function useEditorLiveRestoreState() {
  const [discardConfirmation, setDiscardConfirmation] = useState(false)
  const [liveSourceIndex, setLiveSourceIndex] = useState(0)
  const [resetting, setResetting] = useState(false)
  const [sectionConfirmation, setSectionConfirmation] = useState<{ origin: string; action: 'delete' | 'reset' } | null>(
    null,
  )
  return {
    discardConfirmation,
    setDiscardConfirmation,
    liveSourceIndex,
    setLiveSourceIndex,
    resetting,
    setResetting,
    sectionConfirmation,
    setSectionConfirmation,
  }
}
