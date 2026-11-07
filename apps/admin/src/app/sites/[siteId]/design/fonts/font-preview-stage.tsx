import type { RefObject } from 'react'
import { EmptyState } from '../../../../../components/ui/index.ts'
import { usePreviewLayers } from '../../../../../components/use-preview-layers.ts'
import styles from '../../../../../components/workspace.module.css'
import design from '../site-look.module.css'

export function FontPreviewStage({
  href,
  loading,
  visibleFrame,
  newestFrame,
}: {
  href: string | null
  loading: boolean
  visibleFrame: RefObject<HTMLIFrameElement | null>
  newestFrame: RefObject<HTMLIFrameElement | null>
}) {
  const { layers, shown, staging, loaded } = usePreviewLayers(href ? { key: href, value: href } : null)
  return (
    <div className={design.fontPreview} aria-busy={loading || staging}>
      {!shown && (
        <EmptyState title={loading || staging ? 'Opening the font preview…' : 'No font preview yet'}>
          Press Check kit to try the fonts at the site’s staging address.
        </EmptyState>
      )}
      {shown && (loading || staging) && (
        <p className={design.refreshing} role="status">
          Updating font preview…
        </p>
      )}
      {layers.map(layer => {
        const active = layer.key === shown?.key
        return (
          <iframe
            key={layer.key}
            ref={node => {
              if (active) visibleFrame.current = node
              if (layer.key === href) newestFrame.current = node
            }}
            title={active ? 'Fonts on the real page' : 'Loading fonts on the real page'}
            aria-hidden={!active || undefined}
            inert={!active || undefined}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            className={styles.previewFrame}
            style={active ? undefined : { position: 'absolute', inset: 0, visibility: 'hidden' }}
            src={layer.value}
            onLoad={() => loaded(layer.key)}
          />
        )
      })}
    </div>
  )
}
