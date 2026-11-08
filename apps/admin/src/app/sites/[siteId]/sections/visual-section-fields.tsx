import { StructuredBuilder } from '../../../../components/structured-builder.tsx'
import type { VisualSectionDraft, VisualSectionProps } from './use-visual-section-draft.ts'

export function VisualSectionFields({
  model,
  siteName,
  rights,
  initial,
}: {
  model: VisualSectionDraft
  siteName: string
  rights: VisualSectionProps['rights']
  initial?: VisualSectionProps['initial']
}) {
  const {
    name,
    setName,
    effectiveSlug,
    editSlug,
    category,
    setCategory,
    placement,
    setPlacement,
    scope,
    setScope,
    document,
    changeStructure,
    css,
    setCss,
    busy,
    structureFile,
    downloadStructure,
    loadStructure,
  } = model
  return (
    <div>
      <section className="card">
        <div className="field">
          <label htmlFor="visual-section-name">Section name</label>
          <input
            id="visual-section-name"
            value={name}
            maxLength={200}
            disabled={busy}
            onChange={event => setName(event.target.value)}
          />
        </div>
        <div className="row2">
          <div className="field">
            <label htmlFor="visual-section-slug">Short name</label>
            <input
              id="visual-section-slug"
              value={effectiveSlug}
              maxLength={64}
              disabled={busy || !!initial}
              onChange={event => editSlug(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="visual-section-category">Category</label>
            <input
              id="visual-section-category"
              value={category}
              disabled={busy}
              onChange={event => setCategory(event.target.value)}
            />
          </div>
        </div>
        {rights.global && (
          <div className="field">
            <label htmlFor="visual-section-placement">Used as</label>
            <select
              id="visual-section-placement"
              value={placement}
              disabled={busy}
              onChange={event => setPlacement(event.target.value as 'page' | 'header' | 'footer')}
            >
              <option value="page">Page section</option>
              <option value="header">Site header</option>
              <option value="footer">Site footer</option>
            </select>
            <p className="hint">
              Headers and footers are edited and published in Header &amp; footer. Placement can change only before the
              component is in use.
            </p>
          </div>
        )}
        <div className="field">
          <label htmlFor="visual-section-scope">Who can use this section?</label>
          <select
            id="visual-section-scope"
            value={scope}
            disabled={busy || !!initial}
            onChange={event => setScope(event.target.value as 'site' | 'global')}
          >
            <option value="site" disabled={!rights.site}>
              Only {siteName}
            </option>
            <option value="global" disabled={!rights.global}>
              Every site
            </option>
          </select>
        </div>
      </section>
      <section className="card">
        <h2>Structure</h2>
        <StructuredBuilder document={document} onChange={changeStructure} disabled={busy} />
      </section>
      {rights.global && (
        <details className="card">
          <summary>Advanced structure and styling</summary>
          <div className="field">
            <label htmlFor="visual-section-css">Section CSS</label>
            <textarea
              id="visual-section-css"
              className="code"
              value={css}
              disabled={busy}
              onChange={event => setCss(event.target.value)}
            />
          </div>
          <button type="button" className="secondary small" disabled={busy} onClick={downloadStructure}>
            Save structure JSON
          </button>{' '}
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            onClick={() => structureFile.current?.click()}
          >
            Load structure JSON
          </button>
          <input
            type="file"
            hidden
            ref={structureFile}
            accept="application/json,.json"
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void loadStructure(file)
            }}
          />
        </details>
      )}
      {!rights.global && (
        <p className="hint">
          Visual changes preserve the approved styling. Advanced source changes are managed by a super admin.
        </p>
      )}
    </div>
  )
}
