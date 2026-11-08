import { useEffect, useRef, useState } from 'react'
import type { FooterConfig, HeaderConfig } from '@cms/schema'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import { queueFramePreview, requestFramePreview } from '../../../../lib/frame-preview-request.ts'
import { sitePreviewLabel, type SitePreviewContext } from '../../../../lib/preview-context.ts'
import { IconDesktop, IconEye, IconFrame, IconInfo, IconMobile, IconTablet } from '../../../../components/icons.tsx'

export function GlobalElementsPreview({
  siteId,
  siteName,
  previewPages,
  initialSitePreview,
  currentSerial,
  header,
  footer,
  active,
}: {
  siteId: string
  siteName: string
  previewPages: { title: string; versionId: string }[]
  initialSitePreview: SitePreviewContext
  currentSerial: string
  header: HeaderConfig
  footer: FooterConfig
  active: 'header' | 'footer'
}) {
  // The preview is scaled to the space it has, and shows the part being edited:
  // the top of the page for the header, the bottom for the footer.
  const stage = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(0)
  const [previewVersion, setPreviewVersion] = useState(previewPages[0]?.versionId ?? '')
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'tablet' | 'phone'>('desktop')
  const [sitePreview, setSitePreview] = useState<SitePreviewContext>(initialSitePreview)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(previewPages.length > 0)
  useEffect(() => {
    if (!previewVersion) return
    setPreviewLoading(true)
    setPreviewError('')
    setPreviewHtml('')
    return queueFramePreview(async signal => {
      const result = await requestFramePreview(
        `/api/sites/${siteId}/global-elements/preview`,
        { versionId: previewVersion, header, footer, previewContext: sitePreview },
        signal,
      )
      if (signal.aborted || result.kind === 'aborted') return
      if (result.kind === 'ready') setPreviewHtml(result.html)
      else setPreviewError(result.message)
      setPreviewLoading(false)
    })
  }, [previewVersion, currentSerial, siteId, previewAttempt, sitePreview])
  useEffect(() => {
    const node = stage.current
    if (!node) return
    const observer = new ResizeObserver(() => setStageWidth(node.clientWidth))
    observer.observe(node)
    return () => observer.disconnect()
  }, [previewVersion])
  const frameWidth = { desktop: 1280, tablet: 768, phone: 390 }[previewWidth]
  const frameScale =
    stageWidth > 0 ? Math.min((stageWidth - 24) / frameWidth, previewWidth === 'phone' ? 1.2 : 1) : null
  useEffect(() => {
    showFrameArea(stage.current?.querySelector('iframe') ?? null, active, frameScale)
  }, [active, previewHtml, frameScale])

  return (
    <aside className="global-preview" aria-label="Real page preview">
      <div className="global-preview-head">
        <div>
          <p className="eyebrow">Rendered page</p>
          <h2>Preview</h2>
        </div>
        <span>
          <IconEye size={15} />
          Draft
        </span>
      </div>
      <div className="global-preview-toolbar">
        <label htmlFor="global-preview-page">Page</label>
        <select
          id="global-preview-page"
          value={previewVersion}
          onChange={event => setPreviewVersion(event.target.value)}
        >
          {previewPages.map(page => (
            <option value={page.versionId} key={page.versionId}>
              {page.title}
            </option>
          ))}
        </select>
        <label htmlFor="global-preview-site">Site design</label>
        <select
          id="global-preview-site"
          value={sitePreview}
          onChange={event => setSitePreview(event.target.value === 'draft' ? 'draft' : 'published')}
        >
          <option value="draft">{sitePreviewLabel('draft')}</option>
          <option value="published">{sitePreviewLabel('published')}</option>
        </select>
        <div className="global-preview-widths" aria-label="Preview width">
          {(
            [
              ['desktop', 'Desktop', IconDesktop],
              ['tablet', 'Tablet', IconTablet],
              ['phone', 'Phone', IconMobile],
            ] as const
          ).map(([width, label, Mark]) => (
            <button
              type="button"
              className={previewWidth === width ? 'on' : ''}
              aria-pressed={previewWidth === width}
              key={width}
              onClick={() => setPreviewWidth(width)}
            >
              <Mark size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>
      {previewVersion ? (
        <div
          ref={stage}
          className={`global-real-preview is-${previewWidth} ${previewLoading ? 'is-loading' : ''}`}
          style={frameScale ? { ['--frame-scale' as string]: String(frameScale) } : undefined}
        >
          {previewError ? (
            <div className="notice notice-error" role="alert">
              <span>{previewError}</span>
              <button type="button" className="small secondary" onClick={() => setPreviewAttempt(value => value + 1)}>
                Retry preview
              </button>
            </div>
          ) : (
            <ScriptlessPreview
              title={`${siteName} header and footer preview`}
              srcDoc={previewHtml}
              onLoad={event => showFrameArea(event.currentTarget, active, frameScale)}
            />
          )}
          <span>
            {previewLoading ? 'Rendering…' : previewError ? 'Preview unavailable' : `${previewWidth} preview`}
          </span>
        </div>
      ) : (
        <div className="global-preview-empty">
          <IconFrame size={24} />
          <strong>Create a page to preview the frame</strong>
          <span>The editor will render actual page content here.</span>
        </div>
      )}
      <p className="global-preview-note">
        <IconInfo size={15} />
        The public renderer is used here, with this{' '}
        {sitePreview === 'draft' ? 'site’s saved menu and design' : 'site’s live menu and design'} around the header and
        footer you are editing. Page content and media are not mocked.
      </p>
    </aside>
  )
}

/**
 * Bring the frame being edited into the preview: the page top for the header,
 * the footer for the footer. The preview's own window scrolls first; when the
 * page is shorter than the frame there is nothing to scroll, so the scaled
 * frame is also moved up within its box until the footer shows.
 */
function showFrameArea(frame: HTMLIFrameElement | null, area: 'header' | 'footer', scale: number | null) {
  const view = frame?.contentWindow
  const doc = frame?.contentDocument
  const box = frame?.parentElement
  if (!frame || !view || !doc || !box) return
  const footer = area === 'footer' ? doc.querySelector('footer') : null
  view.scrollTo({
    top: footer ? Math.max(0, footer.getBoundingClientRect().top + view.scrollY - 24) : 0,
    behavior: 'instant',
  })
  const factor = scale ?? (frame.getBoundingClientRect().width / frame.offsetWidth || 1)
  const remaining = footer ? Math.max(0, footer.getBoundingClientRect().top - 24) * factor : 0
  const room = Math.max(0, frame.offsetHeight * factor + 16 - box.clientHeight)
  frame.style.setProperty('--frame-offset', `${Math.round(Math.min(remaining, room))}px`)
}
