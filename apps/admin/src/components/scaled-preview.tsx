'use client'
import { useEffect, useRef, useState } from 'react'
import { ScriptlessPreview } from './scriptless-preview.tsx'
import { Button, Note } from './ui/index.ts'
import styles from './section-live-preview.module.css'
/** Shared, scriptless section preview. Normal links remain inside its frame. */
export function ScaledPreview({
  src,
  title,
  readySelector,
  backLabel = 'Back to map preview',
  bounded = false,
  width = 1100,
}: {
  src: string
  title: string
  readySelector: string
  backLabel?: string
  bounded?: boolean
  width?: number
}) {
  const space = useRef<HTMLDivElement>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const [available, setAvailable] = useState(0)
  const [height, setHeight] = useState(500)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'article'>('loading')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const node = space.current
    if (!node) return
    const resize = new ResizeObserver(() => setAvailable(node.clientWidth))
    resize.observe(node)
    setAvailable(node.clientWidth)
    return () => resize.disconnect()
  }, [])
  useEffect(() => {
    setState('loading')
  }, [src, retry])
  useEffect(() => () => observer.current?.disconnect(), [])
  const scale = Math.min(1, available / width)
  return (
    <div className={styles.root}>
      {state === 'loading' && <p role="status">Loading preview…</p>}
      {state === 'error' && (
        <Note tone="warning">
          The preview could not be opened. Your choices are still here.{' '}
          <Button variant="secondary" onClick={() => setRetry(n => n + 1)}>
            Try again
          </Button>
        </Note>
      )}
      {state === 'article' && (
        <Button variant="secondary" onClick={() => setRetry(n => n + 1)}>
          {backLabel}
        </Button>
      )}
      <div ref={space} className={styles.viewport + (bounded ? ' ' + styles.bounded : '')} hidden={state === 'error'}>
        <div className={styles.stage} style={{ width: width * scale, height: height * scale }}>
          <ScriptlessPreview
            key={retry}
            title={title}
            src={src}
            className={styles.frame}
            style={{ width, height, transform: `scale(${scale})` }}
            onLoad={event => {
              observer.current?.disconnect()
              const doc = event.currentTarget.contentDocument
              const body = doc?.body
              if (!body || (!doc.querySelector(readySelector) && !doc.querySelector('#cms-main'))) {
                setState('error')
                return
              }
              setState(doc.querySelector(readySelector) ? 'ready' : 'article')
              const measure = () => setHeight(Math.ceil(body.getBoundingClientRect().height))
              observer.current = new ResizeObserver(measure)
              observer.current.observe(body)
              measure()
            }}
          />
        </div>
      </div>
    </div>
  )
}
