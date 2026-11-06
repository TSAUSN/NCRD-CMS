'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '../../../../components/ui/index.ts'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { IconAlert } from '../../../../components/icons.tsx'
import { restorePageVersionAsDraft } from '../../../actions/page-draft.ts'
import { type ActionResult } from '../../../../lib/action-result.ts'

export function RestoreButton({
  pageId,
  sourceVersionId,
  revision,
  tone,
}: {
  tone?: 'primary'
  pageId: string
  sourceVersionId: string
  revision: string
}) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<ActionResult | null>(null)
  const [pending, startTransition] = useTransition()
  const restoring = useRef(false)

  function restore() {
    // Close the same-render repeat-click gap before React paints pending.
    if (restoring.current) return
    restoring.current = true
    const form = new FormData()
    form.set('pageId', pageId)
    form.set('sourceVersionId', sourceVersionId)
    form.set('revision', String(revision))
    startTransition(async () => {
      try {
        const next = await restorePageVersionAsDraft(form)
        setOpen(false)
        setResult(next)
        if (next.ok) window.location.assign(`/pages/${pageId}`)
      } catch {
        setOpen(false)
        setResult({
          ok: false,
          kind: 'error',
          message:
            'The restore result could not be confirmed. Reload the page to check the current draft before trying again.',
        })
      } finally {
        restoring.current = false
      }
    })
  }

  return (
    <>
      <Button disabled={pending} onClick={() => setOpen(true)}>
        {pending ? 'Creating draft…' : 'Restore as new draft'}
      </Button>
      {result && !result.ok && (
        <p className="notice notice-error" role="alert">
          <IconAlert size={16} /> <span className="notice-body">{result.message}</span>
        </p>
      )}
      {open && (
        <ConfirmDialog
          tone={tone}
          title="Create a new draft from this version?"
          what="This version’s content and page details will become a new draft."
          reassurance="The live page will not change. Your current draft stays in history and can be restored again."
          confirmLabel="Create draft"
          pending={pending}
          onCancel={() => {
            if (!restoring.current) setOpen(false)
          }}
          onConfirm={restore}
        />
      )}
    </>
  )
}
