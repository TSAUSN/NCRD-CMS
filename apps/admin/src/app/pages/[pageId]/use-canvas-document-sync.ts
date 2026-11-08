import type { CanvasDocumentSource } from './editor-types.ts'
import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { EditorDocument, EditorSection, EditorState } from '@cms/domain'
import { PREVIEW_MESSAGE } from '@cms/renderer'
import { slotForId } from '@cms/schema'
import type { LibraryEntry } from '../../../lib/queries.ts'
import { sectionDisplayName } from '../../../lib/section-display-name.ts'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import { patchCanvasRichText, type CanvasRichTextRequest } from './canvas-rich-text.tsx'
import { planCanvasUpdate } from './canvas-sync.ts'
import type { Viewport } from './editor-viewports.ts'

type Set<T> = Dispatch<SetStateAction<T>>
type Current<T> = { current: T }

type Inputs = {
  document: {
    state: EditorState
    slotsByDef: ReadonlyMap<string, LibraryEntry>
    slotKind: Parameters<typeof planCanvasUpdate>[2]
    richTextConstraints: (section: EditorSection | undefined, slot: string) => unknown
    libraryStage: Current<boolean>
    libraryPreview: LibraryEntry | null
    insertAt: number | null
    richTextRequest: CanvasRichTextRequest | null
    setRichTextRequest: Set<CanvasRichTextRequest | null>
  }
  frame: {
    shown: Current<EditorDocument>
    rendered: Current<EditorDocument>
    needsRender: Current<boolean>
    savedVersionId: Current<string | null>
    canvasRef: Current<HTMLIFrameElement | null>
    canvasReady: number
    setCanvasReady: Set<number>
    setCanvasFramePending: Set<boolean>
    setCanvasSource: Set<CanvasDocumentSource>
    isolated: { enabled: boolean }
    toCanvas: (message: Record<string, unknown>) => void
  }
  view: {
    viewport: Viewport
    previewScale: number
    siteWide: { part: 'header' | 'footer'; editing: boolean } | null
  }
}

