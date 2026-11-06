import type { ComponentProps } from 'react'
import { GuardedLink } from '../guarded-link.tsx'
import type { ButtonProps } from './button.tsx'
import styles from './ui.module.css'

/** Navigation actions share the same hierarchy, targets and focus as buttons. */
export function ButtonLink({
  variant = 'primary',
  size = 'm',
  className = '',
  ...props
}: ComponentProps<typeof GuardedLink> & Pick<ButtonProps, 'variant' | 'size'>) {
  return <GuardedLink {...props} className={`${styles.button} ${className}`} data-variant={variant} data-size={size} />
}
