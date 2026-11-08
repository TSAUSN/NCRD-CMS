'use client'

import { PREVIEW_MESSAGE } from '@cms/renderer/preview-messages'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { framePreviewHeight } from '../lib/frame-preview-size.ts'
import { framePreviewAddress } from '../lib/frame-preview-request.ts'
import { Button, TextLink } from './ui/index.ts'
import workspaceFormsStyles from './workspace-styles/workspace-forms.module.css'
import ownedStyles from './site-header-preview-styles.module.css'
import frameStyles from './site-header-preview.module.css'

export type FramePreviewTicket = { href: string; channel?: string }
export type FramePreviewRecovery = { key: string; freshTicket: () => void }
type Preview = FramePreviewTicket & { key: string }
const RETRY_WITHOUT_READY_MS = 6500
const PREVIEW_DEADLINE_MS = 15000

/** Load a new authorized preview alongside the current one. Keep the loaded
 * frame mounted until the newest document is ready to replace it. */
export function SiteHeaderPreview({
  href,
  expanded = false,
  part = 'header',
  channel,
  pending = false,
  retry,
  recovery,
}: {
  href: string | null
  channel?: string
  expanded?: boolean
  part?: 'header' | 'footer'
  pending?: boolean
  retry?: () => void
  recovery?: FramePreviewRecovery
}) {
  const host = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const latest = useRef<Preview | null>(null)
  const displayed = useRef<Preview | null>(null)
  const [shown, setShown] = useState<Preview | null>(null)
  const [frameHeight, setFrameHeight] = useState(part === 'footer' ? 260 : 120)
  const [width, setWidth] = useState(0)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const opening = useRef<{ key: string; startedAt: number } | null>(null)
  const attempted = useRef<string | null>(null)
  const loaded = useRef<string | null>(null)
  const [reopenedHref, setReopenedHref] = useState<string | null>(null)
  const nextKey = href ? href + (reopenedHref === href ? ':reopened' : '') : null
  useLayoutEffect(() => {
    latest.current = href && nextKey ? { href, channel, key: nextKey } : null
    displayed.current = shown
  }, [href, channel, nextKey, shown])
  useEffect(() => {
    const node = host.current
    if (!node) return
    const measure = () => setWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const size = (event: MessageEvent) => {
      for (const candidate of [latest.current, displayed.current]) {
        if (!candidate?.channel) continue
        const frame = frames.current.get(candidate.key)
        if (!frame || event.source !== frame.contentWindow) continue
        if (event.origin !== new URL(candidate.href, window.location.href).origin) continue
        const height = framePreviewHeight(event.data, candidate.channel, part)
        if (height === null) continue
        setFrameHeight(height)
        if (candidate.key === latest.current?.key && candidate.key !== displayed.current?.key) setShown(candidate)
        return
      }
    }
    window.addEventListener('message', size)
    return () => window.removeEventListener('message', size)
  }, [part])

  const updating = href !== null && shown?.href !== href
  const openingKey = recovery?.key ?? href
  const freshTicket = recovery?.freshTicket
  const failed = Boolean(href && updating && failedKey === openingKey)
  useEffect(() => {
    if (!href || !openingKey) return
    if (!updating) {
      opening.current = null
      return
    }
    if (opening.current?.key !== openingKey) opening.current = { key: openingKey, startedAt: performance.now() }
    const elapsed = performance.now() - opening.current.startedAt
    const timer = window.setTimeout(() => setFailedKey(openingKey), Math.max(0, PREVIEW_DEADLINE_MS - elapsed))
    return () => window.clearTimeout(timer)
  }, [href, updating, openingKey])
  useEffect(() => {
    if (!href || !openingKey || !updating || failed || attempted.current === openingKey) return
    const timer = window.setTimeout(() => {
      attempted.current = openingKey
      // A document which never committed can keep the original navigation stuck.
      // Ask for a fresh authorized address; a loaded frame can retry its size bridge.
      if (freshTicket && loaded.current !== nextKey) freshTicket()
      else setReopenedHref(href)
    }, RETRY_WITHOUT_READY_MS)
    return () => window.clearTimeout(timer)
  }, [href, updating, failed, openingKey, nextKey, freshTicket])
  const previews = [
    ...(shown ? [shown] : []),
    ...(href && nextKey && updating ? [{ href, channel, key: nextKey }] : []),
  ]
  const scale = Math.min(1, width / 1280)
  const height = expanded ? Math.max(768, frameHeight) : frameHeight
  const title = expanded
    ? part === 'footer'
      ? 'Footer on the full page'
      : 'Header on the full page'
    : part === 'footer'
      ? 'Footer preview'
      : 'Header preview'
  return (
    <>
      <div
        ref={host}
        className={ownedStyles.previewStrip}
        aria-busy={!failed && (updating || pending)}
        style={
          {
            '--preview-width': '1280px',
            '--preview-height': height + 'px',
            '--preview-scale': scale,
            height: height * scale,
          } as CSSProperties
        }
      >
        {!shown && !failed && (
          <span className={ownedStyles.previewLoading} role="status">
            Opening preview…
          </span>
        )}
        {shown && !failed && (updating || pending) && (
          <span className={frameStyles.updating} role="status">
            Updating {part} preview…
          </span>
        )}
        {previews.map(preview => {
          const active = preview.key === shown?.key
          return (
            <iframe
              key={preview.key}
              ref={frame => {
                if (frame) frames.current.set(preview.key, frame)
                else frames.current.delete(preview.key)
              }}
              onLoad={event => {
                if (
                  latest.current?.key !== preview.key ||
                  displayed.current?.key === preview.key ||
                  frames.current.get(preview.key) !== event.currentTarget
                )
                  return
                if (event.currentTarget.contentDocument?.URL !== 'about:blank') loaded.current = preview.key
                if (preview.channel) {
                  // The child may have sent its initial size before the editor attached its listener.
                  // Ask again; load itself also fires for an error page and doesn't make a ticket ready.
                  const origin = new URL(preview.href, window.location.href).origin
                  event.currentTarget.contentWindow?.postMessage(
                    { type: PREVIEW_MESSAGE.requestFrameSize, channel: preview.channel },
                    origin,
                  )
                } else setShown(preview)
              }}
              aria-hidden={!active || undefined}
              inert={!active || !expanded}
              title={active ? title : 'Loading ' + title}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              className={frameStyles.frame}
              // Chrome can suspend requestAnimationFrame in an invisible cross-origin
              // frame. Keep it in layout so it can send its verified ready message.
              style={active ? undefined : { opacity: 0, pointerEvents: 'none' }}
              src={framePreviewAddress(preview.href, part)}
            />
          )
        })}
      </div>
      {failed && href && (
        <div className={frameStyles.failure} role="status">
          <p>The inline preview hasn’t opened. Your changes are still here.</p>
          <div className={workspaceFormsStyles.actions}>
            {retry && (
              <Button variant="secondary" onClick={retry}>
                Try preview again
              </Button>
            )}
            <TextLink href={framePreviewAddress(href, part)} target="_blank" rel="noopener noreferrer">
              Open preview in a new tab
            </TextLink>
          </div>
        </div>
      )}
    </>
  )
}
