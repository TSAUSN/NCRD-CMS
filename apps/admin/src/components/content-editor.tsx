'use client'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Button } from './ui/button.tsx'
import { IconChevronLeft } from './icons.tsx'
import styles from './content-editor.module.css'
/** Shared writing workspace: one action bar, content first, supporting fields right. */
export function ContentEditor({
  locationLabel,
  title,
  status,
  actions,
  onBack,
  pending,
  children,
  aside,
  notice,
}: {
  locationLabel: string
  title: string
  status: ReactNode
  actions: ReactNode
  onBack: () => void
  pending: boolean
  children: ReactNode
  aside: ReactNode
  notice?: ReactNode
}) {
  return (
    <main id="main" className={styles.screen}>
      <header className={styles.bar}>
        <div className={styles.identity}>
          <Button variant="secondary" size="standard" onClick={onBack} disabled={pending}>
            <IconChevronLeft size={16} />
            Back
          </Button>
          <div className={styles.location}>
            <span>{locationLabel}</span>
            <h1 title={title}>{title}</h1>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={styles.saved} aria-live="polite">
            {status}
          </span>
          {actions}
        </div>
      </header>
      {notice && <div className={styles.notice}>{notice}</div>}
      <LargeScreenEditing notice>
        <div className={styles.grid}>
          <div className={styles.content}>{children}</div>
          {aside}
        </div>
      </LargeScreenEditing>
    </main>
  )
}

/** Keep editing state mounted when a narrow screen only offers save and status. */
export function LargeScreenEditing({ children, notice = false }: { children: ReactNode; notice?: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = container.current
    if (!host) return
    const narrow = window.matchMedia('(max-width:767px)')
    const paused = new Map<HTMLDialogElement, Element | null>()
    function syncDialogs() {
      if (narrow.matches) {
        for (const dialog of host!.querySelectorAll<HTMLDialogElement>('dialog[open]')) {
          if (!dialog.matches(':modal')) continue
          paused.set(dialog, document.activeElement)
          dialog.close()
        }
      } else {
        const choices = [...paused]
        paused.clear()
        for (const [dialog, focus] of choices) {
          if (!dialog.isConnected || dialog.open) continue
          dialog.showModal()
          if (focus instanceof HTMLElement && focus.isConnected) focus.focus()
        }
      }
    }
    const observer = new MutationObserver(syncDialogs)
    observer.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    narrow.addEventListener('change', syncDialogs)
    syncDialogs()
    return () => {
      observer.disconnect()
      narrow.removeEventListener('change', syncDialogs)
    }
  }, [])
  return (
    <>
      {notice && <p className={styles.small}>Use a larger screen to edit.</p>}
      <div ref={container} className={styles.largeScreen}>
        {children}
      </div>
    </>
  )
}
