'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps } from 'react'
import { canvasRoute } from '../lib/canvas-route.ts'
import { DocumentLink } from './document-link.tsx'
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
  replace,
  scroll,
  ...props
}: ComponentProps<typeof NextLink> & { onDraftLeave?: () => void }) {
  const router = useRouter()
  if (
    typeof props.href === 'string' &&
    props.href.startsWith('/') &&
    !props.href.startsWith('//') &&
    canvasRoute(props.href.split(/[?#]/, 1)[0]!)
  ) {
    return (
      <DocumentLink
        {...props}
        href={props.href}
        replace={replace}
        onNavigate={onNavigate}
        onDraftLeave={onDraftLeave}
      />
    )
  }
  const resume = () => {
    let canceled = false
    onNavigate?.({
      preventDefault: () => {
        canceled = true
      },
    })
    if (!canceled && typeof props.href === 'string') {
      const options = { scroll }
      if (replace) router.replace(props.href, options)
      else router.push(props.href, options)
    }
  }
  return (
    <NextLink
      {...props}
      prefetch={prefetch}
      replace={replace}
      scroll={scroll}
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
