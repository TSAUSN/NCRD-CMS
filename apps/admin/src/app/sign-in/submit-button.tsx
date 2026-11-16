'use client'

import { useFormStatus } from 'react-dom'

export function SignInButton({
  label,
  disabled = false,
  formAction,
  microsoft = false,
}: {
  label: string
  disabled?: boolean
  microsoft?: boolean
  /** A second way to send the same form. It skips the browser's field checks; the server still checks. */
  formAction?: (formData: FormData) => void | Promise<void>
}) {
  const { pending } = useFormStatus()
  if (formAction)
    return (
      <button type="submit" className="secondary large wide" formAction={formAction} formNoValidate disabled={pending}>
        {label}
      </button>
    )
  return (
    <button type="submit" className="large wide" disabled={disabled || pending}>
      {microsoft && (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M1 1h8v8H1zM11 1h8v8h-8zM1 11h8v8H1zM11 11h8v8h-8z" />
        </svg>
      )}
      {pending ? 'Please wait…' : label}
    </button>
  )
}
