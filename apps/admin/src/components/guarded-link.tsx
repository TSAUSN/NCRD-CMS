'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps } from 'react'
import { canvasRoute } from '../lib/canvas-route.ts'
import { DocumentLink, openGuardedDocument } from './document-link.tsx'
import { canvasDocumentOrigin } from '../lib/canvas-document-origin.ts'
import { startNavigationProgress } from './shell/navigation-progress.tsx'
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
  editorCanvasOrigin,
  prefetch = false,
  replace,
  scroll,
  ...props
}: ComponentProps<typeof NextLink> & { onDraftLeave?: () => void; editorCanvasOrigin?: string | null }) {
  const router = useRouter()
  const route =
    typeof props.href === 'string' && props.href.startsWith('/') && !props.href.startsWith('//')
      ? canvasRoute(props.href.split(/[?#]/, 1)[0]!)
      : null
  if (route && route.kind !== 'page' && typeof props.href === 'string') {
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
      startNavigationProgress(props.href)
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
        // Same-document Back can keep the existing draft confirmation. Only
        // leave this document when a verified editor destination needs a
        // different frame policy. Unknown destinations retain the reload fallback.
        if (
          route?.kind === 'page' &&
          editorCanvasOrigin &&
          editorCanvasOrigin !== canvasDocumentOrigin() &&
          typeof props.href === 'string'
        ) {
          event.preventDefault()
          openGuardedDocument(new URL(props.href, window.location.href).href, { onNavigate, onDraftLeave, replace })
          return
        }
        if (
          !(typeof props.href === 'string' ? requestClientNavigation(resume, onDraftLeave) : confirmClientNavigation())
        ) {
          event.preventDefault()
          return
        }
        onNavigate?.(event)
        // Next exposes cancellation only to its own Link. Keep the caller's
        // event intact and let the route fallback handle custom navigation.
        if (!onNavigate && typeof props.href === 'string') startNavigationProgress(props.href)
      }}
    />
  )
}
