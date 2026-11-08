import type { CanvasDocumentSource } from './editor-types.ts'
import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { PREVIEW_MESSAGE } from '@cms/renderer'
import type { CanvasMenuAddState } from '../../../components/canvas-menu-add.tsx'
import { COMMAND_SEARCH_EVENT, isCommandSearchKey } from '../../../lib/command-search-model.ts'
import { planCanvasUpdate } from './canvas-sync.ts'
import { useCanvasDocumentSync } from './use-canvas-document-sync.ts'
import { useCanvasMessages } from './use-canvas-messages.ts'
import type { useIsolatedCanvas } from './use-isolated-canvas.ts'

type Receive = Parameters<typeof useCanvasMessages>[0]
type Sync = Parameters<typeof useCanvasDocumentSync>[0]
type Inputs = {
  frame: Omit<Receive['frame'] & Sync['frame'], 'toCanvas'> & {
    isolatedCurrent: { current: ReturnType<typeof useIsolatedCanvas> }
    canvasFramePending: boolean
    canvasSource: CanvasDocumentSource
    setCanvasSlow: Dispatch<SetStateAction<boolean>>
  }
  document: Omit<Receive['document'], 'currentSlotKind'> & Sync['document']
  selection: Receive['selection']
  editing: Receive['editing']
  view: Sync['view'] & { focusCanvas: boolean; setFocusCanvas: Dispatch<SetStateAction<boolean>> }
}

/** Move edits between the current canvas and the page document. */
export function useEditorCanvasBridge({ frame, document: editorDocument, selection, editing, view }: Inputs) {
  const {
    canvasFramePending,
    rendered,
    canvasRefreshBlocked,
    isolatedCurrent,
    canvasRef,
    canvasReady,
    setCanvasSlow,
    canvasSource,
    isolated,
  } = frame
  const { state, slotKind, richTextRequest } = editorDocument
  const { focusCanvas, setFocusCanvas } = view
  const canvasAwaitingRender = canvasFramePending || planCanvasUpdate(rendered.current, state.document, slotKind).render
  useLayoutEffect(() => {
    canvasRefreshBlocked.current = canvasAwaitingRender
  }, [canvasAwaitingRender])
  const activeRichText =
    richTextRequest &&
    state.selection.section === richTextRequest.section &&
    state.selection.slot === richTextRequest.slot &&
    state.sectionOrigins[richTextRequest.section] === richTextRequest.origin
      ? richTextRequest
      : null
  const currentSlotKind = useRef(slotKind)
  currentSlotKind.current = slotKind

  // ------------------------------------------------------------- canvas link

  const toCanvas = useCallback((message: Record<string, unknown>) => {
    if (isolatedCurrent.current.enabled) isolatedCurrent.current.post(message)
    else canvasRef.current?.contentWindow?.postMessage(message, window.location.origin)
  }, [])

  const sendCanvasMenu = useCallback(
    (menu: CanvasMenuAddState | null) => toCanvas({ type: 'cms:menu-add', menu }),
    [toCanvas, canvasReady],
  )

  useEffect(() => {
    // Native dragend goes to the card's document, even when Escape cancels
    // with the pointer inside the iframe. Clear that frame's insertion marker.
    const cancelDrop = () => toCanvas({ type: PREVIEW_MESSAGE.cancelDrop })
    document.addEventListener('dragend', cancelDrop, true)
    return () => document.removeEventListener('dragend', cancelDrop, true)
  }, [toCanvas])

  useCanvasMessages({
    frame: { ...frame, toCanvas },
    document: { ...editorDocument, currentSlotKind },
    selection,
    editing,
  })

  const openingEpoch = canvasSource.automaticRetry ? canvasSource.epoch - 1 : canvasSource.epoch
  useEffect(() => {
    setCanvasSlow(false)
    if (!state.document.sections.length || !canvasSource.versionId || canvasReady > 0) return
    const timer = window.setTimeout(() => setCanvasSlow(true), 20_000)
    return () => window.clearTimeout(timer)
  }, [canvasReady, canvasSource.versionId, openingEpoch, state.document.sections.length])

  useEffect(() => {
    if (!focusCanvas) return
    const leave = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusCanvas(false)
    }
    const canvasDocument = isolated.enabled ? null : canvasRef.current?.contentDocument
    window.addEventListener('keydown', leave)
    canvasDocument?.addEventListener('keydown', leave, true)
    return () => {
      window.removeEventListener('keydown', leave)
      canvasDocument?.removeEventListener('keydown', leave, true)
    }
  }, [focusCanvas, canvasReady, isolated.enabled])

  useEffect(() => {
    if (isolated.enabled || !canvasReady) return
    const doc = canvasRef.current?.contentDocument
    const search = (event: KeyboardEvent) => {
      if (!isCommandSearchKey(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      window.dispatchEvent(new Event(COMMAND_SEARCH_EVENT))
    }
    doc?.addEventListener('keydown', search, true)
    return () => doc?.removeEventListener('keydown', search, true)
  }, [canvasReady, isolated.enabled])

  const renderCanvas = useCanvasDocumentSync({ document: editorDocument, frame: { ...frame, toCanvas }, view })
  return { canvasAwaitingRender, activeRichText, toCanvas, sendCanvasMenu, renderCanvas }
}
