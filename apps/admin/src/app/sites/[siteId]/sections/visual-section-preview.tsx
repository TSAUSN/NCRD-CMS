import type { ReactNode } from 'react'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import { sitePreviewPhrase, type SitePreviewContext } from '../../../../lib/preview-context.ts'
import type { VisualSectionDraft } from './use-visual-section-draft.ts'

export function VisualSectionPreview({
  model,
  appearance,
  previewContext,
  editing,
}: {
  model: VisualSectionDraft
  appearance: ReactNode
  previewContext: SitePreviewContext
  editing: boolean
}) {
  const {
    report,
    previewed,
    currentPreview,
    busy,
    effectiveSlug,
    run,
    previewWidth,
    setPreviewWidth,
    changelog,
    setChangelog,
    name,
  } = model
  return (
    <div>
      <section className="card">
        <h2>Check the result</h2>
        {appearance}
        <p>
          The preview uses sample content and {sitePreviewPhrase(previewContext)}. Actual page content stays separate.
        </p>
        <button type="button" className="secondary" disabled={busy || !effectiveSlug} onClick={() => void run(false)}>
          {busy ? 'Checking…' : 'Check and preview'}
        </button>
        {report?.blocking.map((problem, index) => (
          <p className="notice notice-error" role="alert" key={index}>
            {problem}
          </p>
        ))}
        {report?.problems.map((problem, index) => (
          <p className="hint" key={index}>
            {problem}
          </p>
        ))}
        {currentPreview && report?.previewHtml && (
          <>
            <div className="group" role="group" aria-label="Visual section preview width">
              {[
                { label: 'Desktop', width: 1280 },
                { label: 'Tablet', width: 768 },
                { label: 'Phone', width: 390 },
              ].map(device => (
                <button
                  type="button"
                  key={device.label}
                  className="secondary small"
                  aria-pressed={previewWidth === device.width}
                  onClick={() => setPreviewWidth(device.width)}
                >
                  {device.label}
                </button>
              ))}
            </div>
            <p className="hint">Visitor viewport · {previewWidth}px</p>
            <div className="section-live-preview-scroll">
              <ScriptlessPreview
                className="visual-section-preview"
                title="Visual section preview"
                style={{ width: previewWidth, maxWidth: 'none' }}
                srcDoc={report.previewHtml}
              />
            </div>
          </>
        )}
        {previewed && !currentPreview && (
          <p className="hint">
            The section or preview appearance changed after this preview. Check it again before saving.
          </p>
        )}
        <div className="field">
          <label htmlFor="section-change-note">What changed?</label>
          <textarea
            id="section-change-note"
            value={changelog}
            disabled={busy}
            maxLength={1000}
            onChange={event => setChangelog(event.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={busy || !currentPreview || !name.trim() || !changelog.trim()}
          onClick={() => void run(true)}
        >
          {editing ? 'Save new section version' : 'Save this section'}
        </button>
      </section>
    </div>
  )
}
