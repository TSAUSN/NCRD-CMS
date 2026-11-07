'use client'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import styles from './resizable-panel-styles.module.css'
export function clampPanelWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
export function ResizablePanel({
  storageKey,
  label,
  min,
  max,
  initial,
  reserveSpace = 0,
  edge = 'left',
  children,
  className = '',
  onWidthChange,
}: {
  storageKey: string
  label: string
  min: number
  max: number
  initial: number
  reserveSpace?: number
  edge?: 'left' | 'right'
  children: ReactNode
  className?: string
  onWidthChange?: (width: number) => void
}) {
  const [width, setWidth] = useState(initial),
    [available, setAvailable] = useState<number | null>(null)
  const host = useRef<HTMLDivElement>(null),
    limit = !reserveSpace || available === null ? max : Math.max(min, Math.min(max, available - reserveSpace)),
    currentWidth = clampPanelWidth(width, min, limit)
  useEffect(() => {
    if (!reserveSpace) return
    const parent = host.current?.parentElement
    if (!parent) return
    const measure = () => setAvailable(parent.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [reserveSpace])
  const drag = useRef<{ x: number; width: number } | null>(null)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null && Number.isFinite(Number(saved))) setWidth(clampPanelWidth(Number(saved), min, limit))
    } catch {
      /* optional */
    }
  }, [storageKey, min, limit])
  useEffect(() => {
    onWidthChange?.(currentWidth)
  }, [currentWidth, onWidthChange])
  function update(value: number) {
    const next = clampPanelWidth(value, min, limit)
    setWidth(next)
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      /* optional */
    }
  }
  return (
    <div
      ref={host}
      role="group"
      className={`${styles.panel} ${className}`}
      data-edge={edge}
      style={{ width: currentWidth } as CSSProperties}
      aria-label={label}
    >
      <div
        className={styles.handle}
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${label}`}
        aria-orientation="vertical"
        aria-valuenow={Math.round(currentWidth)}
        aria-valuemin={min}
        aria-valuemax={limit}
        onDoubleClick={() => update(initial)}
        onKeyDown={event => {
          const value =
            event.key === 'Home'
              ? min
              : event.key === 'End'
                ? limit
                : event.key === 'ArrowLeft'
                  ? currentWidth + (edge === 'left' ? 16 : -16)
                  : event.key === 'ArrowRight'
                    ? currentWidth + (edge === 'left' ? -16 : 16)
                    : null
          if (value !== null) {
            event.preventDefault()
            update(value)
          }
        }}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, width: currentWidth }
        }}
        onPointerMove={event => {
          if (drag.current) update(drag.current.width + (event.clientX - drag.current.x) * (edge === 'left' ? -1 : 1))
        }}
        onPointerUp={event => {
          drag.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      />
      {children}
    </div>
  )
}
