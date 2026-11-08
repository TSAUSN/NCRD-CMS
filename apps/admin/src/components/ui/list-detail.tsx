'use client'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ResizablePanel } from './resizable-panel.tsx'
import listInspectorStyles from '../workspace-styles/list-inspector.module.css'
import ownedStyles from './list-detail-styles.module.css'
/** Shared full-width list with a remembered,non-overlapping detail panel. */
export function ListDetail({
  children,
  panel,
  header,
  footer,
  onClose,
  label,
  storageKey,
  panelFrame = false,
}: {
  children: ReactNode
  panel?: ReactNode
  header?: ReactNode
  footer?: ReactNode
  onClose?: () => void
  label: string
  storageKey: string
  panelFrame?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const open = Boolean(panel)
  useLayoutEffect(() => {
    if (!open) return
    const node = root.current?.children[1] as HTMLElement | undefined
    if (!node) return
    let frame = 0
    const measure = () =>
      node.style.setProperty(
        '--detail-panel-available',
        Math.max(0, window.innerHeight - node.getBoundingClientRect().top) + 'px',
      )
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const observer = new ResizeObserver(update)
    if (node.parentElement) observer.observe(node.parentElement)
    if (node.parentElement?.parentElement) observer.observe(node.parentElement.parentElement)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])
  return (
    <div
      ref={root}
      className={listInspectorStyles.listDetail}
      onKeyDown={event => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          onClose &&
          root.current?.children[1]?.contains(event.target as Node)
        ) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className={listInspectorStyles.listDetailMain}>{children}</div>
      {panel && (
        <ResizablePanel
          label={label}
          storageKey={storageKey}
          min={320}
          max={480}
          initial={360}
          reserveSpace={336}
          className={
            listInspectorStyles.listDetailPanel +
            ' ' +
            (panelFrame ? ownedStyles.panelFrame : listInspectorStyles.detailPanel)
          }
        >
          {panelFrame ? (
            panel
          ) : (
            <>
              {header && <div className={listInspectorStyles.detailPanelHead}>{header}</div>}
              <div className={listInspectorStyles.detailPanelBody}>{panel}</div>
              {footer && <div className={listInspectorStyles.detailPanelFooter}>{footer}</div>}
            </>
          )}
        </ResizablePanel>
      )}
    </div>
  )
}
