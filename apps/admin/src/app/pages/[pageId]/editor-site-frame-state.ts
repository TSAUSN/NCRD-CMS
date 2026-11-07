import { useRef, useState, type ComponentProps } from 'react'
import type { EditorDocument, EditorState } from '@cms/domain'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import type { EditorInspectorPanel } from './editor-inspector-panel.tsx'

type InspectorFrame = ComponentProps<typeof EditorInspectorPanel>['siteFrame']
type Preview = InspectorFrame['preview']

/** Keep frame editing and menu messages separate from page edits. */
export function useEditorSiteFrameState() {
  const [siteWide, setSiteWide] = useState<{ part: 'header' | 'footer'; editing: boolean } | null>(null)
  const [menuMove, setMenuMove] = useState<{ from: string; to: string; sequence: number } | null>(null)
  const [menuEdit, setMenuEdit] = useState<{ path: string; label: string; sequence: number } | null>(null)
  const finishSiteWide = useRef<() => void>(() => {})
  const siteWideCurrent = useRef(siteWide)
  siteWideCurrent.current = siteWide
  return { siteWide, setSiteWide, menuEdit, setMenuEdit, menuMove, setMenuMove, finishSiteWide, siteWideCurrent }
}

export function siteFrameInspector(
  { siteWide, setSiteWide, menuEdit, menuMove, finishSiteWide }: ReturnType<typeof useEditorSiteFrameState>,
  {
    isolated,
    sendCanvasMenu,
    canvasMenuPage,
    canvasRef,
    canvasReady,
    previewScale,
    changeSitePreview,
    renderCanvas,
    currentEditor,
  }: {
    isolated: { enabled: boolean }
    sendCanvasMenu: NonNullable<Preview['onCanvasMenu']>
    canvasMenuPage: Preview['canvasMenuPage']
    canvasRef: Preview['frame']
    canvasReady: Preview['canvasReady']
    previewScale: Preview['scale']
    changeSitePreview: (value: SitePreviewContext) => void
    renderCanvas: (document: EditorDocument) => void
    currentEditor: { current: EditorState }
  },
): InspectorFrame {
  return {
    siteWide,
    setSiteWide,
    edit: current => {
      changeSitePreview('draft')
      setSiteWide({ ...current, editing: true })
    },
    preview: {
      onCanvasMenu: isolated.enabled ? sendCanvasMenu : undefined,
      canvasMenuPage: isolated.enabled ? canvasMenuPage : null,
      frame: canvasRef,
      canvasReady,
      scale: previewScale,
      menuEdit,
      menuMove,
      registerDone: finish => {
        finishSiteWide.current = finish
      },
      onSaved: () => {
        changeSitePreview('draft')
        renderCanvas(currentEditor.current.saved)
      },
    },
  }
}
