import type { ChangeEventHandler, ReactNode } from 'react'
import { IconSearch } from '../icons.tsx'
import styles from './search-field-styles.module.css'
export function SearchField({
  id,
  label,
  value,
  onChange,
  placeholder = label,
  actions,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: ChangeEventHandler<HTMLInputElement>
  placeholder?: string
  actions?: ReactNode
  disabled?: boolean
}) {
  if (actions)
    return (
      <div className={styles.searchField}>
        <IconSearch size={14} />
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          type="search"
          disabled={disabled}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete="off"
        />
        {actions}
      </div>
    )
  return (
    <label className={styles.searchField} htmlFor={id}>
      <IconSearch size={14} />
      <span className="sr-only">{label}</span>
      <input id={id} type="search" disabled={disabled} value={value} onChange={onChange} placeholder={placeholder} />
    </label>
  )
}
