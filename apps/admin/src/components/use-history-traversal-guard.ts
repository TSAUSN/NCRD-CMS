'use client'

import { useEffect, useState } from 'react'
import { guardHistoryTraversal, type HistoryTraversalEvent } from '../lib/browser-traversal.ts'
import { confirmClientNavigation } from './navigation-guard.ts'

/** Never insert sentinel history entries or repair Next's internal history.
 * Supported, cancelable traversals use the existing committed guard registry. */
export function useHistoryTraversalGuard(): boolean {
  const [limited, setLimited] = useState(true)
  useEffect(() => {
    const navigation = (window as Window & { navigation?: EventTarget }).navigation
    if (!navigation) return
    setLimited(false)
    const onNavigate = (event: Event) => {
      if (
        guardHistoryTraversal(
          event as unknown as HistoryTraversalEvent,
          window.location.href,
          confirmClientNavigation,
        ) === 'unavailable'
      )
        setLimited(true)
    }
    navigation.addEventListener('navigate', onNavigate)
    return () => navigation.removeEventListener('navigate', onNavigate)
  }, [])
  return limited
}
