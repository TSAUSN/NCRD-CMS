import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  commitSaved,
  createEditorState,
  deepEqual,
  isDirty,
  type EditorDocument,
  type EditorState,
  type SaveQueue,
} from '@cms/domain'
import { draftSaveFailure } from '../../../lib/draft-save-failure.ts'
import { pageLeaveSnapshot } from '../../../lib/page-leave.ts'
import { savePageDraft } from '../../actions/page-draft.ts'
import type { ActionResult } from '../../../lib/action-result.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { PageEditorProps } from './editor-types.ts'

type Current<T> = { current: T }
type Set<T> = Dispatch<SetStateAction<T>>

// After a one-second pause, autosave queues the draft. Continuous typing avoids
// a write per key; acknowledgement still depends on the server.
const AUTOSAVE_MS = 1000
// Reorder, visibility, rich text, links and images need the canonical server
// renderer before the canvas can show them. Waiting the full typing debounce
// made V2 feel unlike V1 precisely on direct-manipulation actions, so those
// changes settle quickly while ordinary text still avoids a write per key.
const CANVAS_RENDER_MS = 350
export type SaveSnapshot = { document: EditorDocument; sectionOrigins: string[] }

type Inputs = {
  draft: {
    props: Pick<PageEditorProps, 'pageId'>
    state: EditorState
    setState: Set<EditorState>
    currentEditor: Current<EditorState>
    openingSnapshot: Current<SaveSnapshot | null>
    slotsByDef: ReadonlyMap<string, LibraryEntry>
    dirty: boolean
  }
  persistence: {
    queue: Current<SaveQueue<SaveSnapshot>>
    saving: boolean
    setSaving: Set<boolean>
    setRevision: Set<PageEditorProps['revision']>
    savedVersionId: Current<string | null>
    setResult: Set<ActionResult | null>
    result: ActionResult | null
    setApprovedVersionId: Set<string | null>
    setReview: Set<PageEditorProps['openReview']>
    requiresReload: boolean
    setRequiresReload: Set<boolean>
    upgrade: unknown
    replacement: unknown
    sectionTool: unknown
  }
  canvas: {
    needsRender: Current<boolean>
    renderCanvas: (snapshot: EditorDocument) => void
    withCanvasValues: (action: () => void | Promise<void>) => Promise<void>
    isolatedCurrent: Current<{ enabled: boolean; flush: () => Promise<boolean> }>
    canvasRefreshBlocked: Current<boolean>
  }
}

