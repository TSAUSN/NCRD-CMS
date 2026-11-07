'use client'

import type { ComponentProps, MouseEvent } from 'react'
import { requestClientNavigation } from './navigation-guard.ts'
import { startNavigationProgress } from './shell/navigation-progress.tsx'

export type DocumentLinkProps = Omit<ComponentProps<'a'>, 'href'> & {
  href: string
  replace?: boolean
  onDraftLeave?: () => void
  onNavigate?: (event: { preventDefault: () => void }) => void
}

function sameTab(event: MouseEvent<HTMLAnchorElement>) {
  const link = event.currentTarget
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) &&
    (!link.target || link.target.toLowerCase() === '_self') &&
    !link.hasAttribute('download') &&
    new URL(link.href).origin === window.location.origin
  )
}

type Navigation = Pick<DocumentLinkProps, 'replace' | 'onDraftLeave' | 'onNavigate'>

/** Run the same leave guard before any editor link opens a full document. */
export function openGuardedDocument(href: string, { onNavigate, onDraftLeave, replace }: Navigation) {
  const source = window.location.href
  const navigate = () => {
    if (window.location.href !== source) return
    let canceled = false
    onNavigate?.({ preventDefault: () => (canceled = true) })
    if (canceled) return
    startNavigationProgress(href)
    if (replace) window.location.replace(href)
    else window.location.assign(href)
  }
  // A completed Save or Discard can enqueue a React state change.
  // Let its existing beforeunload listener observe the committed draft
  // before opening the document. Any fresh dirty edit still warns.
  const resume = () => window.requestAnimationFrame(() => window.setTimeout(navigate, 0))
  if (requestClientNavigation(resume, onDraftLeave)) navigate()
}

/** Open a document so its response can set the canvas frame policy. */
export function DocumentLink({ onClick, onNavigate, onDraftLeave, replace, ...props }: DocumentLinkProps) {
  return (
    <a
      {...props}
      onClick={event => {
        onClick?.(event)
        if (!sameTab(event)) return
        event.preventDefault()
        openGuardedDocument(event.currentTarget.href, { onNavigate, onDraftLeave, replace })
      }}
    />
  )
}
