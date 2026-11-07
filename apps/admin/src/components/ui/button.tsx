import type { ComponentProps } from 'react'
import buttonStyles from './styles/button.module.css'
import ownedStyles from './button-styles.module.css'
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
      className={`${buttonStyles.button} ${className}`}
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
  return <Button {...props} className={`${ownedStyles.icon} ${className}`} title={tooltip} aria-label={tooltip} />
}
