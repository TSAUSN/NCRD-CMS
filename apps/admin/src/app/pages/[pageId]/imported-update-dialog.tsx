'use client'

import { useEffect, useRef } from 'react'
import { revealPreviewSection, ScriptlessPreview } from '../../../components/scriptless-preview.tsx'
import { sitePreviewPhrase } from '../../../lib/preview-context.ts'
import type { ImportedUpdatePreview } from './imported-update-actions.ts'

const KINDS: Record<string, string> = {
  text: 'Text',
  richtext: 'Formatted text',
  image: 'Image',
  link: 'Link',
  button: 'Button',
  repeat: 'Repeated items',
}

/** Review moving an imported section to the current field mapping. The page
 * renders exactly as before, so there is one preview: what changes is how the
 * section is edited, which the field list shows. */
export function ImportedUpdateDialog({
  preview,
  sectionIndex,
  busy,
  onCancel,
  onApply,
}: {
  preview: ImportedUpdatePreview | null
  sectionIndex?: number | undefined
  busy: boolean
  onCancel: () => void
  onApply: () => void
}) {
  const box = useRef<HTMLDivElement>(null),
    cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement
    cancel.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busy) onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]),iframe') ?? [])]
      const first = items[0],
        last = items.at(-1)
      if (!first || !last) return
      if (!items.includes(document.activeElement as HTMLElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [busy, onCancel])
  const shared = preview?.ok === true && preview.otherPages > 0
  return (
    <div className="overlay overlay-centre">
      <div
        className="section-upgrade-dialog imported-update-dialog"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="imported-update-title"
        aria-busy={busy}
      >
        <h2 id="imported-update-title">Update imported fields</h2>
        {!preview && <p role="status">Checking this section against the current import mapping…</p>}
        {preview && !preview.ok && (
          <p className="notice notice-warn" role="alert">
            {preview.message}
          </p>
        )}
        {preview?.ok && (
          <>
            <p>
              “{preview.sectionLabel}” was imported with an earlier field mapping. Updating its fields changes how it is
              edited — which fields it has and what they are called — not how it looks: the page below looks exactly as
              it does now. Applying saves a new version of this layout and a checkpoint of the draft; Undo restores the
              earlier fields, and the live page is unchanged until you publish.
            </p>
            {(preview.removed.length > 0 || preview.added.length > 0) && (
              <table className="imported-update-fields">
                <thead>
                  <tr>
                    <th scope="col">Fields now</th>
                    <th scope="col">After the update</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <ul>
                        {preview.removed.map(field => (
                          <li key={field.id}>
                            {field.label} <span className="replacement-kind">{KINDS[field.kind] ?? field.kind}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <ul>
                        {preview.added.map(field => (
                          <li key={field.id}>
                            {field.label} <span className="replacement-kind">{KINDS[field.kind] ?? field.kind}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
            {preview.renamed.length > 0 && (
              <table className="imported-update-fields imported-update-renames">
                <caption>Fields that get a clearer name, keeping their content</caption>
                <thead>
                  <tr>
                    <th scope="col">Name now</th>
                    <th scope="col">After the update</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.renamed.map(field => (
                    <tr key={field.id}>
                      <td>{field.from}</td>
                      <td>{field.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview.added.some(field => field.kind === 'repeat') && (
              <p className="hint">
                Numbered copies become a list: add, reorder and remove them in the inspector. Each keeps its words and
                pictures.
              </p>
            )}
            <p className="hint">
              {preview.removed.length > 0 || preview.added.length > 0
                ? 'Other fields of this section are unchanged and keep their content. Edited text carries into the new fields.'
                : 'Every field keeps its content; only the names in the page structure and inspector change.'}
            </p>
            {shared && (
              <p className="notice notice-warn">
                This layout is also used on {preview.otherPages} other {preview.otherPages === 1 ? 'page' : 'pages'}, so
                its fields cannot be updated from here.
              </p>
            )}
            <div className="section-upgrade-controls">
              <span>The preview uses {sitePreviewPhrase(preview.previewContext)}.</span>
            </div>
            <section aria-label="The page with the updated fields">
              <h3>The page with the updated fields</h3>
              <div className="section-upgrade-viewport">
                <ScriptlessPreview
                  title="Page with the updated imported fields"
                  srcDoc={preview.html}
                  style={{ width: '100%' }}
                  onLoad={event => revealPreviewSection(event.currentTarget, sectionIndex)}
                />
              </div>
            </section>
          </>
        )}
        <div className="actions">
          <button
            type="button"
            ref={cancel}
            className="secondary"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onCancel()
            }}
          >
            Cancel
          </button>
          <button type="button" disabled={busy || !preview?.ok || shared} onClick={onApply}>
            {busy ? 'Updating…' : 'Update fields in draft'}
          </button>
        </div>
      </div>
    </div>
  )
}
