import type { CSSProperties, RefObject } from 'react'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import { usePreviewLayers } from '../../../../components/use-preview-layers.ts'
import styles from './site-look.module.css'

type Page = { href: string } | { html: string }

/** Keep the ready preview mounted while the latest draft loads in the background. */
export function SiteLookPreviewStage({
  isolated,
  href,
  html,
  loading,
  width,
  scale,
  frame,
  showArea,
}: {
  isolated: boolean
  href: string | null
  html: string
  loading: boolean
  width: number
  scale: number
  frame: RefObject<HTMLIFrameElement | null>
  showArea: (frame: HTMLIFrameElement | null) => void
}) {
  const next = isolated ? (href ? { key: href, value: { href } } : null) : html ? { key: html, value: { html } } : null
  const { layers, shown, staging, loaded } = usePreviewLayers<Page>(next)
  const transform = {
    width,
    transform: 'scale(' + scale + ')',
    height: 'calc(var(--site-look-preview-height) / ' + scale + ')',
  }
  const pending = loading || staging
  return (
    <div className={styles.stage} style={{ width: width * scale }} aria-busy={pending}>
      {layers.map(layer => {
        const active = layer.key === shown?.key
        const style: CSSProperties = active
          ? transform
          : { ...transform, position: 'absolute', inset: 0, visibility: 'hidden' }
        const title = active ? 'Site look page preview' : 'Loading site look page preview'
        const visible = active ? frame : undefined
        if ('href' in layer.value) {
          return (
            <iframe
              key={layer.key}
              ref={visible}
              title={title}
              aria-hidden={!active || undefined}
              inert={!active || undefined}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              src={layer.value.href}
              onLoad={() => loaded(layer.key)}
              style={style}
            />
          )
        }
        return (
          <ScriptlessPreview
            key={layer.key}
            ref={visible}
            title={title}
            aria-hidden={!active || undefined}
            inert={!active || undefined}
            onLoad={event => {
              showArea(event.currentTarget)
              loaded(layer.key)
            }}
            srcDoc={layer.value.html}
            style={style}
          />
        )
      })}
      {pending && (
        <p className={shown ? styles.refreshing : styles.loading} role="status">
          Updating site preview…
        </p>
      )}
    </div>
  )
}