/** Save the acknowledged snapshot and keep the leave actions on the same queue. */
export function useDraftSave({ draft, persistence, canvas }: Inputs) {
  const { props, state, setState, currentEditor, openingSnapshot, slotsByDef, dirty } = draft
  const {
    queue,
    saving,
    setSaving,
    setRevision,
    savedVersionId,
    setResult,
    result,
    setApprovedVersionId,
    setReview,
    requiresReload,
    setRequiresReload,
    upgrade,
    replacement,
    sectionTool,
  } = persistence
  const { needsRender, renderCanvas, withCanvasValues, isolatedCurrent, canvasRefreshBlocked } = canvas
  const save = useCallback(
    async (kind: 'autosave' | 'checkpoint', override?: SaveSnapshot): Promise<ActionResult | null> => {
      if (requiresReload) return null
      // Capture exactly what is being sent. Everything below commits *this*,
      // never "whatever the document is when the response arrives" — text typed
      // during the request has not been saved and must stay dirty.
      const snapshot: SaveSnapshot = override ?? {
        document: state.document,
        sectionOrigins: state.sectionOrigins,
      }
      setSaving(true)

      let queued
      try {
        queued = await queue.current.enqueue({
          snapshot,
          run: async (currentRevision, sending) => {
            const data = new FormData()
            data.set('pageId', props.pageId)
            data.set('revision', String(currentRevision))
            data.set('content', JSON.stringify(sending.document.sections))
            data.set('meta', JSON.stringify(sending.document.meta))
            data.set('kind', kind)
            if (sending.document.identity) data.set('identity', JSON.stringify(sending.document.identity))

            const outcome = await savePageDraft(data)
            // An autosave that worked says so in the indicator and nowhere else.
            //
            // Raising the banner for every autosave meant a green "All changes
            // saved" bar appeared a second and a half after every keystroke and
            // stayed until something else replaced it — permanent chrome
            // announcing the thing the saved-state indicator is already there to
            // announce, and pushing the page down to do it. A *failed* autosave
            // still raises it, because that is news.
            if (kind === 'checkpoint' || !outcome.ok) setResult(outcome)
            // Recorded here rather than after the queue resolves, because this
            // is the response that knows which version it wrote.
            if (outcome.ok && outcome.versionId) {
              savedVersionId.current = outcome.versionId
              // Approval belongs to the exact immutable version that was
              // reviewed. Every successful save creates another one.
              setApprovedVersionId(null)
              // Moving the draft head supersedes an open submission in the
              // database trigger. Mirror that fact immediately in the toolbar.
              setReview(current => (current?.versionId === outcome.versionId ? current : null))
            }
            return outcome.ok
              ? { ok: true, revision: outcome.revision }
              : { ok: false, conflict: outcome.kind === 'conflict' }
          },
        })
      } catch (error) {
        // A rejected request used to leave `saving` true forever, which
        // disabled autosave and the Save button and left the indicator on
        // "Saving…" while the work was unsaved — the worst shape a failure
        // could take.
        const failure = draftSaveFailure(error)
        if (failure.requiresReload) setRequiresReload(true)
        setResult({ ok: false, kind: 'error', message: failure.message })
        return null
      } finally {
        setSaving(queue.current.busy())
      }

      if (queued.status !== 'acknowledged') return null

      setRevision(queued.revision)
      setState(current => commitSaved(current, queued.snapshot.document))

      // The moment the canvas can be brought up to date: the values it could
      // not be given are now in a stored version the renderer can read.
      if (needsRender.current) renderCanvas(queued.snapshot.document)
      return { ok: true, revision: queued.revision, versionId: null, message: 'saved' }
    },
    [props.pageId, state.document, state.sectionOrigins, renderCanvas, requiresReload],
  )

  const latestSave = useRef(save)
  latestSave.current = save

  async function savePageBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    let result: { ok: boolean; message?: string } = {
      ok: false,
      message: 'The page preview did not answer. Keep editing and reload its preview before leaving.',
    }
    await withCanvasValues(async () => {
      const current = currentEditor.current
      const captured = structuredClone(current.document)
      const snapshot = pageLeaveSnapshot(
        { document: current.document, sectionOrigins: current.sectionOrigins },
        openingSnapshot.current!,
        slotsByDef,
      )
      if (!deepEqual(snapshot.document, current.document))
        setState(state => (deepEqual(state.document, captured) ? { ...state, document: snapshot.document } : state))
      if (deepEqual(snapshot.document, current.saved)) {
        result = { ok: true }
        return
      }
      const outcome = await latestSave.current('checkpoint', snapshot)
      if (!outcome?.ok) {
        result = {
          ok: false,
          message:
            'The draft could not be saved. Keep editing to check the message and your saved history before trying again.',
        }
        return
      }
      const now = currentEditor.current.document
      if (!deepEqual(now, captured) && !deepEqual(now, snapshot.document)) {
        result = {
          ok: false,
          message: 'More edits arrived while saving. Keep editing and check the latest draft before leaving.',
        }
        return
      }
      result = { ok: true }
    })
    return result
  }
  async function discardPageBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    const snapshot = structuredClone(openingSnapshot.current!)
    const outcome = await latestSave.current('checkpoint', snapshot)
    if (!outcome?.ok)
      return {
        ok: false,
        message: 'Your edits could not be discarded. Keep editing and check the saved history before trying again.',
      }
    setState(() => ({
      ...createEditorState(snapshot.document),
      sectionOrigins: [...snapshot.sectionOrigins],
      baselineOrigins: [...snapshot.sectionOrigins],
    }))
    renderCanvas(snapshot.document)
    return { ok: true }
  }

  // Debounced autosave. A conflict stops the loop rather than retrying into it.
  const blocked = requiresReload || (result?.ok === false && result.kind === 'conflict')
  useEffect(() => {
    if (!dirty || saving || blocked || upgrade !== null || replacement !== null || sectionTool !== null) return
    const timer = setTimeout(() => void save('autosave'), needsRender.current ? CANVAS_RENDER_MS : AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [dirty, saving, blocked, save, upgrade, replacement, sectionTool])

  /** Section reviews compare against an acknowledged version. A clean preview
   * is read-only: making an identical checkpoint here would unnecessarily
   * supersede a submission waiting for review. The apply commands guarantee
   * the recovery checkpoint when a change is accepted. */
  async function flushForReview(): Promise<boolean> {
    if (isolatedCurrent.current.enabled && !canvasRefreshBlocked.current && !(await isolatedCurrent.current.flush()))
      return false
    if (isDirty(currentEditor.current)) return (await latestSave.current('checkpoint')) !== null
    return queue.current
      .enqueue({
        snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
        run: async currentRevision => ({ ok: true, revision: currentRevision }),
      })
      .then(result => result.status === 'acknowledged')
      .finally(() => setSaving(queue.current.busy()))
  }
  return { save, latestSave, savePageBeforeLeaving, discardPageBeforeLeaving, flushForReview }
}
