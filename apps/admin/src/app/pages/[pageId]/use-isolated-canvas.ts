'use client'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
type Ticket = {
  href: string
  token: string
  expiresAt: string
  origin: string
  channel: string
  documentId: string | null
  requestId: string | null
}
/** A client transition cannot replace the document's CSP. Reload on entry if
 * its verified site differs; never broaden frame-src to every tenant. */
export function canvasDocumentReady(origin: string): boolean {
  // A server-action redirect can update <html> attributes through React while
  // retaining the previous document's CSP. Navigation Timing names the actual
  // loaded document; a later client route is not proof of its frame permission.
  const loaded = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  let sameDocument = false
  try {
    const url = loaded && new URL(loaded.name)
    sameDocument = Boolean(url && url.origin === window.location.origin && url.pathname === window.location.pathname)
  } catch {}
  if (sameDocument && document.documentElement.dataset.cmsCanvasOrigin === origin) return true
  window.location.reload()
  return false
}
export function readCanvasTicket(value: unknown, expectedOrigin: string, channel: string): Ticket | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    typeof row['token'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row['token']) ||
    typeof row['href'] !== 'string' ||
    typeof row['expiresAt'] !== 'string' ||
    !Number.isFinite(Date.parse(row['expiresAt']))
  )
    return null
  if (row['href'] !== `${expectedOrigin}/__cms/canvas/${row['token']}`) return null
  return {
    href: row['href'],
    token: row['token'],
    expiresAt: row['expiresAt'],
    origin: expectedOrigin,
    channel,
    documentId: null,
    requestId: null,
  }
}
/** A capability is issued by the authenticated CMS. Public content and editor
 * UI live on separate origins; no child document is ever read by the parent. */
