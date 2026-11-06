import type { ReactNode } from 'react'
import { IconButton } from './button.tsx'
import styles from './ui.module.css'
import state from '../state.module.css'
import { IconPage } from '../icons.tsx'
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className={styles.empty + ' ' + state.state}>
      <span aria-hidden="true">
        <IconPage size={24} />
      </span>
      <h2>{title}</h2>
      <div>{children}</div>
      {action}
    </section>
  )
}
export function Toast({ children, error, onDismiss }: { children: ReactNode; error?: boolean; onDismiss: () => void }) {
  return (
    <div className={styles.toast} role={error ? 'alert' : 'status'}>
      {children}
      <IconButton tooltip="Dismiss notification" variant="tertiary" onClick={onDismiss}>
        ×
      </IconButton>
    </div>
  )
}

export function Note({
  children,
  icon,
  tone,
}: {
  children: ReactNode
  icon?: ReactNode
  tone?: 'success' | 'warning' | 'shared' | 'info'
}) {
  return (
    <p role="note" data-tone={tone} className={styles.note}>
      {icon}
      <span>{children}</span>
    </p>
  )
}
