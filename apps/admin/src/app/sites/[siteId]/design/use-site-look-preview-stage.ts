import { useEffect, useRef, useState } from 'react'
import type { HeaderConfig, FooterConfig, NavTree, ThemeTokens } from '@cms/schema'
import { queueFramePreview, requestFramePreview } from '../../../../lib/frame-preview-request.ts'
import { useSiteLookCanvas } from './use-site-look-canvas.ts'

export type SharedDraft = { header: HeaderConfig; footer: FooterConfig; menu: NavTree }

export function useSiteLookPreviewStage({
  isolatedOrigin,
  siteId,
  pageId,
  page,
  tokens,
  draft,
  retry,
  tab,
}: {
  isolatedOrigin: string | null
  siteId: string
  pageId: string
  page: string
  tokens: ThemeTokens
  draft: SharedDraft | null
  retry: number
  tab: string
}) {
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const viewport = useRef<HTMLDivElement | null>(null)
  const [available, setAvailable] = useState(0)
  const [canvasTop, setCanvasTop] = useState(280)
  const isolated = useSiteLookCanvas({
    origin: isolatedOrigin,
    siteId,
    pageId,
    versionId: page,
    look: draft ? { tokens, ...draft } : null,
    retry,
  })
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const measure = () => {
      setAvailable(
        node.clientWidth -
          Number.parseFloat(getComputedStyle(node).paddingLeft) -
          Number.parseFloat(getComputedStyle(node).paddingRight),
      )
      // Ancestor scrollIntoView movement must not increase the panel's height.
      let top = 0
      let current: HTMLElement | null = node
      while (current) {
        top += current.offsetTop
        current = current.offsetParent as HTMLElement | null
      }
      setCanvasTop(top)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  function showArea(frame: HTMLIFrameElement | null) {
    if (!frame || isolatedOrigin) return
    const view = frame.contentWindow
    const footer = frame.contentDocument?.querySelector('footer,[data-cms-frame="footer"],.footer')
    if (tab === 'footer' && view && footer)
      view.scrollTo({ top: Math.max(0, footer.getBoundingClientRect().top + view.scrollY) })
    else view?.scrollTo({ top: 0 })
  }
  useEffect(() => showArea(frameRef.current), [tab])
  const serial = JSON.stringify([page, tokens, draft])
  useEffect(() => {
    if (isolatedOrigin || !page || !draft) return
    setLoading(true)
    setError('')
    return queueFramePreview(async signal => {
      const result = await requestFramePreview(
        '/api/sites/' + siteId + '/global-elements/preview',
        { versionId: page, tokens, ...draft, previewContext: 'draft' },
        signal,
      )
      if (result.kind === 'aborted' || signal.aborted) return
      if (result.kind === 'ready') setHtml(result.html)
      else {
        setError(result.message)
        setHtml('')
      }
      setLoading(false)
    })
  }, [serial, siteId, retry, isolatedOrigin])
  const previewError = isolatedOrigin ? isolated.error : error
  const previewLoading = isolatedOrigin ? isolated.loading : loading
  return { html, frameRef, viewport, available, canvasTop, showArea, isolated, previewError, previewLoading }
}
