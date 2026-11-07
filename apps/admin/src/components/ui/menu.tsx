'use client'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import buttonStyles from './styles/button.module.css'
import ownedStyles from './menu-styles.module.css'
export function Menu({
  label,
  children,
  accessibleLabel,
  boundary,
  avoid,
  appearance,
}: {
  label: ReactNode
  children: ReactNode
  accessibleLabel?: string
  appearance?: 'button'
  boundary?: RefObject<HTMLElement | null>
  avoid?: RefObject<HTMLElement | null>
}) {
  const ref = useRef<HTMLDetailsElement>(null),
    body = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ top: number; left: number; height: number; width: number } | null>(null)
  function close(restoreFocus = false) {
    ref.current?.removeAttribute('open')
    if (body.current?.matches(':popover-open')) body.current.hidePopover()
    if (restoreFocus) ref.current?.querySelector('summary')?.focus()
  }
  function position() {
    if (!body.current) return
    if (!ref.current?.open) {
      if (body.current.matches(':popover-open')) body.current.hidePopover()
      return
    }
    // The browser's top layer escapes scroll containers such as the Pages table.
    if (!body.current.matches(':popover-open')) body.current.showPopover()
    const anchor = ref.current.querySelector('summary')!.getBoundingClientRect(),
      bounds = boundary?.current?.getBoundingClientRect() ?? {
        top: 0,
        bottom: innerHeight,
        width: innerWidth,
        left: 0,
        right: innerWidth,
      }
    const gap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-2')) || 0
    const popup = body.current.getBoundingClientRect(),
      width = Math.max(0, bounds.width - gap * 2),
      popupWidth = Math.min(popup.width, width)
    const left = Math.max(bounds.left + gap, Math.min(anchor.right - popupWidth, bounds.right - gap - popupWidth))
    const obstruction = avoid?.current?.getBoundingClientRect()
    const bottom =
      obstruction && obstruction.left < left + popupWidth && obstruction.right > left
        ? Math.min(bounds.bottom, obstruction.top)
        : bounds.bottom
    // A table can move its trigger while another tab's saved data refreshes it.
    // Keep the top-layer actions reachable even when that trigger leaves view.
    const limitTop = Math.max(0, bounds.top) + gap,
      limitBottom = Math.max(limitTop, Math.min(innerHeight, bottom) - gap)
    const anchorTop = Math.max(limitTop, Math.min(anchor.top, limitBottom)),
      anchorBottom = Math.max(limitTop, Math.min(anchor.bottom, limitBottom))
    const below = Math.max(0, limitBottom - anchorBottom - gap),
      above = Math.max(0, anchorTop - limitTop - gap),
      up = body.current.scrollHeight > below && above > below,
      height = up ? above : below
    const popupHeight = Math.min(body.current.scrollHeight, height)
    const top = Math.max(
      limitTop,
      Math.min(up ? anchorTop - gap - popupHeight : anchorBottom + gap, limitBottom - popupHeight),
    )
    const next = { top, left, height, width }
    setPlacement(previous =>
      previous &&
      previous.top === top &&
      previous.left === left &&
      previous.height === height &&
      previous.width === width
        ? previous
        : next,
    )
  }
  useLayoutEffect(() => {
    position()
  })
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [boundary, avoid])
  const popupStyle: CSSProperties = placement
    ? {
        top: placement.top,
        left: placement.left,
        maxHeight: placement.height,
        maxWidth: placement.width,
        overflowY: 'auto',
      }
    : {}
  return (
    <details
      ref={ref}
      className={ownedStyles.menu}
      onToggle={position}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
          ref.current?.querySelector('summary')?.focus()
        }
      }}
    >
      <summary
        className={appearance === 'button' ? buttonStyles.button : undefined}
        data-variant={appearance === 'button' ? 'secondary' : undefined}
        role="button"
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        {label}
      </summary>
      <div
        ref={body}
        popover="manual"
        style={popupStyle}
        className={ownedStyles.menuBody}
        onClick={event => {
          if ((event.target as Element)?.closest('a,button')) close(true)
        }}
      >
        {children}
      </div>
    </details>
  )
}
