import type { ReactNode } from 'react'
import { ResizablePanel } from './resizable-panel.tsx'
import reviewWorkbenchStyles from '../workspace-styles/review-workbench.module.css'
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
    <div data-density={density} className={`${reviewWorkbenchStyles.workbenchFull} ${className}`}>
      <ResizablePanel
        label={queueLabel}
        storageKey={storageKey}
        edge="right"
        reserveSpace={density === 'compact' ? 500 : 0}
        min={240}
        max={360}
        initial={300}
        className={reviewWorkbenchStyles.workbenchQueue + ' review-queue'}
      >
        {queue}
      </ResizablePanel>
      <section className={reviewWorkbenchStyles.workbenchMain + ' review-detail'} aria-live="polite">
        {children}
      </section>
    </div>
  )
}
