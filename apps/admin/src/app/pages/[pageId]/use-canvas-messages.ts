import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import { setSelection, redo, undo, setValue, type EditorDocument, type EditorState } from '@cms/domain'
import { PREVIEW_MESSAGE } from '@cms/renderer'
import { withCanvasValue, type SlotKind } from './canvas-sync.ts'
import type { CanvasRichTextRequest } from './canvas-rich-text.tsx'
import type { CanvasHover } from './canvas-chrome.tsx'
import type { RichTextToolbarState } from './rich-text-commands.ts'
import type { PageEditorProps, EditorPane } from './editor-types.ts'

type Current<T> = { current: T }
type Set<T> = Dispatch<SetStateAction<T>>
type SiteFrame = { part: 'header' | 'footer'; editing: boolean }

type Inputs = {
  frame: {
    isolatedCurrent: Current<{ enabled: boolean; accept: (event: MessageEvent) => boolean }>
    canvasRef: Current<HTMLIFrameElement | null>
    canvasRefreshBlocked: Current<boolean>
    remoteActions: Current<(data: Record<string, unknown>) => boolean>
    readyDocumentId: Current<string | null>
    setCanvasFramePending: Set<boolean>
    setCanvasReady: Set<number>
    setCanvasAttached: Set<boolean>
    toCanvas: (message: Record<string, unknown>) => void
  }
  document: {
    currentEditor: Current<EditorState>
    currentSlotKind: Current<SlotKind>
    shown: Current<EditorDocument>
    rendered: Current<EditorDocument>
    needsRender: Current<boolean>
    setState: Set<EditorState>
    canvasHistoryBlocked: Current<boolean>
    sectionLocked: (index: number | null) => boolean
  }
  selection: {
    props: Pick<PageEditorProps, 'pageScoped'>
    siteWideCurrent: Current<SiteFrame | null>
    setSiteWide: Set<SiteFrame | null>
    setMenuEdit: Set<{ path: string; label: string; sequence: number } | null>
    setMenuMove: Set<{ from: string; to: string; sequence: number } | null>
    setListSelection: Set<{ section: number; readerKey: string; stableKey: string; field: string } | null>
    setPane: Set<EditorPane>
  }
  editing: {
    libraryStage: Current<boolean>
    setLibraryOpen: Set<boolean>
    dropOnCanvas: Current<((sectionDefId: string, at: number) => void) | null>
    setRichTextRequest: Set<CanvasRichTextRequest | null>
    setRemoteHover: Set<CanvasHover | null>
    setRemoteRichState: Set<RichTextToolbarState | null>
    setRemoteRichUnavailable: Set<boolean>
  }
}

