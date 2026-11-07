'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

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

export function SidebarDataProvider({ children, scope }: { children: ReactNode; scope: string | null }) {
  const [sites, setSites] = useState<SiteChoice[] | null>(null)
  const [sitesError, setSitesError] = useState(false)
  const [inboxCount, setInboxCount] = useState<number | null>(null)
  const started = useRef(false)
  const sitesRequest = useRef<AbortController | null>(null)
  const inboxRequest = useRef<AbortController | null>(null)
  const lastInboxStarted = useRef(-Infinity)

  const readSites = useCallback(async () => {
    if (!scope) return
    sitesRequest.current?.abort()
    const controller = new AbortController()
    sitesRequest.current = controller
    try {
      const response = await fetch('/api/sites', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw Error('Sites unavailable')
      const result = (await response.json()) as { sites: SiteChoice[] }
      if (!controller.signal.aborted) {
        setSites(result.sites)
        setSitesError(false)
        try {
          sessionStorage.setItem(siteChoicesCache, JSON.stringify({ scope, sites: result.sites }))
        } catch {}
      }
    } catch {
      if (!controller.signal.aborted) {
        clearSiteChoices()
        setSites(null)
        setSitesError(true)
      }
    }
  }, [scope])

  const readInbox = useCallback(async () => {
    inboxRequest.current?.abort()
    const controller = new AbortController()
    inboxRequest.current = controller
    lastInboxStarted.current = Date.now()
    try {
      const response = await fetch('/api/inbox/summary', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw Error('Inbox count unavailable')
      const result = (await response.json()) as { count: number }
      if (!controller.signal.aborted)
        setInboxCount(Number.isSafeInteger(result.count) && result.count >= 0 ? result.count : null)
    } catch {
      if (!controller.signal.aborted) setInboxCount(null)
    }
  }, [])

  const start = useCallback(() => {
    if (started.current || !scope) return
    started.current = true
    const stored = readStoredSites(scope)
    if (stored) setSites(stored)
    else void readSites()
    void readInbox()
  }, [scope, readSites, readInbox])

  useEffect(() => {
    if (!scope) clearSiteChoices()
    function refreshSites() {
      if (started.current) void readSites()
    }
    function refreshInbox() {
      if (started.current) void readInbox()
    }
    function onFocus() {
      if (started.current && Date.now() - lastInboxStarted.current >= inboxFocusInterval) void readInbox()
    }
    window.addEventListener(siteChoicesChanged, refreshSites)
    window.addEventListener(inboxChanged, refreshInbox)
    window.addEventListener('focus', onFocus)
    return () => {
      sitesRequest.current?.abort()
      inboxRequest.current?.abort()
      started.current = false
      window.removeEventListener(siteChoicesChanged, refreshSites)
      window.removeEventListener(inboxChanged, refreshInbox)
      window.removeEventListener('focus', onFocus)
    }
  }, [scope, readSites, readInbox])

  return <Context.Provider value={{ sites, sitesError, inboxCount, start }}>{children}</Context.Provider>
}

export function useSidebarData() {
  const data = useContext(Context)
  useEffect(() => data.start(), [data.start])
  return data
}