export function useIsolatedCanvas(input: {
  origin: string | null
  pageId: string
  version: string | null
  epoch: number
  site: 'draft' | 'published'
  hidden: boolean
  frame: RefObject<HTMLIFrameElement | null>
}) {
  const [href, setHref] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [visitorEpoch, setVisitorEpoch] = useState(0)
  const peer = useRef<Ticket | null>(null)
  const peerFrame = useRef<HTMLIFrameElement | null>(null)
  const visitors = useRef(new Map<Window, Ticket>())
  const trackVisitor = useCallback((tab: Window, ticket: Ticket) => {
    for (const view of visitors.current.keys()) if (view.closed) visitors.current.delete(view)
    visitors.current.set(tab, ticket)
    setVisitorEpoch(value => value + 1)
  }, [])
  const endpoint = `/api/pages/${input.pageId}/canvas`
  const flushes = useRef(new Map<string, (ok: boolean) => void>())
  const enabled = Boolean(input.origin)
  useEffect(() => {
    if (!input.origin || !input.version) return
    if (!canvasDocumentReady(input.origin)) return
    const abort = new AbortController(),
      channel = crypto.randomUUID()
    peer.current = null
    peerFrame.current = null
    setHref(null)
    setError(null)
    for (const finish of flushes.current.values()) finish(false)
    flushes.current.clear()
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'open',
        versionId: input.version,
        sitePreview: input.site,
        showHidden: input.hidden,
        channel,
      }),
      signal: abort.signal,
    })
      .then(async response => {
        if (!response.ok) throw Error('The page preview could not be opened. Save your work and reload the preview.')
        const ticket = readCanvasTicket(await response.json(), input.origin!, channel)
        if (!ticket) throw Error('The page preview could not be verified. Reload the preview.')
        if (abort.signal.aborted) return
        peer.current = ticket
        setHref(ticket.href)
      })
      .catch(reason => {
        if (!abort.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'The page preview is unavailable. Reload the preview.')
      })
    return () => {
      abort.abort()
      peer.current = null
      for (const finish of flushes.current.values()) finish(false)
      flushes.current.clear()
    }
  }, [input.origin, input.version, input.epoch, input.site, input.hidden, endpoint])
  const post = useCallback(
    (message: Record<string, unknown>) => {
      const ticket = peer.current
      if (
        !ticket ||
        peerFrame.current !== input.frame.current ||
        (!ticket.documentId && message['type'] !== 'cms:request-ready')
      )
        return
      input.frame.current?.contentWindow?.postMessage(
        { ...message, channel: ticket.channel, documentId: ticket.documentId },
        ticket.origin,
      )
    },
    [input.frame],
  )
  const accept = useCallback(
    (event: MessageEvent) => {
      const ticket = peer.current,
        data = event.data
      if (
        !ticket ||
        event.source !== input.frame.current?.contentWindow ||
        event.origin !== ticket.origin ||
        !data ||
        typeof data !== 'object' ||
        data.channel !== ticket.channel ||
        typeof data.documentId !== 'string' ||
        data.documentId.length > 200
      )
        return false
      // A child announces every new document. Challenge that announcement once;
      // iframe load may follow the successful handshake and must not reset it.
      if (data.type === 'cms:ready') {
        if (!ticket.documentId && ticket.requestId && data.requestId === ticket.requestId)
          ticket.documentId = data.documentId
        else if (data.documentId !== ticket.documentId && data.requestId === undefined) {
          peerFrame.current = input.frame.current
          ticket.documentId = null
          ticket.requestId = crypto.randomUUID()
          post({ type: 'cms:request-ready', requestId: ticket.requestId })
          return false
        }
      }
      if (!ticket.documentId) return false
      if (data.documentId !== ticket.documentId) return false
      if (data.type === 'cms:fields-flushed' && typeof data.request === 'string') {
        flushes.current.get(data.request)?.(true)
        flushes.current.delete(data.request)
        return false
      }
      return true
    },
    [input.frame, post],
  )
  const flush = useCallback((): Promise<boolean> => {
    if (!enabled) return Promise.resolve(true)
    if (!peer.current?.documentId) return Promise.resolve(true)
    return new Promise(resolve => {
      const request = crypto.randomUUID(),
        timer = window.setTimeout(() => {
          flushes.current.delete(request)
          resolve(false)
        }, 3000)
      flushes.current.set(request, ok => {
        window.clearTimeout(timer)
        resolve(ok)
      })
      post({ type: 'cms:flush-fields', request })
    })
  }, [enabled, post])
  useEffect(() => {
    // A saved visitor preview can use this capability without changing the
    // page's existing editing canvas. Keep that pop-out alive independently.
    if ((!enabled || !href) && !visitors.current.size) return
    let pending = false
    const renew = async () => {
      if (pending) return
      for (const view of visitors.current.keys()) if (view.closed) visitors.current.delete(view)
      if (document.visibilityState === 'hidden' && !visitors.current.size) return
      const tickets = [...(peer.current ? [peer.current] : []), ...visitors.current.values()]
      if (!tickets.length) return
      pending = true
      try {
        await Promise.all(
          tickets.map(async ticket => {
            try {
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'renew', token: ticket.token }),
              })
              if (!response.ok) {
                if (peer.current === ticket && Date.parse(ticket.expiresAt) <= Date.now() + 60_000)
                  setError('The page preview expired. Your draft is still here. Reload the preview.')
                return
              }
              const result = await response.json()
              if (typeof result.expiresAt === 'string' && Number.isFinite(Date.parse(result.expiresAt))) {
                ticket.expiresAt = result.expiresAt
                if (peer.current === ticket) setError(null)
              }
            } catch {
              if (peer.current === ticket && Date.parse(ticket.expiresAt) <= Date.now() + 60_000)
                setError('The page preview could not be renewed. Check your connection and reload the preview.')
            }
          }),
        )
      } finally {
        pending = false
      }
    }
    const timer = window.setInterval(() => void renew(), 240_000),
      visible = () => {
        void renew()
      }
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [enabled, href, endpoint, visitorEpoch])
  return { enabled, href, error, post, accept, flush, trackVisitor }
}
