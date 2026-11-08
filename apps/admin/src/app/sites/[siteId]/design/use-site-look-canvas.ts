'use client'
import { useEffect, useState } from 'react'
import { queueFramePreview } from '../../../../lib/frame-preview-request.ts'
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
  } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const serial = JSON.stringify(input.look)
  const documentKey = JSON.stringify([input.origin, input.siteId, input.pageId, input.versionId, input.purpose, serial])
  const key = documentKey + ':' + input.retry
  const ticket = issued?.key === key ? issued.ticket : null
  const error = failure?.key === key ? failure.message : ''
  const loading = Boolean(input.origin && input.pageId && input.versionId && input.look && !ticket && !error)
  const fail = (message: string) => setFailure({ key, message })
  useEffect(() => {
    const { origin, look, siteId, pageId, versionId, purpose } = input
    if (!origin || !pageId || !versionId || !look || !canvasDocumentReady(origin)) return
    const channel = crypto.randomUUID()
    return queueFramePreview(
      async signal => {
        try {
          const response = await fetch(`/api/sites/${siteId}/global-elements/preview`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...look, purpose, versionId, previewContext: 'draft', isolated: true, channel }),
            signal,
          })
          const next = response.ok ? readCanvasTicket(await response.json(), origin, channel) : null
          if (!next) throw Error('unavailable')
          if (!signal.aborted) setIssued({ key, ticket: next })
        } catch {
          if (!signal.aborted)
            fail('The site preview could not be opened. Your choices are still here. Try the preview again.')
        }
      },
      {
        afterMs: 15000,
        onTimeout: () => fail('The preview request timed out. Your changes are still here. Try the preview again.'),
      },
    )
  }, [key])
  useEffect(() => {
    if (!ticket) return
    let active = true
    let pending = false
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
    const timer = window.setInterval(() => void renew(), 240_000)
    const visible = () => {
      if (document.visibilityState === 'visible') void renew()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [ticket, input.pageId])
  return { ticket, loading, error, documentKey }
}
