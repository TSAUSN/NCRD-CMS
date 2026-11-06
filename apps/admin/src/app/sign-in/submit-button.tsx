'use client'

import { useFormStatus } from 'react-dom'

export function SignInButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="large wide" disabled={disabled || pending}>
      {pending ? 'Please wait…' : label}
    </button>
  )
}
