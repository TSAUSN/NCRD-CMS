import type { ReactNode } from 'react'
import styles from './action-note-styles.module.css'
/** Short consequences belong beside the actions, after the task itself. */
export function ActionNote({ children }: { children: ReactNode }) {
  return <p className={styles.actionNote}>{children}</p>
}
