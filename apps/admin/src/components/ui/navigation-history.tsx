'use client'
import { useEffect, useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'
import { safeCmsPath } from './back-link.tsx'
import { captureCanvasDocumentOrigin } from '../../lib/canvas-document-origin.ts'
// A captured link records the source of both full-page and Next client navigation.
// The source is attached to this browser history entry, so Back/Forward retain it.
export function NavigationHistory() {
  const pathname = usePathname()
  useLayoutEffect(captureCanvasDocumentOrigin, [])
  useEffect(() => {
    try {
      const pending = JSON.parse(sessionStorage.getItem('cms.navigation.pending') ?? 'null')
      const current = window.location.pathname + window.location.search
      const from =
        pending?.to === current
          ? safeCmsPath(pending.from, window.location.origin)
          : safeCmsPath(document.referrer, window.location.origin)
      if (from && from !== current && !window.history.state?.cmsFrom)
        window.history.replaceState({ ...window.history.state, cmsFrom: from }, '')
      sessionStorage.removeItem('cms.navigation.pending')
    } catch {
      /* Navigation still has a logical-parent fallback in private mode. */
    }
  }, [pathname])
  useEffect(() => {
    function capture(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const to = safeCmsPath(link.href, window.location.origin)
      if (to)
        try {
          sessionStorage.setItem(
            'cms.navigation.pending',
            JSON.stringify({ to, from: window.location.pathname + window.location.search }),
          )
        } catch {
          /* optional convenience */
        }
    }
    document.addEventListener('click', capture, true)
    return () => document.removeEventListener('click', capture, true)
  }, [])
  return null
}
