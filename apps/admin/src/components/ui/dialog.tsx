'use client'
import { useLayoutEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { IconButton } from './button.tsx'
import surfaceControlsStyles from './styles/surface-controls.module.css'
import ownedStyles from './dialog-styles.module.css'
export function Dialog({
  title,
  children,
  footer,
  onClose,
  pending,
  density,
  drawer = false,
  size = 'standard',
  closeLabel,
  role,
  showClose = true,
  initialFocus,
}: {
  density?: 'compact'
  initialFocus?: RefObject<HTMLElement | null>
  showClose?: boolean
  role?: 'dialog' | 'alertdialog'
  closeLabel?: string
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  pending?: boolean
  drawer?: boolean
  size?: 'standard' | 'medium' | 'wide' | 'narrow' | 'large'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    const opener = document.activeElement
    const dialog = ref.current
    dialog?.showModal()
    const focus = initialFocus ? requestAnimationFrame(() => initialFocus.current?.focus()) : null
    return () => {
      if (focus !== null) cancelAnimationFrame(focus)
      dialog?.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      data-density={density}
      role={role}
      aria-labelledby={id}
      className={`${surfaceControlsStyles.modal} ${footer || drawer ? surfaceControlsStyles.fixed : ''} ${drawer ? ownedStyles.drawer : ''} ${size === 'wide' ? ownedStyles.wide : size === 'medium' ? ownedStyles.medium : size === 'narrow' ? ownedStyles.narrow : size === 'large' ? ownedStyles.large : ''}`}
      onKeyDown={event => {
        if (event.key !== 'Tab' || event.defaultPrevented) return
        const focusable = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button,a[href],input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]',
          ),
        ].filter(
          node =>
            !node.matches(':disabled') &&
            node.tabIndex >= 0 &&
            node.getClientRects().length > 0 &&
            !node.closest('[inert]'),
        )
        const first = focusable[0]
        const last = focusable.at(-1)
        if (!first || !last) {
          event.preventDefault()
          return
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
      onCancel={event => {
        event.preventDefault()
        if (!pending) onClose()
      }}
      onClick={event => {
        if (event.target === event.currentTarget && !pending) {
          const box = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose()
        }
      }}
    >
      <div className={surfaceControlsStyles.modalHead}>
        <h2 id={id}>{title}</h2>
        {showClose && (
          <IconButton tooltip={closeLabel ?? `Close ${title}`} variant="tertiary" disabled={pending} onClick={onClose}>
            ×
          </IconButton>
        )}
      </div>
      <div className={surfaceControlsStyles.modalBody}>{children}</div>
      {footer && <div className={surfaceControlsStyles.modalFooter}>{footer}</div>}
    </dialog>
  )
}
export function Drawer(props: Omit<Parameters<typeof Dialog>[0], 'drawer'>) {
  return <Dialog {...props} drawer />
}
