'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps } from 'react'
import { confirmClientNavigation, requestClientNavigation } from './navigation-guard.ts'

/**
 * Next's onNavigate runs for same-tab client navigation, unlike onClick which
 * also runs for new-tab modifier clicks and downloads. This does not intercept
 * browser Back/Forward or arbitrary router.push calls. Saves and session
 * renewal invalidate unused workspace snapshots; load them on navigation
 * instead of leaving background prefetches to be canceled during editing.
 */
export function GuardedLink({
  onNavigate,
  onDraftLeave,
  prefetch = false,
  ...props
}: ComponentProps<typeof NextLink> & { onDraftLeave?: () => void }) {
  const router = useRouter()
  const resume = () => {
    let canceled = false
    onNavigate?.({
      preventDefault: () => {
        canceled = true
      },
    })
    if (!canceled && typeof props.href === 'string') {
      const options = { scroll: props.scroll }
      if (props.replace) router.replace(props.href, options)
      else router.push(props.href, options)
    }
  }
  return (
    <NextLink
      {...props}
      prefetch={prefetch}
      onNavigate={event => {
        if (
          !(typeof props.href === 'string' ? requestClientNavigation(resume, onDraftLeave) : confirmClientNavigation())
        ) {
          event.preventDefault()
          return
        }
        onNavigate?.(event)
      }}
    />
  )
}
