import { IconCode } from '../../../../../components/icons.tsx'
import type { HtmlSectionDraft } from './use-html-section-draft.ts'

export function SectionMarkup({ model }: { model: HtmlSectionDraft }) {
  const { html, setHtml, css, setCss, organization, beforeOrganization, busy, organize, restoreOrganization } = model
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            <IconCode size={16} /> The markup
          </h2>
        </div>
        <label htmlFor="sec-html">HTML</label>
        <textarea
          id="sec-html"
          className="code"
          value={html}
          spellCheck={false}
          disabled={busy}
          onChange={event => setHtml(event.target.value)}
        />
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={organize}>
            Organize into blocks
          </button>
          {beforeOrganization && (
            <button type="button" className="secondary" disabled={busy} onClick={restoreOrganization}>
              Restore pre-organization draft
            </button>
          )}
        </div>
        {organization && (
          <div aria-live="polite">
            {organization.blocking.map((message, index) => (
              <p className="notice notice-error" role="alert" key={index}>
                {message}
              </p>
            ))}
            {!organization.blocking.length && (
              <p className="notice notice-ok" role="status">
                Editable fields proposed. Review the fields and samples, then check the preview.
              </p>
            )}
            <ul>
              {organization.notes.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
            <details>
              <summary>Compare with original source</summary>
              <label htmlFor="original-source-html">Original HTML</label>
              <textarea id="original-source-html" className="code" readOnly value={organization.originalHtml} />
              <label htmlFor="original-source-css">Original CSS</label>
              <textarea id="original-source-css" className="code" readOnly value={organization.originalCss} />
            </details>
          </div>
        )}
        <p className="hint">
          Write <code className="mono">{'{{heading}}'}</code> anywhere you want an editable field. Scripts, forms and
          embeds are not allowed here — a section that could run code is a section nobody could safely hand to a
          contributor.
        </p>

        <label htmlFor="sec-css" style={{ marginTop: '1rem' }}>
          CSS
        </label>
        <textarea
          id="sec-css"
          className="code"
          value={css}
          spellCheck={false}
          disabled={busy}
          onChange={event => setCss(event.target.value)}
        />
        <p className="hint">
          Your rules are confined to this section automatically, so they cannot leak out and change the rest of the
          page.
        </p>
      </div>
    </>
  )
}
