import type { ComponentProps } from 'react'
import styles from './ui.module.css'
export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'publish'
  size?: 's' | 'm' | 'compact' | 'standard'
  loading?: boolean
  fullWidth?: boolean
}
export function Button({
  variant = 'primary',
  size = 'm',
  loading,
  fullWidth,
  disabled,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`${styles.button} ${className}`}
      data-variant={variant}
      data-size={size}
      data-full-width={fullWidth || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    />
  )
}
export function IconButton({
  tooltip,
  className = '',
  ...props
}: Omit<ButtonProps, 'title' | 'aria-label'> & { tooltip: string }) {
  return <Button {...props} className={`${styles.icon} ${className}`} title={tooltip} aria-label={tooltip} />
}
