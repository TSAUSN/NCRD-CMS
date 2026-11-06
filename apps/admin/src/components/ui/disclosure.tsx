import type { ComponentProps, ReactNode } from 'react'
import { IconChevronRight } from '../icons.tsx'
import styles from './ui.module.css'

/** Shared native disclosure,with one controlled chrome style and keyboard behavior. */
export function Disclosure({
  title,
  children,
  className,
  summaryProps,
  ...props
}: Omit<ComponentProps<'details'>, 'title'> & { title: ReactNode; summaryProps?: ComponentProps<'summary'> }) {
  return (
    <details {...props} className={styles.disclosure + (className ? ' ' + className : '')}>
      <summary {...summaryProps}>
        <IconChevronRight size={16} />
        <span>{title}</span>
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  )
}
