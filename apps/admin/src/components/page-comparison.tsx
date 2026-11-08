'use client'
import { useEffect, useRef, useState } from 'react'
import { ScriptlessPreview } from './scriptless-preview.tsx'
import styles from './page-comparison.module.css'
export function PageComparison({
  source,
  html,
  title,
  width,
  viewportHeight,
}: {
  source?: string
  html?: string
  title: string
  width: number
  viewportHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [box, setBox] = useState(0)
  const [naturalHeight, setNaturalHeight] = useState(0)
  function measure() {
    const document = frameRef.current?.contentDocument
    if (!document?.body) return
    const bottom = Math.max(
      0,
      ...[...document.body.children]
        .filter(node => !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName))
        .map(node => node.getBoundingClientRect().bottom + (document.defaultView?.scrollY ?? 0)),
    )
    if (bottom) setNaturalHeight(Math.ceil(bottom))
  }
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(() => setBox(node.clientWidth))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const timer = setTimeout(measure, 0)
    return () => clearTimeout(timer)
  }, [width, source, html])
  const scale = box ? Math.min(1, box / width) : 1
  return (
    <div
      className={styles.previewViewport}
      ref={ref}
      style={{
        maxWidth: width,
        ...(viewportHeight
          ? { height: viewportHeight * scale }
          : naturalHeight
            ? { height: naturalHeight * scale }
            : {}),
      }}
    >
      <ScriptlessPreview
        ref={frameRef}
        title={title}
        src={source}
        srcDoc={html}
        onLoad={() => {
          measure()
          void frameRef.current?.contentDocument?.fonts.ready.then(measure)
        }}
        style={{ width, height: viewportHeight ?? (naturalHeight || 900), transform: `scale(${scale})` }}
      />
    </div>
  )
}