/** Receive edits and readiness from the current canvas document. */
export function useCanvasMessages({ frame, document: editorDocument, selection, editing }: Inputs) {
  const {
    isolatedCurrent,
    canvasRef,
    canvasRefreshBlocked,
    remoteActions,
    readyDocumentId,
    setCanvasFramePending,
    setCanvasReady,
    setCanvasAttached,
    toCanvas,
  } = frame
  const {
    currentEditor,
    currentSlotKind,
    shown,
    rendered,
    needsRender,
    setState,
    canvasHistoryBlocked,
    sectionLocked,
  } = editorDocument
  const { props, siteWideCurrent, setSiteWide, setMenuEdit, setMenuMove, setListSelection, setPane } = selection
  const {
    libraryStage,
    setLibraryOpen,
    dropOnCanvas,
    setRichTextRequest,
    setRemoteHover,
    setRemoteRichState,
    setRemoteRichUnavailable,
  } = editing
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Same-origin only: the canvas is our own route, and anything else
      // talking to this window is not the canvas.
      if (
        isolatedCurrent.current.enabled
          ? !isolatedCurrent.current.accept(event)
          : event.origin !== window.location.origin ||
            event.source !== canvasRef.current?.contentWindow ||
            !event.data?.type
      )
        return
      if (
        canvasRefreshBlocked.current &&
        event.data.type !== PREVIEW_MESSAGE.ready &&
        event.data.type !== 'cms:frame-editing'
      )
        return
      if (isolatedCurrent.current.enabled && remoteActions.current(event.data as Record<string, unknown>)) return
      const data = event.data as {
        type: string
        documentId?: unknown
        section: number | null
        slot: string | null
        value?: unknown
        x?: unknown
        y?: unknown
        occurrence?: unknown
        editing?: unknown
        burst?: unknown
        readerKey?: unknown
        stableKey?: unknown
        field?: unknown
        part?: unknown
        path?: unknown
        label?: unknown
        from?: unknown
        to?: unknown
      }
      if (libraryStage.current && event.data.type !== PREVIEW_MESSAGE.ready) return
      const section =
        Number.isSafeInteger(data.section) && data.section !== null
          ? currentEditor.current.document.sections[data.section]
          : undefined
      const kind = section && typeof data.slot === 'string' ? currentSlotKind.current(section, data.slot) : undefined

      if (data.type === PREVIEW_MESSAGE.ready) {
        if (typeof data.documentId === 'string') {
          if (readyDocumentId.current === data.documentId) return
          readyDocumentId.current = data.documentId
        }
        // A canvas that has just loaded is a different document: it shows what
        // the server rendered and nothing that was patched into the one before
        // it, and it has lost the selection outline and the emulated width
        // along with the window that held them.
        setRichTextRequest(null)
        setRemoteHover(null)
        setRemoteRichState(null)
        setRemoteRichUnavailable(false)
        shown.current = rendered.current
        setCanvasFramePending(false)
        setCanvasReady(n => n + 1)
      } else if (
        !props.pageScoped &&
        data.type === PREVIEW_MESSAGE.selectFrame &&
        (data.part === 'header' || data.part === 'footer')
      ) {
        if (!siteWideCurrent.current?.editing) {
          setState(current => setSelection(current, { section: null, slot: null }))
          setMenuEdit(null)
          setMenuMove(null)
          setSiteWide({ part: data.part, editing: false })
          setLibraryOpen(false)
          setPane('inspector')
        }
      } else if (
        data.type === PREVIEW_MESSAGE.moveFrameMenu &&
        siteWideCurrent.current?.editing &&
        typeof data.from === 'string' &&
        typeof data.to === 'string' &&
        /^\d+(?:\.\d+)?$/.test(data.from) &&
        /^\d+(?:\.\d+)?$/.test(data.to)
      ) {
        setMenuMove(previous => ({
          from: data.from as string,
          to: data.to as string,
          sequence: (previous?.sequence ?? 0) + 1,
        }))
      } else if (
        data.type === PREVIEW_MESSAGE.editFrameMenu &&
        siteWideCurrent.current?.editing &&
        typeof data.path === 'string' &&
        /^[0-9]+(?:\.[0-9]+)?$/.test(data.path) &&
        typeof data.label === 'string'
      ) {
        setMenuEdit(previous => ({
          path: data.path as string,
          label: data.label as string,
          sequence: (previous?.sequence ?? 0) + 1,
        }))
      } else if (
        data.type === PREVIEW_MESSAGE.selectListItem &&
        Number.isSafeInteger(data.section) &&
        typeof data.readerKey === 'string' &&
        /^[a-z][a-z0-9_]{0,63}$/.test(data.readerKey) &&
        data.section !== null &&
        data.section >= 0 &&
        data.section < currentEditor.current.document.sections.length &&
        typeof data.stableKey === 'string' &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.stableKey) &&
        typeof data.field === 'string'
      ) {
        setState(current => setSelection(current, { section: data.section, slot: null }))
        setListSelection({
          section: data.section,
          readerKey: data.readerKey,
          stableKey: data.stableKey,
          field: data.field,
        })
      } else if (data.type === PREVIEW_MESSAGE.select) {
        if (siteWideCurrent.current?.editing) return
        setSiteWide(null)
        setListSelection(null)
        setState(current => setSelection(current, { section: data.section, slot: data.slot }))
        setPane(data.editing === true ? 'canvas' : 'inspector')
      } else if (data.type === PREVIEW_MESSAGE.undo || data.type === PREVIEW_MESSAGE.redo) {
        // The same origin/source check above applies to history requests.
        // The canvas has no independent page-history stack.
        if (!canvasHistoryBlocked.current) {
          setState(current => (data.type === PREVIEW_MESSAGE.redo ? redo(current) : undo(current)))
        }
      } else if (
        data.type === PREVIEW_MESSAGE.editRichText &&
        section &&
        kind === 'richtext' &&
        data.section !== null &&
        typeof data.slot === 'string' &&
        !canvasHistoryBlocked.current &&
        !sectionLocked(data.section)
      ) {
        if (isolatedCurrent.current.enabled) {
          setRemoteRichState(null)
          setRemoteRichUnavailable(false)
        }
        setState(current => setSelection(current, { section: data.section, slot: data.slot }))
        setRichTextRequest({
          section: data.section,
          slot: data.slot,
          origin: currentEditor.current.sectionOrigins[data.section]!,
          occurrence:
            typeof data.occurrence === 'number' && Number.isSafeInteger(data.occurrence) && data.occurrence >= 0
              ? data.occurrence
              : 0,
          x: typeof data.x === 'number' && Number.isFinite(data.x) ? data.x : null,
          y: typeof data.y === 'number' && Number.isFinite(data.y) ? data.y : null,
        })
      } else if (
        data.type === PREVIEW_MESSAGE.edit &&
        section &&
        kind === 'text' &&
        data.section !== null &&
        typeof data.slot === 'string' &&
        typeof data.value === 'string' &&
        !canvasHistoryBlocked.current
      ) {
        // Typing directly on the canvas is the same edit as typing in the
        // inspector, so it goes through the same state transition — but the
        // canvas is already showing it, and recording that is what stops the
        // sync below from posting the character back into the node the caret
        // is sitting in.
        shown.current = withCanvasValue(shown.current, data.section, data.slot, data.value as string)
        // A burst of typing on the canvas is one undo step; the canvas says
        // where each burst begins (a click or a caret move ends it).
        const burst =
          typeof data.burst === 'number' && Number.isSafeInteger(data.burst)
            ? `canvas-${data.burst}`
            : `canvas-${Date.now()}`
        const edit = () =>
          setState(current =>
            setValue(current, data.section!, data.slot!, data.value as string, { at: Date.now(), burst }),
          )
        if (isolatedCurrent.current.enabled) flushSync(edit)
        else edit()
      } else if (data.type === PREVIEW_MESSAGE.dropSection) {
        // A card dragged from the docked library onto the page. The canvas
        // names a gap; whether that definition is offered here, and whether the
        // gap exists, is decided against the editor's own state.
        const drop = event.data as { sectionDefId?: unknown; at?: unknown }
        const at = drop.at
        if (
          typeof drop.sectionDefId === 'string' &&
          typeof at === 'number' &&
          Number.isSafeInteger(at) &&
          at >= 0 &&
          at <= currentEditor.current.document.sections.length &&
          !canvasHistoryBlocked.current
        ) {
          dropOnCanvas.current?.(drop.sectionDefId, at)
        }
      } else if (data.type === PREVIEW_MESSAGE.unpatched) {
        // The canvas could not write that value where the editor believed it
        // was — an attribute-position slot has no node of its own, and a
        // hidden section has no nodes at all. Only a render can show it, and a
        // value that quietly never lands is precisely how the page and the
        // document came to disagree with nobody able to see that they had.
        needsRender.current = true
      }
    }
    window.addEventListener('message', onMessage)
    // Start the frame after hydration installs its listener, so the first
    // navigation and readiness exchange cannot race that setup. The public
    // page itself remains server rendered.
    setCanvasAttached(true)
    toCanvas({ type: PREVIEW_MESSAGE.requestReady })
    return () => window.removeEventListener('message', onMessage)
  }, [toCanvas])
}
