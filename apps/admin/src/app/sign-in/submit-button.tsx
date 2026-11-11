'use client'

import { useFormStatus } from 'react-dom'

export function SignInButton({
  label,
  disabled = false,
  formAction,
}: {
  label: string
  disabled?: boolean
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
      {pending ? 'Please wait…' : label}
    </button>
  )
}
