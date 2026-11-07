'use client'

import { useEffect, useRef, useState } from 'react'
import { compareVersions, comparisonText } from '../../../lib/version-comparison.ts'
import type { RecoveryReview, usePageRecovery } from './use-page-recovery.ts'
import shared from './page-recovery-panel-styles.module.css'
import { IconLock } from '../../../components/icons.tsx'

type Recovery = ReturnType<typeof usePageRecovery>
const statusText = (recovery: Recovery) =>
  recovery.storageError
    ? 'Unavailable'
    : recovery.writePending
      ? 'Keeping copy…'
      : recovery.stored
        ? 'Copy kept'
        : recovery.storageReady
          ? 'Ready'
          : 'Checking…'

/**
 * Browser recovery's state, beside “All changes saved” in the editor bar: one
 * line that is always visible, with the explanation a click away. It used to
 * be a full-width strip of its own under the bar, costing the canvas 29px
 * while saying “Ready” (reference 03). Problems and copies to review still
 * appear below the bar, where they cannot be missed.
 */
export function RecoveryStatus({ recovery, limitedHistory }: { recovery: Recovery; limitedHistory: boolean }) {
  const box = useRef<HTMLDetailsElement>(null),
    sheet = useRef<HTMLDivElement>(null)
  // Fixed rather than absolute: the bar's controls scroll sideways on narrow
  // screens, and a panel inside that scroller would be clipped.
  function place() {
    const summary = box.current?.querySelector('summary'),
      panel = sheet.current
    if (!summary || !panel) return
    const edge = summary.getBoundingClientRect()
    panel.style.top = `${Math.round(edge.bottom + 6)}px`
    panel.style.right = `${Math.max(8, Math.round(window.innerWidth - edge.right))}px`
  }
  useEffect(() => {
    function close(event: Event) {
      const details = box.current
      if (!details?.open) return
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        details.open = false
        details.querySelector('summary')?.focus()
        return
      }
      if (!details.contains(event.target as Node)) details.open = false
    }
    function resize() {
      if (box.current?.open) place()
    }
    // A click in the canvas frame never reaches this document; it blurs it.
    function blur() {
      if (box.current?.open) box.current.open = false
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', close, true)
    window.addEventListener('resize', resize)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', close, true)
      window.removeEventListener('resize', resize)
      window.removeEventListener('blur', blur)
    }
  }, [])
  // Nothing to say unless something needs the editor: a copy waiting to be
  // reviewed, or a browser that cannot keep one. Keeping a copy while somebody
  // types is the normal case, and the saved state beside it already says what
  // matters; announcing it made the bar jump on every keystroke. The words stay
  // for assistive technology and the bar shows a small mark instead.
  const quiet = !recovery.storageError && recovery.candidates.length === 0
  return (
    <details
      ref={box}
      className={`recovery-status${recovery.storageError ? ' is-unavailable' : ''}${quiet ? ' is-quiet' : ''}`}
      onToggle={() => {
        if (box.current?.open) place()
      }}
    >
      <summary title="Browser recovery: unsaved work is kept on this device until it is saved">
        {quiet && <IconLock size={14} />}
        <span className="recovery-label">Recovery ·</span>{' '}
        <span className="recovery-words" role="status" aria-label="Browser recovery status">
          {statusText(recovery)}
        </span>
        {recovery.candidates.length > 0 && <strong> · {recovery.candidates.length} to review</strong>}
      </summary>
      <div ref={sheet} className="recovery-popover" role="group" aria-label="Browser recovery">
        <p>
          A private browser copy keeps unsaved work for up to 7 days on this device, for this account and page. Saved
          still means the server acknowledged your changes.
        </p>
        <p>
          {limitedHistory
            ? 'This browser cannot pause every Back/Forward move.'
            : 'This browser can pause supported Back/Forward moves; other history moves may still leave immediately.'}{' '}
          Wait for “Copy kept” before leaving with unsaved work. Browser storage can be cleared or become unavailable.
        </p>
        <button
          type="button"
          className="secondary small"
          disabled={recovery.busy}
          onClick={() => void recovery.refresh()}
        >
          Refresh browser copies
        </button>
      </div>
    </details>
  )
}

/** What browser recovery needs the editor to see now: problems, copies to
 * review and the review itself. Nothing at all when there is none. */
