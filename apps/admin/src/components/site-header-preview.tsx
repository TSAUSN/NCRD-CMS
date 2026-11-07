'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { framePreviewHeight } from '../lib/frame-preview-size.ts'
import styles from './workspace.module.css'
import frameStyles from './site-header-preview.module.css'

export type FramePreviewTicket = { href: string; channel?: string }
type Preview = FramePreviewTicket

/** Load a new authorized preview alongside the current one. Keep the loaded
 * frame mounted until the newest document is ready to replace it. */
export function SiteHeaderPreview({
  href,
  expanded = false,
  part = 'header',
  channel,
  pending = false,
}: {
  href: string | null
  channel?: string
  expanded?: boolean
  part?: 'header' | 'footer'
  pending?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const latest = useRef<Preview | null>(null)
  const displayed = useRef<Preview | null>(null)
  const [shown, setShown] = useState<Preview | null>(null)
  const [frameHeight, setFrameHeight] = useState(part === 'footer' ? 260 : 120)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    latest.current = href ? { href, channel } : null
    displayed.current = shown
  }, [href, channel, shown])
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
        const frame = frames.current.get(candidate.href)
        if (!frame || event.source !== frame.contentWindow) continue
        if (event.origin !== new URL(candidate.href, window.location.href).origin) continue
        const height = framePreviewHeight(event.data, candidate.channel, part)
        if (height === null) continue
        setFrameHeight(height)
        if (candidate.href === latest.current?.href && candidate.href !== displayed.current?.href) setShown(candidate)
        return
      }
    }
    window.addEventListener('message', size)
    return () => window.removeEventListener('message', size)
  }, [part])

  const updating = href !== null && shown?.href !== href
  const previews = [...(shown ? [shown] : []), ...(href && updating ? [{ href, channel }] : [])]
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
    <div
      ref={host}
      className={styles.previewStrip}
      aria-busy={updating || pending}
      style={
        {
          '--preview-width': '1280px',
          '--preview-height': height + 'px',
          '--preview-scale': scale,
          height: height * scale,
        } as CSSProperties
      }
    >
      {!shown && (
        <span className={styles.previewLoading} role="status">
          Opening preview…
        </span>
      )}
      {shown && (updating || pending) && (
        <span className={frameStyles.updating} role="status">
          Updating {part} preview…
        </span>
      )}
      {previews.map(preview => {
        const active = preview.href === shown?.href
        return (
          <iframe
            key={preview.href}
            ref={frame => {
              if (frame) frames.current.set(preview.href, frame)
              else frames.current.delete(preview.href)
            }}
            onLoad={() => {
              // The owned ticket sends its verified size after the frame is
              // ready. A generic iframe load also fires on error pages.
              if (preview.channel || latest.current?.href !== preview.href || displayed.current?.href === preview.href)
                return
              setShown(preview)
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
            src={preview.href + '?visit=1' + (part === 'footer' ? '#cms-preview-footer' : '#cms-preview-header')}
          />
        )
      })}
    </div>
  )
}
