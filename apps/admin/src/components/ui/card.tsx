import type { HTMLAttributes, ReactNode } from 'react'
import surfaceControlsStyles from './styles/surface-controls.module.css'
import ownedStyles from './card-styles.module.css'
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
      className={`${surfaceControlsStyles.card} ${className}`}
      data-tone={tone}
      data-density={density}
    >
      {title &&
        (headerActions || description ? (
          <div className={surfaceControlsStyles.cardHeading}>
            <div>
              <h2>{title}</h2>
              {description && <p>{description}</p>}
            </div>
            {headerActions && <div className={ownedStyles.cardHeadingActions}>{headerActions}</div>}
          </div>
        ) : (
          <h2>{title}</h2>
        ))}
      <div className={surfaceControlsStyles.cardBody}>{children}</div>
      {actions && <div className={surfaceControlsStyles.actions}>{actions}</div>}
    </section>
  )
}

/** Composable card regions keep complex forms on the same spacing and type. */
export function CardHeading({ children }: { children: ReactNode }) {
  return <header className={surfaceControlsStyles.cardHeading}>{children}</header>
}
export function CardContent({ children }: { children: ReactNode }) {
  return <div className={ownedStyles.cardContent}>{children}</div>
}
