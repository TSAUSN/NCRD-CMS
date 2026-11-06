'use client'

import { useRef, useState } from 'react'
import { Button, Dialog } from '../../../components/ui/index.ts'
import styles from './section-review-dialog.module.css'
import { revealPreviewSection, ScriptlessPreview } from '../../../components/scriptless-preview.tsx'
import type { ReplacementMapping } from '../../../lib/section-replacement.ts'
import { sitePreviewPhrase } from '../../../lib/preview-context.ts'
import type { ReplacementPreview } from './section-replacement-actions.ts'

const KINDS: Record<string, string> = {
  text: 'Text',
  richtext: 'Formatted text',
  image: 'Image',
  link: 'Link',
  button: 'Button',
  repeat: 'Repeated items',
  navigation: 'Site navigation',
}

/** Review a different layout for one section: choose which current content
 * fills each new field, compare both renders, then apply to the draft. Any
 * change of choice refreshes the preview before it can be applied. */
export function SectionReplacementDialog({
  preview,
  mapping,
  sectionIndex,
  busy,
  refreshing,
  onMap,
  onCancel,
  onApply,
}: {
  preview: ReplacementPreview | null
  mapping: ReplacementMapping | undefined
  sectionIndex?: number | undefined
  busy: boolean
  refreshing: boolean
  onMap: (fieldId: string, sourceId: string | null) => void
  onCancel: () => void
  onApply: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const [previewWidth, setPreviewWidth] = useState('fit')
  const width = { width: previewWidth === 'fit' ? '100%' : `${previewWidth}px` }
  return (
    <Dialog
      title="Change layout"
      size="wide"
      showClose={false}
      pending={busy}
      initialFocus={cancel}
      onClose={onCancel}
      footer={
        <>
          <Button ref={cancel} variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy || refreshing || !preview?.ok} onClick={onApply}>
            {busy ? 'Applying…' : 'Apply to draft'}
          </Button>
        </>
      }
    >
      <div className={styles.content} aria-busy={refreshing || busy}>
        {!preview && <p role="status">Preparing the layout preview…</p>}
        {preview && !preview.ok && (
          <p className="notice notice-error" role="alert">
            {preview.message}
          </p>
        )}
        {preview?.ok && (
          <>
            <p>
              “{preview.sectionLabel}” will use the <strong>{preview.target.name}</strong> layout instead of{' '}
              {preview.currentName}. Applying keeps a saved copy of the current draft and changes only this section.
              Other sections and the live page stay unchanged, and Undo restores the previous layout.
            </p>
            <fieldset className="replacement-mapping" disabled={busy}>
              <legend>Content for the new layout</legend>
              <p className="hint">
                Choose which current content fills each field of the new layout. A field left empty starts blank for you
                to fill in.
              </p>
              <table>
                <thead>
                  <tr>
                    <th scope="col">New layout field</th>
                    <th scope="col">Filled from</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.fields.map(field => {
                    const chosen = mapping && Object.hasOwn(mapping, field.id) ? mapping[field.id] : field.sourceId
                    return (
                      <tr key={field.id}>
                        <th scope="row">
                          <label htmlFor={`replacement-${field.id}`}>{field.label}</label>
                          <span className="replacement-kind">{KINDS[field.kind] ?? field.kind}</span>
                        </th>
                        <td>
                          <select
                            id={`replacement-${field.id}`}
                            value={chosen ?? ''}
                            disabled={field.choices.length === 0}
                            aria-describedby={field.choices.length === 0 ? `replacement-${field.id}-none` : undefined}
                            onChange={event => onMap(field.id, event.target.value || null)}
                          >
                            <option value="">Leave empty</option>
                            {field.choices.map(choice => (
                              <option key={choice.id} value={choice.id}>
                                {choice.label}
                              </option>
                            ))}
                          </select>
                          {field.choices.length === 0 && (
                            <p className="hint" id={`replacement-${field.id}-none`}>
                              No current content of this kind.
                            </p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </fieldset>
            {preview.unmapped.length > 0 && (
              <p className="notice notice-warn">
                Not carried over: {preview.unmapped.join(', ')}. These values stay in the saved copy and in page
                history.
              </p>
            )}
            {preview.droppedAppearance.length > 0 && (
              <p className="notice notice-warn">
                The new layout controls its own {preview.droppedAppearance.join(', ').toLowerCase()}, so those
                appearance choices are not applied.
              </p>
            )}
            {preview.droppedSource && (
              <p className="notice notice-warn">
                This section’s custom HTML or CSS was written for the old layout. It stays in the saved copy and is not
                applied to the new layout.
              </p>
            )}
            <div className="section-upgrade-controls">
              <label htmlFor="section-replacement-width">Compare at</label>
              <select
                id="section-replacement-width"
                value={previewWidth}
                onChange={event => setPreviewWidth(event.target.value)}
              >
                <option value="fit">Fit comparison</option>
                <option value="390">Phone · 390px</option>
                <option value="768">Tablet · 768px</option>
                <option value="1280">Desktop · 1280px</option>
              </select>
              <span>Both previews use {sitePreviewPhrase(preview.previewContext)}.</span>
              {refreshing && <span role="status">Updating the preview…</span>}
            </div>
            <div className={'history-preview-pair ' + styles.previews}>
              <section aria-label="Current layout">
                <h3>Current layout</h3>
                <div className="section-upgrade-viewport">
                  <ScriptlessPreview
                    title="Current section layout in the page"
                    srcDoc={preview.beforeHtml}
                    style={width}
                    className={styles.preview}
                    onLoad={event => revealPreviewSection(event.currentTarget, sectionIndex)}
                  />
                </div>
              </section>
              <section aria-label="With the new layout">
                <h3>With the new layout</h3>
                <div className="section-upgrade-viewport">
                  <ScriptlessPreview
                    title="Proposed section layout in the page"
                    srcDoc={preview.html}
                    style={width}
                    className={styles.preview}
                    onLoad={event => revealPreviewSection(event.currentTarget, sectionIndex)}
                  />
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
