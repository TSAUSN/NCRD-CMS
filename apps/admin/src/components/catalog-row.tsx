import type { HTMLAttributes, ReactNode } from 'react'
import styles from './catalog-row.module.css'
export function CatalogList({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul {...props} className={className ? styles.list + ' ' + className : styles.list} />
}
/** A shared compact catalog row, with stable columns at both admin widths. */
export function CatalogRow({
  leading,
  title,
  description,
  meta,
  actions,
  descriptionWrap = false,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, 'title'> & {
  leading: ReactNode
  title: ReactNode
  description: ReactNode
  meta: ReactNode
  actions: ReactNode
  descriptionWrap?: boolean
}) {
  return (
    <li {...props} className={styles.row} data-description={descriptionWrap ? 'wrap' : undefined}>
      <div className={styles.leading}>{leading}</div>
      <div className={styles.title}>{title}</div>
      <div className={styles.description}>{description}</div>
      <div className={styles.meta}>{meta}</div>
      <div className={styles.actions}>{actions}</div>
    </li>
  )
}
