import { useEffect, useRef, useState } from 'react'
import { IconAlert, IconChevronLeft, IconPlus } from '../../../components/icons.tsx'
import { SectionLivePreview } from '../../../components/section-live-preview.tsx'
import type { LibraryEntry } from './editor.tsx'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'

export function LibraryPreviewDialog({
  entry,
  siteId,
  previewContext,
  placement,
  replacing,
  onBack,
  onChoose,
}: {
  entry: LibraryEntry
  siteId: string
  previewContext: SitePreviewContext
  placement: string
  replacing: boolean
  onBack: () => void
  onChoose: () => void
}) {
  const [previewReady, setPreviewReady] = useState(false)
  const box = useRef<HTMLDialogElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement
    const dialog = box.current
    if (dialog && !dialog.open) dialog.showModal()
    back.current?.focus()
    return () => {
      dialog?.close()
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])
  return (
    <dialog
      ref={box}
      className="section-preview-dialog library-preview-dialog"
      aria-labelledby="library-preview-title"
      onCancel={event => {
        event.preventDefault()
        onBack()
      }}
    >
      <div className="section-preview-dialog-head">
        <div>
          <h3 id="library-preview-title">{entry.name}</h3>
          <p className="muted">
            {entry.category || 'Other'} · {entry.scope === 'site' ? 'This site only' : 'Shared across sites'}
          </p>
        </div>
        <button ref={back} type="button" className="secondary small" onClick={onBack}>
          <IconChevronLeft size={14} /> Back to sections
        </button>
      </div>
      <SectionLivePreview
        onReady={setPreviewReady}
        previewContext={previewContext}
        siteId={siteId}
        definitionId={entry.section_def_id}
        name={entry.name}
      />
      <div className="library-preview-foot">
        <div>
          {entry.slots.length === 0 ? (
            <p>This section has no page-specific fields.</p>
          ) : (
            <p className="library-preview-fields">
              <span>You can edit</span>
              {entry.slots.map(slot => (
                <span className="chip chip-neutral" key={slot.id}>
                  {slot.label}
                </span>
              ))}
            </p>
          )}
          <p className="hint">
            {entry.used_on_pages === 0
              ? 'It is not used on another page yet.'
              : `It is already used on ${entry.used_on_pages} ${entry.used_on_pages === 1 ? 'page' : 'pages'}.`}
          </p>
          {entry.carries_trusted_code && (
            <p className="section-card-warn">
              <IconAlert size={13} />
              Contains custom code — needs approval before the page goes live
            </p>
          )}
        </div>
        <button type="button" disabled={!previewReady} onClick={onChoose}>
          {replacing ? (
            <>Review this layout</>
          ) : (
            <>
              <IconPlus size={15} /> Add here {placement}
            </>
          )}
        </button>
      </div>
    </dialog>
  )
}

/**
 * How many cards are on a row right now, read off the grid rather than assumed.
 *
 * Arrow-down has to move by one row, and the row length is whatever the CSS
 * `auto-fill` produced at this window width. Hard-coding it would make the
 * keyboard and the eye disagree at every size but one.
 */
