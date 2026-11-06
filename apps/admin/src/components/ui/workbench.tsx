import type { ReactNode } from 'react'
import { ResizablePanel } from './resizable-panel.tsx'
import styles from '../workspace.module.css'
/** Shared list/detail frame for review queues and administrative task queues. */
export function Workbench({
  queue,
  children,
  queueLabel,
  storageKey,
  className = '',
  density,
}: {
  queue: ReactNode
  children: ReactNode
  queueLabel: string
  storageKey: string
  className?: string
  density?: 'compact'
}) {
  return (
    <div data-density={density} className={`${styles.workbenchFull} ${className}`}>
      <ResizablePanel
        label={queueLabel}
        storageKey={storageKey}
        edge="right"
        reserveSpace={density === 'compact' ? 500 : 0}
        min={240}
        max={360}
        initial={300}
        className={styles.workbenchQueue + ' review-queue'}
      >
        {queue}
      </ResizablePanel>
      <section className={styles.workbenchMain + ' review-detail'} aria-live="polite">
        {children}
      </section>
    </div>
  )
}
