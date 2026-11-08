import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { EditorDocument, EditorState } from '@cms/domain'
import type { FieldLike } from '@cms/schema'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import type { CanvasAction, CanvasHover } from './canvas-chrome.tsx'
import type { CanvasRichTextRequest } from './canvas-rich-text.tsx'
import type { CanvasDocumentSource, PageEditorProps } from './editor-types.ts'
import { VIEWPORTS, type Viewport } from './editor-viewports.ts'
import type { RichTextToolbarState } from './rich-text-commands.ts'
import { useIsolatedCanvas } from './use-isolated-canvas.ts'

type Inputs = {
  props: Pick<PageEditorProps, 'previewVersionId' | 'isolatedCanvasOrigin' | 'pageId'>
  state: EditorState
  viewport: Viewport
  zoom: 'fit' | 'actual'
  manualScale: number
  sitePreview: SitePreviewContext
  setSitePreview: Dispatch<SetStateAction<SitePreviewContext>>
  showHiddenSections: boolean
}

/** Own the current preview document, its size and its interaction state. */
export function useEditorCanvasSession({
  props,
  state,
  viewport,
  zoom,
  manualScale,
  sitePreview,
  setSitePreview,
  showHiddenSections,
}: Inputs) {
  const canvasHistoryBlocked = useRef(false)
  const dropOnCanvas = useRef<((sectionDefId: string, at: number) => void) | null>(null)

  const canvasItemToolbarRef = useRef<HTMLDivElement>(null)
  const canvasZoomRef = useRef<HTMLDivElement>(null)
  const canvasRefreshBlocked = useRef(false)
  const [canvasFramePending, setCanvasFramePending] = useState(false)
  const canvasRef = useRef<HTMLIFrameElement>(null)
  const canvasViewportRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const deviceWidth = VIEWPORTS[viewport].width
  const previewWidth = deviceWidth
  const previewScale =
    zoom === 'fit' && canvasSize.width > 0
      ? Math.min(1, canvasSize.width / previewWidth)
      : zoom === 'actual'
        ? manualScale
        : 1
  useEffect(() => {
    const node = canvasViewportRef.current
    if (!node) return
    const measure = () =>
      setCanvasSize({
        width: node.clientWidth - Number.parseFloat(getComputedStyle(node).paddingInlineStart || '0'),
        height: node.clientHeight,
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  /**
   * What the canvas is showing, and what it is owed.
   *
   * The first four are refs rather than state because none of them decides what
   * the *editor* renders — they decide what the canvas is told. Holding them as
   * state would rebuild the save callback and restart the debounced autosave on
   * every keystroke, which is the one thing that timer must not do.
   */
  /** The draft version the server most recently stored. */
  const savedVersionId = useRef(props.previewVersionId)
  /** The document the canvas in front of us was rendered from. */
  const rendered = useRef<EditorDocument>(state.document)
  /** That document, plus every value patched into it since it loaded. */
  const shown = useRef<EditorDocument>(state.document)
  /** Set once the canvas is showing something a patch cannot correct. */
  const needsRender = useRef(false)
  /** Which version the canvas is pointed at; a new epoch reloads it. */
  const [canvasSource, setCanvasSource] = useState<CanvasDocumentSource>({
    versionId: props.previewVersionId,
    epoch: 0,
  })
  /** Bumped each time the canvas announces a document, so the sync effect re-runs. */
  const [canvasReady, setCanvasReady] = useState(0)
  const isolated = useIsolatedCanvas({
    origin: props.isolatedCanvasOrigin ?? null,
    pageId: props.pageId,
    version: canvasSource.versionId,
    epoch: canvasSource.epoch,
    site: sitePreview,
    hidden: showHiddenSections,
    frame: canvasRef,
  })
  const isolatedCurrent = useRef(isolated)
  isolatedCurrent.current = isolated
  const [canvasMenuPage, setCanvasMenuPage] = useState<{ id: string; sequence: number } | null>(null)
  const [remoteHover, setRemoteHover] = useState<CanvasHover | null>(null)
  const [remoteRichState, setRemoteRichState] = useState<RichTextToolbarState | null>(null)
  const [remoteRichUnavailable, setRemoteRichUnavailable] = useState(false)
  const remoteActions = useRef<(data: Record<string, unknown>) => boolean>(() => false)
  const canvasOperations = useRef<{
    section: (action: CanvasAction, index: number) => void
    repeat: (
      index: number,
      slot: FieldLike,
      action: 'add' | 'up' | 'down' | 'duplicate' | 'delete',
      key?: string,
    ) => void
  } | null>(null)
  const sitePreviewCurrent = useRef(sitePreview)
  sitePreviewCurrent.current = sitePreview
  const changeSitePreview = useCallback((next: SitePreviewContext) => {
    if (sitePreviewCurrent.current === next) return
    sitePreviewCurrent.current = next
    setCanvasFramePending(true)
    setCanvasReady(0)
    setSitePreview(next)
  }, [])
  const [canvasAttached, setCanvasAttached] = useState(false)
  const [canvasSlow, setCanvasSlow] = useState(false)
  const readyDocumentId = useRef<string | null>(null)
  const [richTextRequest, setRichTextRequest] = useState<CanvasRichTextRequest | null>(null)
  return {
    frame: {
      canvasRef,
      canvasViewportRef,
      canvasItemToolbarRef,
      canvasZoomRef,
      canvasFramePending,
      setCanvasFramePending,
      canvasSource,
      setCanvasSource,
      canvasReady,
      setCanvasReady,
      canvasAttached,
      setCanvasAttached,
      canvasSlow,
      setCanvasSlow,
      readyDocumentId,
    },
    geometry: { canvasSize, deviceWidth, previewWidth, previewScale },
    document: { savedVersionId, rendered, shown, needsRender, canvasRefreshBlocked },
    interaction: {
      isolated,
      isolatedCurrent,
      canvasHistoryBlocked,
      dropOnCanvas,
      canvasMenuPage,
      setCanvasMenuPage,
      remoteHover,
      setRemoteHover,
      remoteRichState,
      setRemoteRichState,
      remoteRichUnavailable,
      setRemoteRichUnavailable,
      remoteActions,
      canvasOperations,
      changeSitePreview,
      richTextRequest,
      setRichTextRequest,
    },
  }
}
