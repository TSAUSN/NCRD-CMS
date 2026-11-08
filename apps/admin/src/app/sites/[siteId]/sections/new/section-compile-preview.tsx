import { ScriptlessPreview } from '../../../../../components/scriptless-preview.tsx'
import { IconAlert, IconEye } from '../../../../../components/icons.tsx'
import { sitePreviewPhrase } from '../../../../../lib/preview-context.ts'
import type { HtmlSectionDraft, SectionCreatorProps } from './use-html-section-draft.ts'

export function SectionCompilePreview({
  model,
  appearance,
  previewContext = 'published',
}: {
  model: HtmlSectionDraft
} & Pick<SectionCreatorProps, 'appearance' | 'previewContext'>) {
  const { name, placement, changelog, setChangelog, report, busy, effectiveSlug, previewIsCurrent, preview, save } =
    model
  return (
    <>
      <div className="creator-aside">
        <div className="card">
          <div className="card-head">
            <h2>
              <IconEye size={16} /> Preview
            </h2>
          </div>
          {appearance}
          <p className="hint" style={{ marginTop: 0 }}>
            Every section is checked and previewed before it can be saved, so nothing reaches a page without somebody
            having seen it.
          </p>
          <div className="actions" style={{ marginTop: '.75rem' }}>
            <button type="button" className="navy wide" onClick={preview} disabled={busy || effectiveSlug === ''}>
              {busy ? 'Checking…' : previewIsCurrent ? 'Preview again' : 'Check and preview'}
            </button>
          </div>

          {report && report.blocking.length > 0 && (
            <div className="notice notice-error" role="alert" style={{ marginTop: '1rem' }}>
              <IconAlert size={16} />
              <div className="notice-body">
                <strong>This cannot be saved yet.</strong>
                <ul>
                  {report.blocking.map(problem => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {report && report.problems.length > 0 && (
            <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
              <IconAlert size={16} />
              <div className="notice-body">
                <strong>Worth fixing.</strong>
                <ul>
                  {report.problems.map(problem => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {report?.carriesTrustedCode && (
            <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
              <IconAlert size={16} />
              <span className="notice-body">
                {placement === 'page'
                  ? 'This section contains custom code. It can be saved, but every page that uses it needs a super admin’s approval before that page can go live.'
                  : 'Site headers and footers are scriptless. Remove the custom code before saving this component.'}
              </span>
            </div>
          )}

          {previewIsCurrent && report?.previewHtml && (
            <div className="creator-preview" style={{ marginTop: '1rem' }}>
              {/* `sandbox` with nothing enabled: no scripts, no forms, no
                    same-origin access. The markup has already been through the
                    compiler, and this is the second, independent reason nothing
                    in a pasted blob can reach the admin session. */}
              <p className="hint">
                Sample content with {sitePreviewPhrase(previewContext)}. Saving this component does not publish the site
                design.
              </p>
              <ScriptlessPreview title="Section preview" srcDoc={report.previewHtml} />
            </div>
          )}
          {report && !report.previewHtml && report.blocking.length === 0 && (
            <p className="muted">Nothing to show yet.</p>
          )}
          {!previewIsCurrent && report !== null && report.blocking.length === 0 && (
            <p className="hint">You have changed something since this preview. Check it again before saving.</p>
          )}

          <div className="field">
            <label htmlFor="source-change-note">What changed?</label>
            <textarea
              id="source-change-note"
              value={changelog}
              disabled={busy}
              maxLength={1000}
              onChange={event => setChangelog(event.target.value)}
              required
            />
          </div>
          <div
            className="actions"
            style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--line-soft)' }}
          >
            <button
              type="button"
              className="wide"
              onClick={save}
              disabled={busy || !previewIsCurrent || name.trim() === '' || !changelog.trim()}
            >
              Save this section
            </button>
          </div>
          {!previewIsCurrent && <p className="hint">Preview it first — that is what the button is waiting for.</p>}
        </div>
      </div>
    </>
  )
}
