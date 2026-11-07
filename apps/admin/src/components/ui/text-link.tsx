import type { ComponentProps } from 'react'
import { GuardedLink } from '../guarded-link.tsx'
import styles from './text-link-styles.module.css'

/** A quiet chrome link with the same navigation guard and focus treatment. */
export function TextLink({ className = '', ...props }: ComponentProps<typeof GuardedLink>) {
  return <GuardedLink {...props} className={`${styles.textLink} ${className}`} />
}
