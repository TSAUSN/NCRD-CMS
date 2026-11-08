import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { EditorState } from '@cms/domain'

/** Size the panes and restore focus when section placement or a field closes. */
export function useEditorPanels(
  originalDesign: boolean | undefined,
  libraryOpen: boolean,
  selection: EditorState['selection'],
) {
  const [rightWidth, setRightWidth] = useState(360)
  const [structureWidth, setStructureWidth] = useState(240)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)
  const workspaceWidth = measuredWidth ?? 1440
  const [structureOpen, setStructureOpen] = useState(false)
  const pendingFieldFocus = useRef<string | null>(null)
  const structureCollapsed = workspaceWidth - rightWidth - structureWidth < 480
  const rightOverlay = originalDesign && workspaceWidth - rightWidth - 48 < 480
  const panesRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const panes = panesRef.current
    if (!panes) return
    const measure = () => setMeasuredWidth(panes.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panes)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (libraryOpen || !pendingFieldFocus.current) return
    const slot = pendingFieldFocus.current
    const frame = requestAnimationFrame(() => {
      const field = document.querySelector<HTMLElement>(`[data-inspector-slot="${CSS.escape(slot)}"]`)
      field?.querySelector<HTMLElement>('input,textarea,select,[contenteditable="true"],button')?.focus()
      pendingFieldFocus.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [libraryOpen, selection])
  const libraryOpener = useRef<HTMLElement | null>(null)
  const returnLibraryFocus = useRef(false)
  useEffect(() => {
    if (libraryOpen || !returnLibraryFocus.current) return
    returnLibraryFocus.current = false
    const opener = libraryOpener.current
    const target = opener?.isConnected
      ? opener
      : ((opener?.id ? document.getElementById(opener.id) : null) ?? document.getElementById('editor-add-section-end'))
    target?.focus({ preventScroll: true })
  }, [libraryOpen])
  return {
    rightWidth,
    setRightWidth,
    structureWidth,
    setStructureWidth,
    workspaceWidth,
    panesRef,
    layoutReady: measuredWidth !== null,
    structureOpen,
    setStructureOpen,
    pendingFieldFocus,
    structureCollapsed,
    rightOverlay,
    libraryOpener,
    returnLibraryFocus,
  }
}
