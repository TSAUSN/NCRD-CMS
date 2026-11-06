'use client'
import { useRouter } from 'next/navigation'
import { GuardedLink } from '../guarded-link.tsx'
import { requestClientNavigation } from '../navigation-guard.ts'
import styles from './ui.module.css'
export function safeCmsPath(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin || /^\/(?:sign-in|auth|api)(?:\/|$)/.test(url.pathname)) return null
    return url.pathname + url.search + url.hash
  } catch {
    return null
  }
}
export function BackLink({ fallback = '/', appearance }: { fallback?: string; appearance?: 'button' }) {
  const router = useRouter()
  return (
    <GuardedLink
      prefetch={false}
      href={fallback}
      aria-label="Back"
      className={appearance === 'button' ? styles.button : styles.back}
      data-variant={appearance === 'button' ? 'secondary' : undefined}
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        const from = safeCmsPath(window.history.state?.cmsFrom, window.location.origin)
        if (from && from !== window.location.pathname + window.location.search) {
          event.preventDefault()
          if (requestClientNavigation(() => router.back())) router.back()
        }
      }}
    >
      ← Back
    </GuardedLink>
  )
}
