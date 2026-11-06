'use client'
import { useId, useLayoutEffect, useRef, type ComponentProps } from 'react'
import { IconButton } from './button.tsx'
import type { Drawer } from './dialog.tsx'
import styles from '../workspace.module.css'
/** A nonmodal inspector keeps its list available; the caller owns leave/save decisions. */
export function DetailPanel({ title, children, footer, onClose, pending }: ComponentProps<typeof Drawer>) {
  const id = useId(),
    panel = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const node = panel.current
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
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [])
  useLayoutEffect(() => {
    const opener = document.activeElement
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <section
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-labelledby={id}
      className={styles.detailPanel}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('dialog')) {
          event.preventDefault()
          event.stopPropagation()
          if (!pending) onClose()
        }
      }}
    >
      <div className={styles.detailPanelHead}>
        <h2 id={id}>{title}</h2>
        <IconButton tooltip={'Close ' + title} variant="tertiary" disabled={pending} onClick={onClose}>
          ×
        </IconButton>
      </div>
      <div className={styles.detailPanelBody}>{children}</div>
      {footer && <div className={styles.detailPanelFooter}>{footer}</div>}
    </section>
  )
}
