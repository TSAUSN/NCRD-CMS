import type { HTMLAttributes, ReactNode } from 'react'
import styles from './ui.module.css'
export function Card({
  title,
  children,
  actions,
  headerActions,
  description,
  tone,
  density,
  className = '',
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title?: ReactNode
  description?: ReactNode
  headerActions?: ReactNode
  actions?: ReactNode
  tone?: 'danger'
  density?: 'compact' | 'settings' | 'summary' | 'catalog' | 'editor'
}) {
  return (
    <section
      aria-label={typeof title === 'string' ? title : undefined}
      {...props}
      className={`${styles.card} ${className}`}
      data-tone={tone}
      data-density={density}
    >
      {title &&
        (headerActions || description ? (
          <div className={styles.cardHeading}>
            <div>
              <h2>{title}</h2>
              {description && <p>{description}</p>}
            </div>
            {headerActions && <div className={styles.cardHeadingActions}>{headerActions}</div>}
          </div>
        ) : (
          <h2>{title}</h2>
        ))}
      <div className={styles.cardBody}>{children}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </section>
  )
}

/** Composable card regions keep complex forms on the same spacing and type. */
export function CardHeading({ children }: { children: ReactNode }) {
  return <header className={styles.cardHeading}>{children}</header>
}
export function CardContent({ children }: { children: ReactNode }) {
  return <div className={styles.cardContent}>{children}</div>
}
