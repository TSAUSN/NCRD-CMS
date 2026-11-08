import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { type ThemeTokens } from '@cms/schema'
import { checkContrast } from '@cms/domain'
import { IconAlert, IconCheck, IconEye, IconInfo } from '../../../../components/icons.tsx'
import { queueFramePreview, requestFramePreview } from '../../../../lib/frame-preview-request.ts'
import { serializeThemeTokens } from './use-theme-draft.ts'

type ThemeStyle = CSSProperties & Record<`--${string}`, string>

export function ThemeEditorPreview({
  siteId,
  siteName,
  pages,
  tokens,
  contrastReady,
}: {
  siteId: string
  siteName: string
  pages: { title: string; versionId: string }[]
  tokens: ThemeTokens
  contrastReady: boolean
}) {
  const [previewVersion, setPreviewVersion] = useState(pages[0]?.versionId ?? '')
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'tablet' | 'phone'>('desktop')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(pages.length > 0)
  const contrastChecks = useMemo(
    () => [
      { name: 'Body text', verdict: checkContrast(tokens.colors.ink, tokens.colors.surface) },
      { name: 'Primary button', verdict: checkContrast(tokens.colors.primaryContrast, tokens.colors.primary) },
      { name: 'Accent button', verdict: checkContrast(tokens.colors.accentContrast, tokens.colors.accent) },
    ],
    [tokens.colors],
  )
  useEffect(() => {
    if (!previewVersion) return
    setPreviewHtml('')
    setPreviewError('')
    if (!Object.values(tokens.colors).every(value => /^#[0-9a-f]{6}$/i.test(value))) {
      setPreviewLoading(false)
      setPreviewError('Enter complete six-digit colours to preview this design.')
      return
    }
    setPreviewLoading(true)
    return queueFramePreview(async signal => {
      const result = await requestFramePreview(
        `/api/sites/${siteId}/design/preview`,
        { versionId: previewVersion, tokens },
        signal,
      )
      if (signal.aborted || result.kind === 'aborted') return
      if (result.kind === 'ready') setPreviewHtml(result.html)
      else setPreviewError(result.message)
      setPreviewLoading(false)
    })
  }, [previewVersion, serializeThemeTokens(tokens), siteId, previewAttempt])
  const chosenButtonColor = tokens.buttons.color === 'accent' ? tokens.colors.accent : tokens.colors.primary
  const chosenButtonInk =
    tokens.buttons.color === 'accent' ? tokens.colors.accentContrast : tokens.colors.primaryContrast
  const previewStyle: ThemeStyle = {
    '--theme-primary': tokens.colors.primary,
    '--theme-accent': tokens.colors.accent,
    '--theme-surface': tokens.colors.surface,
    '--theme-surface-alt': tokens.colors.surfaceAlt,
    '--theme-ink': tokens.colors.ink,
    '--theme-muted': tokens.colors.muted,
    '--theme-button': chosenButtonColor,
    '--theme-button-ink': chosenButtonInk,
    '--theme-radius': tokens.radius,
    '--theme-button-radius': tokens.buttons.radius,
    '--theme-heading': tokens.fonts.heading,
    '--theme-body': tokens.fonts.body,
    '--theme-density': tokens.spacing === 'compact' ? '.82' : tokens.spacing === 'spacious' ? '1.18' : '1',
    '--theme-speed': tokens.buttons.speed === 'fast' ? '100ms' : tokens.buttons.speed === 'slow' ? '300ms' : '180ms',
  }
  return (
    <aside className="theme-preview" style={previewStyle} aria-labelledby="theme-preview-title">
      <div className="theme-preview-head">
        <div>
          <p className="eyebrow">Live draft preview</p>
          <h2 id="theme-preview-title">Preview</h2>
        </div>
        <span>
          <IconEye size={14} /> Actual page
        </span>
      </div>
      {pages.length > 0 ? (
        <>
          <div className="theme-preview-toolbar">
            <label htmlFor="theme-preview-page">Page</label>
            <select
              id="theme-preview-page"
              value={previewVersion}
              onChange={event => setPreviewVersion(event.target.value)}
            >
              {pages.map(page => (
                <option key={page.versionId} value={page.versionId}>
                  {page.title}
                </option>
              ))}
            </select>
            <div className="theme-preview-widths" aria-label="Public preview width">
              {(['desktop', 'tablet', 'phone'] as const).map(width => (
                <button
                  type="button"
                  key={width}
                  className={previewWidth === width ? 'on' : ''}
                  aria-pressed={previewWidth === width}
                  onClick={() => setPreviewWidth(width)}
                >
                  {width[0]!.toUpperCase() + width.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className={`theme-real-preview is-${previewWidth} ${previewLoading ? 'is-loading' : ''}`}>
            {previewError ? (
              <div className="notice notice-error" role="alert">
                <span>{previewError}</span>
                <button type="button" className="small secondary" onClick={() => setPreviewAttempt(value => value + 1)}>
                  Retry preview
                </button>
              </div>
            ) : (
              previewHtml && <ScriptlessPreview title="Draft theme page preview" srcDoc={previewHtml} />
            )}
            {previewLoading && <span role="status">Updating the page preview…</span>}
          </div>
        </>
      ) : (
        <div className="theme-preview-page">
          <header>
            <strong>{siteName}</strong>
            <nav aria-label="Example site navigation">
              <a href="#preview">About</a>
              <a href="#preview">Resources</a>
            </nav>
          </header>
          <main id="preview">
            <p className="theme-preview-kicker">A shared visual language</p>
            <h3>Make every page feel like the same site.</h3>
            <p>
              Editors choose meaningful content. The design system keeps colour, type, spacing and actions consistent.
            </p>
            <div className="theme-preview-actions">
              <a
                href="#preview"
                className="theme-preview-button"
                data-style={tokens.buttons.style}
                data-hover={tokens.buttons.hover}
              >
                Primary action
              </a>
              <a href="#preview" className="theme-preview-link">
                Supporting link
              </a>
            </div>
            <article>
              <strong>Reusable card</strong>
              <p>This soft surface and muted copy show the secondary roles.</p>
            </article>
          </main>
        </div>
      )}
      <div className={`theme-readiness ${contrastReady ? 'ready' : 'blocked'}`}>
        {contrastReady ? <IconCheck size={16} /> : <IconAlert size={16} />}
        <div>
          <strong>{contrastReady ? 'Contrast is ready to publish' : 'Contrast needs attention'}</strong>
          <ul>
            {contrastChecks.map(check => (
              <li key={check.name}>
                {check.name}: {check.verdict?.display ?? 'not a colour yet'}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="theme-preview-note">
        <IconInfo size={14} /> This is the selected page rendered through the public renderer with the private draft
        theme substituted. Visitors keep the published theme until you publish.
      </p>
    </aside>
  )
}
