import { useState } from 'react'
import type { Viewport } from './editor-viewports.ts'

/** The preview viewport and zoom belong to the canvas, not to the saved page. */
export function useEditorViewportState() {
  const [viewport, setViewport] = useState<Viewport>('desktop')
  // Scale the visitor's desktop viewport to fit without changing its layout.
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')
  const [manualScale, setManualScale] = useState(1)
  const [previewHidden, setPreviewHidden] = useState(false)
  const [focusCanvas, setFocusCanvas] = useState(false)
  return {
    viewport,
    setViewport,
    zoom,
    setZoom,
    manualScale,
    setManualScale,
    previewHidden,
    setPreviewHidden,
    focusCanvas,
    setFocusCanvas,
  }
}
