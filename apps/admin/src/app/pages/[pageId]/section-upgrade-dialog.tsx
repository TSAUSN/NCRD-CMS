'use client'

import { revealPreviewSection, ScriptlessPreview } from '../../../components/scriptless-preview.tsx'

import { useRef, useState } from 'react'
import { Button, Dialog } from '../../../components/ui/index.ts'
import styles from './section-review-dialog.module.css'
import type { UpgradePreview } from './section-upgrade-actions.ts'
import { sitePreviewPhrase } from '../../../lib/preview-context.ts'

export function SectionUpgradeDialog({
  preview,
  sectionIndex,
  busy,
  onCancel,
  onApply,
}: {
  preview: UpgradePreview | null
  sectionIndex?: number | undefined
  busy: boolean
  onCancel: () => void
  onApply: () => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const [previewWidth, setPreviewWidth] = useState('fit')
  return (
    <Dialog
      title="Review section update"
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
          <Button disabled={busy || !preview?.ok} onClick={onApply}>
            {busy ? 'Applying…' : 'Apply to draft'}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <p>
          Applying the update keeps a recovery checkpoint and changes only this draft; the live page stays unchanged.
        </p>
        {!preview && <p role="status">Preparing the update preview…</p>}
        {preview && !preview.ok && (
          <p className="notice notice-error" role="alert">
            {preview.message}
          </p>
        )}
        {preview?.ok && (
          <>
            <p>
              Update to version {preview.version}. The preview preserves compatible content. New and incompatible fields
              remain empty until you fill them.
            </p>
            {preview.plan.added.length > 0 && <p>New fields to fill: {preview.plan.added.join(', ')}.</p>}
            {preview.plan.changed.length > 0 && (
              <p>Changed field types need new values: {preview.plan.changed.join(', ')}.</p>
            )}
            {preview.plan.removed.length > 0 && (
              <p>
                Fields removed from this draft: {preview.plan.removed.join(', ')}. Their old values remain in the
                checkpoint.
              </p>
            )}
            <div className="section-upgrade-controls">
              <label htmlFor="section-upgrade-width">Compare at</label>
              <select
                id="section-upgrade-width"
                value={previewWidth}
                onChange={event => setPreviewWidth(event.target.value)}
              >
                <option value="fit">Fit comparison</option>
                <option value="390">Phone · 390px</option>
                <option value="768">Tablet · 768px</option>
                <option value="1280">Desktop · 1280px</option>
              </select>
              <span>Both previews use {sitePreviewPhrase(preview.previewContext)}.</span>
            </div>
            {preview.previewContext === 'draft' && (
              <p className="hint">
                Only saved site changes are included. Applying this section update does not publish site settings.
              </p>
            )}
            <div className={'history-preview-pair ' + styles.previews}>
              <section aria-label="Current draft">
                <h3>Current draft</h3>
                <div className="section-upgrade-viewport">
                  <ScriptlessPreview
                    title="Current section version in the page"
                    srcDoc={preview.beforeHtml}
                    className={styles.preview}
                    style={{ width: previewWidth === 'fit' ? '100%' : `${previewWidth}px` }}
                    onLoad={event => revealPreviewSection(event.currentTarget, sectionIndex)}
                  />
                </div>
              </section>
              <section aria-label="With this update">
                <h3>With this update</h3>
                <div className="section-upgrade-viewport">
                  <ScriptlessPreview
                    title="Proposed section update in the page"
                    srcDoc={preview.html}
                    className={styles.preview}
                    style={{ width: previewWidth === 'fit' ? '100%' : `${previewWidth}px` }}
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
