'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './section-live-preview.module.css'
import { EmptyState, Button, Dialog, SegmentedControl } from './ui/index.ts'
import { ScriptlessPreview } from './scriptless-preview.tsx'
import { sitePreviewLabel, type SitePreviewContext } from '../lib/preview-context.ts'

export function SectionLivePreview({
  siteId,
  definitionId,
  name,
  themeSiteId = siteId,
  previewContext = 'published',
  onReady,
}: {
  siteId: string
  definitionId: string
  name: string
  themeSiteId?: string
  previewContext?: SitePreviewContext
  onReady?: (ready: boolean) => void
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const endpoint = `/api/sites/${siteId}/sections/${definitionId}/preview?themeSiteId=${encodeURIComponent(themeSiteId)}&site=${previewContext}`
  useEffect(() => {
    const controller = new AbortController()
    setHtml(null)
    setFailed(false)
    onReady?.(false)
    void fetch(endpoint, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('preview-unavailable')
        const next = await response.text()
        if (!controller.signal.aborted) {
          setHtml(next)
          onReady?.(true)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [endpoint, retry, onReady])
  const previewSpace = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  useEffect(() => {
    const space = previewSpace.current
    if (!space) return
    const observer = new ResizeObserver(() => setAvailable(space.clientWidth))
    observer.observe(space)
    setAvailable(space.clientWidth)
    return () => observer.disconnect()
  }, [html])
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(1)
  const observer = useRef<ResizeObserver | null>(null)
  useEffect(() => () => observer.current?.disconnect(), [])
  const scale = Math.min(1, available / width)
  return (
    <div className={`section-live-preview ${styles.root}`}>
      <SegmentedControl
        label="Section preview width"
        value={String(width)}
        onChange={value => setWidth(Number(value))}
        options={[
          { value: '1280', label: 'Desktop' },
          { value: '768', label: 'Tablet' },
          { value: '390', label: 'Phone' },
        ]}
      />

      <p className="hint">Sample content · {sitePreviewLabel(previewContext)}</p>

      {failed ? (
        <EmptyState
          title="Preview unavailable"
          action={
            <Button variant="secondary" onClick={() => setRetry(value => value + 1)}>
              Try again
            </Button>
          }
        >
          <p>The section could not be loaded. Try again, or return to the library.</p>
        </EmptyState>
      ) : html === null ? (
        <div className={styles.loading} aria-busy="true" role="status">
          Loading preview…
        </div>
      ) : (
        <div ref={previewSpace} className={`section-live-preview-scroll ${styles.viewport}`}>
          <div className={styles.stage} style={{ width: width * scale, height: height * scale }}>
            <ScriptlessPreview
              key={`${definitionId}-${themeSiteId}-${previewContext}`}
              title={`${name} with site design`}
              className={styles.frame}
              style={{ width, height, transform: `scale(${scale})` }}
              onLoad={event => {
                observer.current?.disconnect()
                const body = event.currentTarget.contentDocument?.body
                if (!body) return
                const measure = () => setHeight(Math.ceil(body.getBoundingClientRect().height))
                observer.current = new ResizeObserver(measure)
                observer.current.observe(body)
                measure()
              }}
              srcDoc={html}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function SectionPreviewButton(props: {
  siteId: string
  definitionId: string
  name: string
  themeSiteId?: string
  previewContext?: SitePreviewContext
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-label={`Preview ${props.name}`}>
        Preview
      </Button>
      {open && (
        <Dialog
          title={`Preview ${props.name}`}
          closeLabel="Close preview"
          size="wide"
          onClose={() => setOpen(false)}
          footer={
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Back to sections
            </Button>
          }
        >
          <SectionLivePreview {...props} />
        </Dialog>
      )}
    </>
  )
}
