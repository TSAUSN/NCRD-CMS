import type { ReactNode } from 'react'
import styles from './feedback-styles.module.css'
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
