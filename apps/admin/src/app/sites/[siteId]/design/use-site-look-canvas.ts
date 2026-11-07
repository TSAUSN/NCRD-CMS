'use client'
import { useEffect, useState } from 'react'
import type { ThemeTokens, HeaderConfig, FooterConfig, NavTree } from '@cms/schema'
import { canvasDocumentReady, readCanvasTicket } from '../../../pages/[pageId]/use-isolated-canvas.ts'
export function useSiteLookCanvas(input: {
  purpose?: 'fonts' | 'frame'
  origin: string | null
  siteId: string
  pageId: string
  versionId: string
  look: { tokens: ThemeTokens; header: HeaderConfig; footer: FooterConfig; menu: NavTree } | null
  retry: number
}) {
  const [issued, setIssued] = useState<{
      key: string
      ticket: NonNullable<ReturnType<typeof readCanvasTicket>>
    } | null>(null),
    [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const serial = JSON.stringify(input.look)
  const key = JSON.stringify([
    input.origin,
    input.siteId,
    input.pageId,
    input.versionId,
    input.purpose,
    input.retry,
    serial,
  ])
  const ticket = issued?.key === key ? issued.ticket : null
  const error = failure?.key === key ? failure.message : ''
  const loading = Boolean(input.origin && input.pageId && input.versionId && input.look && !ticket && !error)
  const fail = (message: string) => setFailure({ key, message })
  useEffect(() => {
    if (!input.origin || !input.pageId || !input.versionId || !input.look) return
    if (!canvasDocumentReady(input.origin)) return
    const controller = new AbortController(),
      channel = crypto.randomUUID()
    const deadline = window.setTimeout(() => {
      controller.abort()
      fail('The preview request timed out. Your changes are still here. Try the preview again.')
    }, 15000)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/sites/${input.siteId}/global-elements/preview`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...input.look,
              purpose: input.purpose,
              versionId: input.versionId,
              previewContext: 'draft',
              isolated: true,
              channel,
            }),
            signal: controller.signal,
          })
          const next = response.ok ? readCanvasTicket(await response.json(), input.origin!, channel) : null
          if (!next) throw Error('unavailable')
          if (!controller.signal.aborted) setIssued({ key, ticket: next })
        } catch {
          if (!controller.signal.aborted)
            fail('The site preview could not be opened. Your choices are still here. Try the preview again.')
        } finally {
          window.clearTimeout(deadline)
        }
      })()
    }, 180)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(deadline)
      controller.abort()
    }
  }, [key])
  useEffect(() => {
    if (!ticket) return
    let active = true,
      pending = false
    const renew = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch(`/api/pages/${input.pageId}/canvas`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'renew', token: ticket.token }),
        })
        if (!active) return
        if (!response.ok) throw Error('unavailable')
        const next = await response.json()
        if (typeof next.expiresAt !== 'string' || !Number.isFinite(Date.parse(next.expiresAt)))
          throw Error('unavailable')
        ticket.expiresAt = next.expiresAt
      } catch {
        if (active && Date.parse(ticket.expiresAt) <= Date.now() + 60_000)
          fail('The site preview expired. Your choices are still here. Try the preview again.')
      } finally {
        pending = false
      }
    }
    const timer = window.setInterval(() => void renew(), 240_000),
      visible = () => {
        if (document.visibilityState === 'visible') void renew()
      }
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [ticket, input.pageId])
  return { ticket, loading, error }
}
