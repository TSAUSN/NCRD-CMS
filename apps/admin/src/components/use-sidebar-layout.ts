import { useEffect, useRef, useState } from 'react'

const RAIL_KEY = 'cms.sidebar.rail'

export function useSidebarLayout(pathname: string) {
  const [open, setOpen] = useState(false)
  const [rail, setRail] = useState(false)
  const [compact, setCompact] = useState(false)
  const sidebar = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLButtonElement>(null)

  // Storage is available only after hydration.
  useEffect(() => {
    try {
      setRail(window.localStorage.getItem(RAIL_KEY) === '1')
    } catch {
      /* private mode */
    }
  }, [])

  // Match the CSS breakpoint so only the closed mobile drawer is inert.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 60rem)')
    const update = () => {
      const nextCompact = query.matches
      setCompact(nextCompact)
      if (!nextCompact) setOpen(false)
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open || !compact) return
    closeButton.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDrawer()
      if (event.key !== 'Tab') return
      const controls = [
        ...(sidebar.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter(control => control.getClientRects().length > 0)
      if (controls.length === 0) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, compact])

  function closeDrawer() {
    setOpen(false)
    // Wait for the main content to stop being inert before restoring focus.
    window.requestAnimationFrame(() => opener.current?.focus())
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault()
        toggleRail()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function toggleRail() {
    setRail(current => {
      const next = !current
      try {
        window.localStorage.setItem(RAIL_KEY, next ? '1' : '0')
      } catch {
        /* private mode */
      }
      return next
    })
  }

  return { open, setOpen, rail, compact, sidebar, closeButton, opener, closeDrawer, toggleRail }
}

export type SidebarLayout = ReturnType<typeof useSidebarLayout>
