'use client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { framePreviewHeight } from '../lib/frame-preview-size.ts'
import styles from './workspace.module.css'
/** A scaled window onto the site's own private, read-only preview. */
export function SiteHeaderPreview({
  href,
  expanded = false,
  part = 'header',
  channel,
}: {
  href: string
  expanded?: boolean
  part?: 'header' | 'footer'
  channel?: string
}) {
  const host = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLIFrameElement>(null),
    [frameHeight, setFrameHeight] = useState(part === 'footer' ? 260 : 120),
    [width, setWidth] = useState(0),
    [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const node = host.current
    if (!node) return
    const measure = () => setWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setLoaded(false), [href])
  useEffect(() => {
    if (!channel) return
    const origin = new URL(href, window.location.href).origin
    const size = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return
      const height = framePreviewHeight(event.data, channel, part)
      if (height !== null) setFrameHeight(height)
    }
    window.addEventListener('message', size)
    return () => window.removeEventListener('message', size)
  }, [href, channel, part])
  const scale = Math.min(1, width / 1280),
    height = expanded ? Math.max(768, frameHeight) : frameHeight
  return (
    <div
      ref={host}
      className={styles.previewStrip}
      style={
        {
          '--preview-width': '1280px',
          '--preview-height': height + 'px',
          '--preview-scale': scale,
          height: height * scale,
        } as CSSProperties
      }
    >
      {!loaded && (
        <span className={styles.previewLoading} role="status">
          Opening preview…
        </span>
      )}
      <iframe
        ref={frame}
        onLoad={() => setLoaded(true)}
        aria-busy={!loaded}
        inert={!expanded}
        title={
          expanded
            ? part === 'footer'
              ? 'Footer on the full page'
              : 'Header on the full page'
            : part === 'footer'
              ? 'Footer preview'
              : 'Header preview'
        }
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        src={href + '?visit=1' + (part === 'footer' ? '#cms-preview-footer' : '#cms-preview-header')}
      />
    </div>
  )
}
