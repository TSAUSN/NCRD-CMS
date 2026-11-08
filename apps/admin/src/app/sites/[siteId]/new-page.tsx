'use client'

import styles from './new-page.module.css'
import ownedStyles from './new-page-styles.module.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '../../../components/ui/index.ts'
import { IconClose, IconPage, IconPlus } from '../../../components/icons.tsx'
import type { LibraryEntry } from '../../../lib/queries.ts'
import { createPage } from '../../actions/page-lifecycle.ts'
import { NewPageDetails } from './new-page-details.tsx'
import { NewPageStartingPoint } from './new-page-starting-point.tsx'
import { NewPageOutline } from './new-page-sections.tsx'
import { useCopyPage, usePageDetails, usePageStartingPoint, type PageSource } from './new-page-draft.ts'

function CreateButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={disabled || pending}>
      <IconPage size={16} /> {pending ? 'Creating the page…' : 'Create this page'}
    </button>
  )
}

export function NewPageForm({
  siteId,
  siteName,
  siteAddress,
  library,
  prompt,
  primary = false,
  pages = [],
  designs = [],
}: {
  siteId: string
  siteName: string
  siteAddress: string
  library: LibraryEntry[]
  pages?: PageSource[]
  designs?: PageSource[]
  primary?: boolean
  prompt?: boolean
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  const details = usePageDetails()
  const start = usePageStartingPoint(library, designs)
  const { copy, copyPending, copyError } = useCopyPage(pages, details)
  const { mode, copyMode, copyId, designId, pageTemplate, selectedIds } = start
  const { title, slugProblem } = details
  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }, [])
  useEffect(() => {
    if (open) titleInput.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])
  return (
    <>
      <Button
        ref={trigger}
        variant={prompt || primary ? 'primary' : 'secondary'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <IconPlus size={15} /> Add a page
      </Button>

      {open && (
        <div
          className="page-creator-overlay"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div
            ref={dialog}
            className={`page-creator ${styles.creator} ${ownedStyles.planner}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="page-creator-title"
          >
            <header className={'page-creator-head ' + ownedStyles.plannerHead}>
              <div>
                <p className="eyebrow">{siteName}</p>
                <h2 id="page-creator-title">Create a page</h2>
                <p>It starts as a private draft. Nobody sees it until you publish.</p>
              </div>
              <button
                type="button"
                className="icon-btn tip tip-right"
                data-tip="Close (Esc)"
                aria-label="Close page creator"
                onClick={close}
              >
                <IconClose size={19} />
              </button>
            </header>

            <form
              action={createPage}
              onSubmit={event => {
                if (copyMode || (designId && mode !== 'blank' && mode !== 'custom')) {
                  event.preventDefault()
                  void copy(copyMode ? copyId : designId)
                }
              }}
            >
              <input type="hidden" name="siteId" value={siteId} />
              {mode !== 'custom' && (
                <input type="hidden" name="pageTemplate" value={mode === 'blank' ? 'blank' : pageTemplate} />
              )}
              {mode === 'custom' && pageTemplate === 'chapter' && (
                <input type="hidden" name="sourceTemplate" value="chapter" />
              )}
              {selectedIds.map(id => (
                <input key={id} type="hidden" name="sectionDefId" value={id} />
              ))}

              <div className={'page-creator-body ' + ownedStyles.plannerBody}>
                <div className={'page-creator-main ' + ownedStyles.plannerMain}>
                  <NewPageDetails details={details} siteAddress={siteAddress} titleInput={titleInput} />
                  <NewPageStartingPoint start={start} pages={pages} copyPending={copyPending} copyError={copyError} />
                </div>
                {!copyMode && !designId && <NewPageOutline start={start} />}
              </div>

              <footer className={'page-creator-foot ' + ownedStyles.plannerFoot}>
                <button type="button" className="ghost" onClick={close}>
                  Cancel
                </button>
                <span>You will go straight to the editor.</span>
                <CreateButton
                  disabled={title.trim() === '' || slugProblem !== null || copyPending || (copyMode && !copyId)}
                />
              </footer>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