export function PageRecoveryPanel({ recovery }: { recovery: Recovery }) {
  const failed = recovery.error && !recovery.review
  if (!recovery.storageError && !failed && recovery.candidates.length === 0 && !recovery.review) return null
  return (
    <div className={'editor-recovery ' + shared.recoveryStrip} aria-label="Browser recovery">
      {recovery.storageError && (
        <p className="notice notice-warn" role="alert">
          Browser recovery is unavailable: {recovery.storageError} Keep this page open until your changes are saved.
        </p>
      )}
      {failed && (
        <p className="notice notice-warn" role="alert">
          {recovery.error}
        </p>
      )}
      {recovery.candidates.length > 0 && (
        <div className="recovery-copies" role="status">
          <strong>Unsaved work is available on this browser.</strong>
          {recovery.candidates.map(record => (
            <button
              key={record.key}
              type="button"
              className="secondary small"
              disabled={recovery.busy}
              onClick={() => void recovery.openReview(record)}
            >
              Review copy from {new Date(record.updatedAt).toLocaleString()}
            </button>
          ))}
        </div>
      )}
      {recovery.review && (
        <RecoveryDialog
          key={`${recovery.review.record.key}:${recovery.review.record.sequence}`}
          review={recovery.review}
          busy={recovery.busy}
          error={recovery.error}
          onCancel={recovery.closeReview}
          applyReady={recovery.applyReady}
          onApply={accept => void recovery.applyReview(accept)}
          onDiscard={() => void recovery.discardReview()}
        />
      )}
    </div>
  )
}

function RecoveryDialog({
  review,
  busy,
  error,
  applyReady,
  onCancel,
  onApply,
  onDiscard,
}: {
  review: RecoveryReview
  busy: boolean
  error: string | null
  onCancel(): void
  onApply(accept: boolean): void
  onDiscard(): void
  applyReady: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null)
  const [accept, setAccept] = useState(false),
    [discard, setDiscard] = useState(false)
  useEffect(() => {
    const opener = document.activeElement
    const node = dialog.current
    node?.showModal()
    cancel.current?.focus()
    return () => {
      node?.close()
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])
  const version = (document: RecoveryReview['head']['document']) => ({
    page_title: '',
    page_slug: '',
    content: document.sections,
    meta: document.meta,
  })
  const changes = compareVersions(version(review.head.document), version(review.record.document))
  return (
    <dialog
      ref={dialog}
      role="dialog"
      className={'recovery-dialog ' + shared.reviewDialog}
      aria-labelledby="recovery-title"
      onCancel={event => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <h2 id="recovery-title">{discard ? 'Discard this browser copy?' : 'Review browser recovery'}</h2>
      {discard ? (
        <p>
          This deletes only the browser copy you reviewed. Saved versions and the live page stay unchanged. Discarding
          the copy cannot be undone.
        </p>
      ) : (
        <>
          <p>
            Compare the saved draft with this browser copy from {new Date(review.record.updatedAt).toLocaleString()}.
            Sections are compared by position. Applying replaces the draft on screen as one undo step; ordinary saving
            creates a new private version.
          </p>
          {review.changedBase && (
            <p className="notice notice-warn">
              The saved draft has changed since this copy began. Review every difference before applying it.
            </p>
          )}
          {!applyReady && (
            <p className="notice notice-warn">
              Save the changes currently on screen and finish any pending action before applying another copy. Cancel
              keeps your current work intact.
            </p>
          )}
          <div className="recovery-comparison" role="region" aria-label="Recovery differences" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Content</th>
                  <th>Saved draft</th>
                  <th>Browser copy</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change, index) => (
                  <tr key={index}>
                    <th scope="row">{change.label}</th>
                    <td>
                      <pre>{comparisonText(change.before)}</pre>
                    </td>
                    <td>
                      <pre>{comparisonText(change.after)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {review.changedBase && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={accept}
                disabled={busy}
                onChange={event => setAccept(event.target.checked)}
              />
              I reviewed the newer saved draft and want to apply this browser copy.
            </label>
          )}
          <p className="hint">
            The saved version remains in page history. The live page changes only through publication.
          </p>
        </>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button ref={cancel} type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {!discard && (
          <button type="button" className="danger" disabled={busy} onClick={() => setDiscard(true)}>
            Discard this copy…
          </button>
        )}
        <button
          type="button"
          className={discard ? 'danger' : undefined}
          disabled={busy || (!discard && (!applyReady || (review.changedBase && !accept)))}
          onClick={() => (discard ? onDiscard() : onApply(accept))}
        >
          {busy ? 'Checking…' : discard ? 'Discard browser copy' : 'Apply browser copy'}
        </button>
      </div>
    </dialog>
  )
}
