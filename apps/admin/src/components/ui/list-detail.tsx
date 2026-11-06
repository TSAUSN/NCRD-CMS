'use client'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ResizablePanel } from './resizable-panel.tsx'
import shared from '../workspace.module.css'
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
  const root = useRef<HTMLDivElement>(null),
    open = Boolean(panel)
  useLayoutEffect(() => {
    if (!open) return
    const node = root.current?.children[1] as HTMLElement | undefined
    if (!node) return
    let frame = 0
    const measure = () =>
        node.style.setProperty(
          '--detail-panel-available',
          Math.max(0, window.innerHeight - node.getBoundingClientRect().top) + 'px',
        ),
      update = () => {
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
      className={shared.listDetail}
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
      <div className={shared.listDetailMain}>{children}</div>
      {panel && (
        <ResizablePanel
          label={label}
          storageKey={storageKey}
          min={320}
          max={480}
          initial={360}
          reserveSpace={336}
          className={shared.listDetailPanel + ' ' + (panelFrame ? shared.panelFrame : shared.detailPanel)}
        >
          {panelFrame ? (
            panel
          ) : (
            <>
              {header && <div className={shared.detailPanelHead}>{header}</div>}
              <div className={shared.detailPanelBody}>{panel}</div>
              {footer && <div className={shared.detailPanelFooter}>{footer}</div>}
            </>
          )}
        </ResizablePanel>
      )}
    </div>
  )
}
