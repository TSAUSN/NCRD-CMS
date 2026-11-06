'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import {
  subscribeDraftLeave,
  subscribeNavigationState,
  navigationStateVersion,
  type DraftLeaveRequest,
} from './navigation-guard.ts'
import { Dialog } from './ui/dialog.tsx'
import { Button } from './ui/button.tsx'
export function DraftLeavePrompt() {
  useSyncExternalStore(subscribeNavigationState, navigationStateVersion, () => 0)
  const [request, setRequest] = useState<DraftLeaveRequest | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [action, setAction] = useState<'save' | 'discard' | null>(null),
    lock = useRef(false),
    epoch = useRef(0),
    path = usePathname()
  useEffect(
    () =>
      subscribeDraftLeave(next => {
        setError('')
        setRequest(current => current ?? next)
      }),
    [],
  )
  useEffect(() => {
    epoch.current++
    setRequest(null)
    setError('')
  }, [path])
  const leave = async (save: boolean) => {
    if (!request || lock.current) return
    const generation = epoch.current
    lock.current = true
    setPending(true)
    setAction(save ? 'save' : 'discard')
    setError('')
    try {
      const drafts = request.readDrafts()
      if (!drafts) {
        setError('Wait for the current action to finish. Keep editing to check any open fields.')
        return
      }
      for (const draft of drafts) {
        if (save) {
          const result = await draft.saveDraft()
          if (!result.ok) {
            setError(result.message || 'The draft could not be saved. Keep editing to check its fields and try again.')
            return
          }
        } else {
          const result = await draft.discard?.()
          if (result && !result.ok) {
            setError(result.message || 'The changes could not be discarded. Keep editing and check the saved draft.')
            return
          }
        }
      }
      if (generation !== epoch.current) return
      setRequest(null)
      request.proceed()
    } catch {
      setError(
        'The result could not be confirmed. Your work is still here. Keep editing and check the saved draft before leaving.',
      )
    } finally {
      lock.current = false
      setPending(false)
      setAction(null)
    }
  }
  if (!request) return null
  const read = request.readDrafts(),
    current = read ?? request.drafts,
    drafts = current.length ? current : request.drafts,
    saved = read?.length === 0 || current.every(draft => draft.saved === true),
    library = drafts.some(draft => draft.saveMode === 'library'),
    discardLabel = drafts.every(draft => draft.discardLabel === drafts[0]?.discardLabel)
      ? (drafts[0]?.discardLabel ?? 'Discard changes')
      : 'Discard changes'
  return (
    <Dialog
      title="Before you leave"
      role="alertdialog"
      pending={pending}
      onClose={() => {
        if (!lock.current) setRequest(null)
      }}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={() => setRequest(null)}>
            Keep editing
          </Button>
          <Button
            variant="secondary"
            loading={pending && action === 'discard'}
            disabled={pending || read === null}
            onClick={() => void leave(false)}
          >
            {discardLabel}
          </Button>
          <Button
            loading={pending && action === 'save'}
            disabled={pending || read === null}
            onClick={() => void leave(true)}
          >
            {library ? 'Save and leave' : saved ? 'Keep draft and leave' : 'Save draft and leave'}
          </Button>
        </>
      }
    >
      {library ? (
        <p>
          You have unsaved changes to {[...new Set(drafts.map(draft => draft.label))].join(' and ')}. Saving updates the
          Media library immediately. An upload adds a file; other saves update its details. Page and story content stays
          unchanged.
        </p>
      ) : saved ? (
        <p>
          Your edits to {[...new Set(drafts.map(draft => draft.label))].join(' and ')} are saved as a private draft. You
          can keep editing, keep the draft and leave, or discard your changes. Nothing will be published.
        </p>
      ) : (
        <p>
          You have unsaved changes to {[...new Set(request.drafts.map(draft => draft.label))].join(' and ')}. Save a
          private draft before leaving, or discard the changes. Nothing will be published.
        </p>
      )}
      {pending && (
        <p role="status">
          {action === 'save'
            ? library
              ? 'Saving your changes before leaving…'
              : 'Saving your draft before leaving…'
            : 'Discarding unsaved changes…'}
        </p>
      )}
      {!pending && read === null && <p role="status">Finishing the current save. Wait here before leaving…</p>}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  )
}
