'use client'
import { useState } from 'react'
import type { AuthoringRights } from '../../../../lib/queries.ts'
import type { DefinitionSource } from '../../../../lib/definition-source.ts'
import { SectionCreator } from './new/creator.tsx'
import type { SitePreviewContext } from '../../../../lib/preview-context.ts'
import { VisualSectionCreator } from './visual-section-creator.tsx'

export function SectionAuthor({
  siteId,
  siteName,
  rights,
  initial,
}: {
  siteId: string
  siteName: string
  rights: AuthoringRights
  initial?: DefinitionSource
}) {
  const [previewContext, setPreviewContext] = useState<SitePreviewContext>('published')
  const [mode, setMode] = useState<'structured' | 'legacy'>(initial?.kind ?? 'structured')
  const [busy, setBusy] = useState(false)
  if (initial && !rights.global && (initial.kind !== 'structured' || initial.placement !== 'page'))
    return (
      <div className="empty-state">
        <h2>This section uses advanced source</h2>
        <p>A super admin can revise this definition. Its current version remains available for page editing.</p>
      </div>
    )
  const modeSwitch =
    !initial && rights.global ? (
      <div className="creator-mode">
        <div className="group" role="group" aria-label="Section authoring mode">
          <button
            type="button"
            disabled={busy}
            aria-pressed={mode === 'structured'}
            onClick={() => setMode('structured')}
          >
            Visual builder
          </button>
          <button type="button" disabled={busy} aria-pressed={mode === 'legacy'} onClick={() => setMode('legacy')}>
            HTML template
          </button>
        </div>
        <p className="hint">Each tool keeps a separate draft while you switch.</p>
      </div>
    ) : null
  const appearance = (
    <div className="field creator-appearance">
      <label htmlFor="creator-preview-context">Preview appearance</label>
      <select
        id="creator-preview-context"
        value={previewContext}
        disabled={busy}
        onChange={event => setPreviewContext(event.target.value as SitePreviewContext)}
      >
        <option value="published">Published site settings</option>
        <option value="draft">Saved site drafts</option>
      </select>
      <p className="hint">
        {previewContext === 'draft'
          ? 'Saved header, footer, navigation and design; unsaved changes are excluded.'
          : 'The site settings currently published.'}
      </p>
    </div>
  )
  return (
    <>
      {/* Keep both drafts mounted: switching tools must not discard authored work. */}
      <div hidden={mode !== 'structured'}>
        <VisualSectionCreator
          siteId={siteId}
          siteName={siteName}
          rights={rights}
          onBusy={setBusy}
          previewContext={previewContext}
          modeSwitch={mode === 'structured' ? modeSwitch : null}
          appearance={mode === 'structured' ? appearance : null}
          {...(initial?.kind === 'structured' ? { initial } : {})}
        />
      </div>
      {rights.global && (
        <div hidden={mode !== 'legacy'}>
          <SectionCreator
            siteId={siteId}
            siteName={siteName}
            rights={rights}
            onBusy={setBusy}
            previewContext={previewContext}
            modeSwitch={mode === 'legacy' ? modeSwitch : null}
            appearance={mode === 'legacy' ? appearance : null}
            {...(initial?.kind === 'legacy' ? { initial } : {})}
          />
        </div>
      )}
    </>
  )
}
