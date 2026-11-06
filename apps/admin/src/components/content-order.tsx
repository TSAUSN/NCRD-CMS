'use client'
import { useState, type HTMLAttributes, type ReactNode } from 'react'
import { IconImage, IconDrag } from './icons.tsx'
import styles from './ui/ui.module.css'
function ContentPhoto({ src }: { src: string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  return src && src !== failed ? (
    <img src={src} alt="" onError={() => setFailed(src)} />
  ) : (
    <span role="img" aria-label="Photo unavailable">
      <IconImage size={18} />
    </span>
  )
}
/** Compact content rows keep photos, full accessible titles and actions aligned. */
export function ContentOrderRow({
  title,
  subtitle,
  photo,
  position,
  actions,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, 'title'> & {
  title: string
  subtitle: string
  photo: string | null
  position?: number
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <li {...props} className={styles.contentOrderRow + ' ' + (props.className ?? '')}>
      <span className={styles.contentOrderPosition}>
        <IconDrag size={12} />
        {position}
      </span>
      <span className={styles.contentOrderPhoto}>
        <ContentPhoto src={photo} />
      </span>
      <span className={styles.contentOrderWords}>
        <strong title={title}>{title}</strong>
        <small>{subtitle}</small>
        {children}
      </span>
      {actions && <span className={styles.contentOrderActions}>{actions}</span>}
    </li>
  )
}
export function ContentOrderList({ children, ...props }: HTMLAttributes<HTMLOListElement>) {
  return (
    <ol {...props} className={styles.contentOrderList + ' ' + (props.className ?? '')}>
      {children}
    </ol>
  )
}
export function ContentPreviewCards({
  rows,
}: {
  rows: { id: string; title: string; photo: string | null; position?: number }[]
}) {
  return (
    <ol className={styles.contentPreviewGrid} aria-label="Newsroom visitor preview">
      {rows.map(row => (
        <li key={row.id}>
          <div className={styles.contentPreviewPhoto}>
            <ContentPhoto src={row.photo} />
            {row.position && <span>{row.position}</span>}
          </div>
          <strong>{row.title}</strong>
        </li>
      ))}
    </ol>
  )
}
