'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type SiteChoice = { id: string; name: string }
type SidebarData = {
  sites: SiteChoice[] | null
  sitesError: boolean
  inboxCount: number | null
  start: () => void
}

const siteChoicesChanged = 'cms:site-choices-changed'
const inboxChanged = 'cms:inbox-changed'
const inboxFocusInterval = 30_000
const siteChoicesCache = 'cms.sidebar.site-choices'

const empty: SidebarData = { sites: null, sitesError: false, inboxCount: null, start: () => {} }
const Context = createContext(empty)

export function notifySiteChoicesChanged() {
  clearSiteChoices()
  window.dispatchEvent(new Event(siteChoicesChanged))
}

function clearSiteChoices() {
  try {
    sessionStorage.removeItem(siteChoicesCache)
  } catch {}
}

function readStoredSites(scope: string): SiteChoice[] | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(siteChoicesCache) ?? 'null')
    if (!value) return null
    if (
      value.scope === scope &&
      Array.isArray(value.sites) &&
      value.sites.every((site: unknown) =>
        Boolean(
          site &&
          typeof site === 'object' &&
          'id' in site &&
          typeof site.id === 'string' &&
          'name' in site &&
          typeof site.name === 'string',
        ),
      )
    )
      return value.sites
  } catch {}
  clearSiteChoices()
  return null
}

type SidebarReader = {
  scope: string | null
  started: boolean
  sitesRequest: AbortController | null
  inboxRequest: AbortController | null
  lastInboxStarted: number
}
type Scoped<T> = { reader: SidebarReader; value: T }
type SiteResult = { sites: SiteChoice[] | null; error: boolean }

export function SidebarDataProvider({ children, scope }: { children: ReactNode; scope: string | null }) {
  // A grant change invalidates sidebar data, not local state in the page.
  // Each reader owns its requests so an old cleanup cannot abort a new scope.
  const reader = useMemo<SidebarReader>(
    () => ({ scope, started: false, sitesRequest: null, inboxRequest: null, lastInboxStarted: -Infinity }),
    [scope],
  )
  const [siteResult, setSiteResult] = useState<Scoped<SiteResult> | null>(null)
  const [inboxResult, setInboxResult] = useState<Scoped<number | null> | null>(null)

  const readSites = useCallback(async () => {
    const scope = reader.scope
    if (!scope) return
    reader.sitesRequest?.abort()
    const controller = new AbortController()
    reader.sitesRequest = controller
    try {
      const response = await fetch('/api/sites', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw Error('Sites unavailable')
      const result = (await response.json()) as { sites: SiteChoice[] }
      if (!controller.signal.aborted) {
        setSiteResult({ reader, value: { sites: result.sites, error: false } })
        try {
          sessionStorage.setItem(siteChoicesCache, JSON.stringify({ scope, sites: result.sites }))
        } catch {}
      }
    } catch {
      if (!controller.signal.aborted) {
        clearSiteChoices()
        setSiteResult({ reader, value: { sites: null, error: true } })
      }
    }
  }, [reader])

  const readInbox = useCallback(async () => {
    reader.inboxRequest?.abort()
    const controller = new AbortController()
    reader.inboxRequest = controller
    reader.lastInboxStarted = Date.now()
    try {
      const response = await fetch('/api/inbox/summary', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw Error('Inbox count unavailable')
      const result = (await response.json()) as { count: number }
      if (!controller.signal.aborted)
        setInboxResult({ reader, value: Number.isSafeInteger(result.count) && result.count >= 0 ? result.count : null })
    } catch {
      if (!controller.signal.aborted) setInboxResult({ reader, value: null })
    }
  }, [reader])

  const start = useCallback(() => {
    if (reader.started || !reader.scope) return
    reader.started = true
    const stored = readStoredSites(reader.scope)
    if (stored) setSiteResult({ reader, value: { sites: stored, error: false } })
    else void readSites()
    void readInbox()
  }, [reader, readSites, readInbox])

  useEffect(() => {
    if (!reader.scope) clearSiteChoices()
    function refreshSites() {
      if (reader.started) void readSites()
    }
    function refreshInbox() {
      if (reader.started) void readInbox()
    }
    function onFocus() {
      if (reader.started && Date.now() - reader.lastInboxStarted >= inboxFocusInterval) void readInbox()
    }
    window.addEventListener(siteChoicesChanged, refreshSites)
    window.addEventListener(inboxChanged, refreshInbox)
    window.addEventListener('focus', onFocus)
    return () => {
      reader.sitesRequest?.abort()
      reader.inboxRequest?.abort()
      reader.started = false
      window.removeEventListener(siteChoicesChanged, refreshSites)
      window.removeEventListener(inboxChanged, refreshInbox)
      window.removeEventListener('focus', onFocus)
    }
  }, [reader, readSites, readInbox])

  const activeSites = siteResult?.reader === reader ? siteResult.value : null
  const inboxCount = inboxResult?.reader === reader ? inboxResult.value : null
  return (
    <Context.Provider
      value={{ sites: activeSites?.sites ?? null, sitesError: activeSites?.error ?? false, inboxCount, start }}
    >
      {children}
    </Context.Provider>
  )
}

export function useSidebarData() {
  const data = useContext(Context)
  useEffect(() => data.start(), [data.start])
  return data
}
