'use client'

import type { ComponentProps, MouseEvent } from 'react'
import { requestClientNavigation } from './navigation-guard.ts'

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

/** Open a document so its response can set the canvas frame policy. */
export function DocumentLink({ onClick, onNavigate, onDraftLeave, replace, ...props }: DocumentLinkProps) {
  return (
    <a
      {...props}
      onClick={event => {
        onClick?.(event)
        if (!sameTab(event)) return
        const href = event.currentTarget.href
        const source = window.location.href
        const navigate = () => {
          if (window.location.href !== source) return
          let canceled = false
          onNavigate?.({ preventDefault: () => (canceled = true) })
          if (canceled) return
          if (replace) window.location.replace(href)
          else window.location.assign(href)
        }
        // A completed Save or Discard can enqueue a React state change.
        // Let its existing beforeunload listener observe the committed draft
        // before opening the document. Any fresh dirty edit still warns.
        const resume = () => window.requestAnimationFrame(() => window.setTimeout(navigate, 0))
        event.preventDefault()
        if (requestClientNavigation(resume, onDraftLeave)) navigate()
      }}
    />
  )
}
