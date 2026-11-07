import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import surfaceControlsStyles from './styles/surface-controls.module.css'
import ownedStyles from './field-styles.module.css'
export function Field({
  id,
  label,
  help,
  helpAfter = false,
  counter,
  error,
  required,
  density,
  labelHidden = false,
  className = '',
  children,
}: {
  id: string
  label: ReactNode
  className?: string
  density?: 'compact'
  labelHidden?: boolean
  help?: ReactNode
  helpAfter?: boolean
  counter?: ReactNode
  error?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={surfaceControlsStyles.field + (className ? ' ' + className : '')}
      data-density={density}
      data-label-hidden={labelHidden || undefined}
    >
      {counter !== undefined ? (
        <div className={ownedStyles.fieldLabel}>
          <label id={`${id}-label`} htmlFor={id}>
            {label}
            {required && (
              <>
                {'\u00a0'}
                <span aria-label="required">*</span>
              </>
            )}
          </label>
          <span className={surfaceControlsStyles.help} id={`${id}-counter`}>
            {counter}
          </span>
        </div>
      ) : (
        <label id={`${id}-label`} htmlFor={id}>
          {label}
          {required && (
            <>
              {'\u00a0'}
              <span aria-label="required">*</span>
            </>
          )}
        </label>
      )}
      {help && !helpAfter && (
        <p className={surfaceControlsStyles.help} id={`${id}-help`}>
          {help}
        </p>
      )}
      {Children.map(children, child => {
        if (!isValidElement(child) || !['input', 'textarea', 'select'].includes(String(child.type))) return child
        const control = child as ReactElement<Record<string, unknown>>
        const descriptions = [
          ...new Set(
            [
              control.props['aria-describedby'],
              counter !== undefined && `${id}-counter`,
              help && `${id}-help`,
              error && `${id}-error`,
            ].filter(Boolean),
          ),
        ].join(' ')
        return cloneElement(control, {
          id,
          'aria-describedby': descriptions || undefined,
          'aria-invalid': error ? true : control.props['aria-invalid'],
          required: required || control.props.required,
        })
      })}
      {help && helpAfter && (
        <p className={surfaceControlsStyles.help} id={`${id}-help`}>
          {help}
        </p>
      )}
      {error && (
        <p className={ownedStyles.error} id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
