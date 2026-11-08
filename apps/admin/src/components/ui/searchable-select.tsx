'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { Field } from './field.tsx'
/** One native chooser keeps title/address search and a validated saved choice together. */
export function SearchableSelect({
  id,
  label,
  value,
  options,
  onChange,
  help,
  required,
  disabled,
  autoFocus,
}: {
  id: string
  label: ReactNode
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
  help?: ReactNode
  required?: boolean
  disabled?: boolean
  autoFocus?: boolean
}) {
  const selected = options.find(option => option.value === value)?.label ?? ''
  const [query, setQuery] = useState(selected)
  useEffect(() => {
    if (value) setQuery(selected)
  }, [value, selected])
  const shown = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <Field
      id={id}
      label={label}
      help={query && !shown.length ? 'No matching choices. Try another search.' : help}
      required={required}
    >
      <input
        type="text"
        list={id + '-choices'}
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-autocomplete="list"
        onChange={event => {
          const text = event.target.value
          setQuery(text)
          onChange(options.find(option => option.label === text)?.value ?? '')
        }}
      />
      <datalist id={id + '-choices'}>
        {shown.map(option => (
          <option key={option.value} value={option.label} />
        ))}
      </datalist>
    </Field>
  )
}
