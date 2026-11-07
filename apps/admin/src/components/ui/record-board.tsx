'use client'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import styles from './record-board-styles.module.css'
/** A list scrolls in its own space;its commands never cover the last record. */
export function RecordBoard({
  label,
  children,
  footer,
  footerLabel,
}: {
  label: string
  children: ReactNode
  footer: ReactNode
  footerLabel?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = root.current
    if (!node) return
    let frame = 0
    const measure = () =>
        node.style.setProperty(
          '--record-board-available',
          Math.max(160, window.innerHeight - Math.max(0, node.getBoundingClientRect().top) - 16) + 'px',
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
  return (
    <div ref={root} className={styles.recordBoard}>
      <div role="region" aria-label={label} tabIndex={0} className={styles.recordBoardBody}>
        {children}
      </div>
      <div role="region" aria-label={footerLabel ?? label + ' commands'} className={styles.recordCommands}>
        {footer}
      </div>
    </div>
  )
}
