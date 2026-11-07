'use client'

import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'

type SiteChoice = { id: string; name: string }
type SidebarReader = {
  scope: string
  sitesStarted: boolean
  inboxStarted: boolean
  sitesRequest: AbortController | null
  inboxRequest: AbortController | null
  lastInboxStarted: number
}
type SidebarData = { sites: SiteChoice[] | null; sitesError: boolean; inboxCount: number | null }
type Snapshot = SidebarData & { reader: SidebarReader | null }

const siteChoicesChanged = 'cms:site-choices-changed'
const inboxChanged = 'cms:inbox-changed'
const inboxFocusInterval = 30_000
const siteChoicesCache = 'cms.sidebar.site-choices'
const empty: Snapshot = { reader: null, sites: null, sitesError: false, inboxCount: null }
const listeners = new Set<() => void>()
let snapshot = empty

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function getSnapshot() {
  return snapshot
}
function getServerSnapshot() {
  return empty
}
function setSnapshot(next: Snapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

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

function current(reader: SidebarReader, signal: AbortSignal) {
  return snapshot.reader === reader && !signal.aborted
}

async function readSites(reader: SidebarReader) {
  reader.sitesRequest?.abort()
  const controller = new AbortController()
  reader.sitesRequest = controller
  try {
    const response = await fetch('/api/sites', { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw Error('Sites unavailable')
    const { sites } = (await response.json()) as { sites: SiteChoice[] }
    if (!current(reader, controller.signal)) return
    setSnapshot({ ...snapshot, sites, sitesError: false })
    try {
      sessionStorage.setItem(siteChoicesCache, JSON.stringify({ scope: reader.scope, sites }))
    } catch {}
  } catch {
    if (!current(reader, controller.signal)) return
    clearSiteChoices()
    setSnapshot({ ...snapshot, sites: null, sitesError: true })
  }
}

async function readInbox(reader: SidebarReader) {
  reader.inboxRequest?.abort()
  const controller = new AbortController()
  reader.inboxRequest = controller
  reader.lastInboxStarted = Date.now()
  try {
    const response = await fetch('/api/inbox/summary', { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw Error('Inbox count unavailable')
    const { count } = (await response.json()) as { count: number }
    if (current(reader, controller.signal))
      setSnapshot({ ...snapshot, inboxCount: Number.isSafeInteger(count) && count >= 0 ? count : null })
  } catch {
    if (current(reader, controller.signal)) setSnapshot({ ...snapshot, inboxCount: null })
  }
}

/** Set the browser's verified scope without wrapping or remounting any route. */
export function SidebarSession({ scope }: { scope: string | null }) {
  useLayoutEffect(() => {
    if (!scope) {
      clearSiteChoices()
      setSnapshot(empty)
      return
    }
    const reader: SidebarReader = {
      scope,
      sitesStarted: false,
      inboxStarted: false,
      sitesRequest: null,
      inboxRequest: null,
      lastInboxStarted: -Infinity,
    }
    readStoredSites(scope) // Discard stale grants before the first choices request.
    setSnapshot({ ...empty, reader })
    function refreshSites() {
      if (reader.sitesStarted) void readSites(reader)
    }
    function refreshInbox() {
      if (reader.inboxStarted) void readInbox(reader)
    }
    function onFocus() {
      if (reader.inboxStarted && Date.now() - reader.lastInboxStarted >= inboxFocusInterval) void readInbox(reader)
    }
    window.addEventListener(siteChoicesChanged, refreshSites)
    window.addEventListener(inboxChanged, refreshInbox)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener(siteChoicesChanged, refreshSites)
      window.removeEventListener(inboxChanged, refreshInbox)
      window.removeEventListener('focus', onFocus)
      reader.sitesRequest?.abort()
      reader.inboxRequest?.abort()
      if (snapshot.reader === reader) setSnapshot(empty)
    }
  }, [scope])
  return null
}

export function useSidebarData(): SidebarData {
  const data = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  useEffect(() => {
    const reader = data.reader
    if (!reader || snapshot.reader !== reader) return
    if (!reader.sitesStarted) {
      reader.sitesStarted = true
      const cached = readStoredSites(reader.scope)
      if (cached) setSnapshot({ ...snapshot, sites: cached })
      else void readSites(reader)
    }
    if (!reader.inboxStarted) {
      reader.inboxStarted = true
      void readInbox(reader)
    }
  }, [data.reader])
  return data
}