/** Keep the preview synchronized with the page and the tools around it. */
export function useCanvasDocumentSync({ document: page, frame, view }: Inputs) {
  const {
    state,
    slotsByDef,
    slotKind,
    richTextConstraints,
    libraryStage,
    libraryPreview,
    insertAt,
    richTextRequest,
    setRichTextRequest,
  } = page
  const {
    shown,
    rendered,
    needsRender,
    savedVersionId,
    canvasRef,
    canvasReady,
    setCanvasReady,
    setCanvasFramePending,
    setCanvasSource,
    isolated,
    toCanvas,
  } = frame
  const { viewport, previewScale, siteWide } = view
  /**
   * Keep the canvas showing the document, whatever changed it.
   *
   * Deriving this from the document rather than from each handler is the whole
   * point: typing, reverting, undoing and redoing all end here, so none of them
   * can be the one transition that forgot to tell the canvas.
   */
  useEffect(() => {
    if (libraryStage.current) return
    const plan = planCanvasUpdate(shown.current, state.document, slotKind)
    for (const patch of plan.patches) {
      if (patch.kind === 'richtext') {
        if (isolated.enabled)
          toCanvas({
            type: 'cms:rich-patch',
            field: {
              section: patch.section,
              slot: patch.slot,
              value: patch.value,
              occurrence: 0,
              label: 'Rich text',
              disabled: false,
              x: null,
              y: null,
              constraints: richTextConstraints(state.document.sections[patch.section], patch.slot),
            },
          })
        else if (
          !patchCanvasRichText(
            canvasRef.current,
            patch.section,
            patch.slot,
            patch.value,
            richTextConstraints(state.document.sections[patch.section], patch.slot),
          )
        )
          needsRender.current = true
      } else toCanvas({ type: PREVIEW_MESSAGE.setValue, ...patch })
    }
    shown.current = state.document
    if (plan.render) needsRender.current = true
    // A canvas input followed immediately by Undo can be batched into a state
    // whose document is the same object as the preceding render. The iframe
    // still contains the input: run for the complete history transition, not
    // only when React observes a different document reference.
  }, [state, canvasReady, slotKind, richTextConstraints, toCanvas, isolated.enabled])

  useEffect(() => {
    if (
      richTextRequest &&
      (state.selection.section !== richTextRequest.section ||
        state.selection.slot !== richTextRequest.slot ||
        state.sectionOrigins[richTextRequest.section] !== richTextRequest.origin)
    )
      setRichTextRequest(null)
  }, [richTextRequest, state.selection, state.sectionOrigins])

  const canvasPalette = useRef<{ generation: number; tokens: Record<string, string> } | null>(null)

  // Both re-applied on every canvas load, not only when they change: the
  // reloaded document has never been told either of them.
  useEffect(() => {
    toCanvas({
      type: PREVIEW_MESSAGE.setSelection,
      ...(libraryPreview ? { section: insertAt, slot: null } : state.selection),
    })
    if (canvasPalette.current?.generation !== canvasReady) {
      const palette = getComputedStyle(document.documentElement)
      const tokens = Object.fromEntries(
        [
          'editor-select',
          'status-review',
          'surface',
          'text',
          'status-pending',
          'status-pending-bg',
          'space-1',
          'space-2',
          'space-3',
          'space-4',
          'target-small',
          'text-meta',
          'line-thin',
          'line-focus',
          'radius-control',
        ].map(key => [key, palette.getPropertyValue('--' + key).trim()]),
      )
      canvasPalette.current = { generation: canvasReady, tokens }
    }
    const { tokens } = canvasPalette.current
    toCanvas({ type: PREVIEW_MESSAGE.setViewport, viewport, scale: previewScale, tokens })
  }, [state.selection, viewport, previewScale, canvasReady, toCanvas, libraryPreview, insertAt])

  useLayoutEffect(() => {
    if (!canvasReady) return
    if (!siteWide?.editing) {
      setCanvasFramePending(false)
      return
    }
    if (isolated.enabled) {
      setCanvasFramePending(true)
      return
    }
    const doc = canvasRef.current?.contentDocument
    if (!doc) return
    const selector = '[data-cms-frame="' + siteWide.part + '"][data-cms-sitewide]'
    if (doc.querySelector(selector)) return
    setCanvasFramePending(true)
    const observer = new MutationObserver(() => {
      if (canvasRef.current?.contentDocument === doc && doc.querySelector(selector)) {
        observer.disconnect()
        setCanvasFramePending(false)
      }
    })
    observer.observe(doc.documentElement, { attributes: true, subtree: true })
    return () => observer.disconnect()
  }, [siteWide?.editing, siteWide?.part, canvasReady, isolated.enabled])
  useEffect(() => {
    toCanvas({ type: PREVIEW_MESSAGE.setFrameEditing, part: siteWide?.editing ? siteWide.part : null })
  }, [siteWide, canvasReady, toCanvas])

  // The name each section shows on the canvas: its private label, or its
  // layout's name. Sent on every load and edit, so a label typed in the
  // inspector appears on the canvas at once without a render.
  const canvasLabels = state.document.sections
    .map((section, index) => {
      const layout = slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))
      const field =
        index === state.selection.section && state.selection.slot
          ? slotForId(layout?.slots ?? [], section.values, state.selection.slot)
          : null
      return sectionDisplayName(section, layout) + (field ? ' · ' + field.label : '')
    })
    .join('\u0000')
  useEffect(() => {
    toCanvas({ type: PREVIEW_MESSAGE.setLabels, labels: canvasLabels.split('\u0000') })
  }, [canvasLabels, canvasReady, toCanvas])

  /**
   * Render the canvas again, from what the server has just stored.
   *
   * Only ever called with an acknowledged snapshot and the version id that
   * write returned. Pointing it at the id this page was loaded with would
   * re-fetch the draft as it stood when the editor opened, which is a render of
   * the work rather than of the work as it is now.
   */
  const renderCanvas = useCallback((snapshot: EditorDocument, automaticRetry = false) => {
    setRichTextRequest(null)
    setCanvasFramePending(true)
    setCanvasReady(0)
    rendered.current = snapshot
    needsRender.current = false
    setCanvasSource(current => ({
      versionId: savedVersionId.current,
      epoch: current.epoch + 1,
      automaticRetry,
    }))
  }, [])
  return renderCanvas
}
