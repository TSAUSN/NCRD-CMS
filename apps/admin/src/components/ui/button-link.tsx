import type { ComponentProps } from 'react'
import { GuardedLink } from '../guarded-link.tsx'
import type { ButtonProps } from './button.tsx'
import buttonStyles from './styles/button.module.css'

/** Navigation actions share the same hierarchy, targets and focus as buttons. */
export function ButtonLink({
  variant = 'primary',
  size = 'm',
  className = '',
  ...props
}: ComponentProps<typeof GuardedLink> & Pick<ButtonProps, 'variant' | 'size'>) {
  return (
    <GuardedLink {...props} className={`${buttonStyles.button} ${className}`} data-variant={variant} data-size={size} />
  )
}
