'use client'
import { useState, type ComponentProps } from 'react'
import styles from './password-input.module.css'

/** Reveal only on an explicit request; keep the same input and form value. */
export function PasswordInput({ id, ...props }: Omit<ComponentProps<'input'>, 'type'> & { id: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className={styles.control}>
      <input {...props} id={id} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="ghost small"
        aria-controls={id}
        aria-pressed={visible}
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible(current => !current)}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
