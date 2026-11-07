'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import styles from './navigation-progress.module.css'

const id = 'cms-navigation-progress'
let timer: number | undefined

function clear() {
  window.clearTimeout(timer)
  const bar = document.getElementById(id)
  if (bar) bar.hidden = true
}

/** Only a confirmed, same-origin change of screen starts the indicator. */
export function startNavigationProgress(href: string) {
  if (typeof window === 'undefined') return
  let next: URL
  try {
    next = new URL(href, window.location.href)
  } catch {
    return
  }
  if (next.origin !== window.location.origin || next.pathname === window.location.pathname) return
  const bar = document.getElementById(id)
  if (!bar) return
  // Show it before asking Next or the browser to fetch the destination.
  bar.hidden = false
  window.clearTimeout(timer)
  timer = window.setTimeout(clear, 20_000)
}

export function NavigationProgress() {
  const pathname = usePathname()
  useEffect(clear, [pathname])
  useEffect(() => {
    // Back can restore the exact outgoing document from the browser cache.
    window.addEventListener('pageshow', clear)
    return () => {
      window.removeEventListener('pageshow', clear)
      window.clearTimeout(timer)
    }
  }, [])
  return (
    <div id={id} className={styles.progress} hidden role="status">
      <span className="sr-only">Opening the next screen…</span>
    </div>
  )
}
