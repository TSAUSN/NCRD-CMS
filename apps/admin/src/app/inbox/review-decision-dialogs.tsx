import { Dialog, Button } from '../../components/ui/index.ts'
import { ConfirmDialog, ReasonDialog } from '../../components/confirm.tsx'

import type { ReviewModel } from './use-review-model.ts'

export function ReviewDecisionDialogs({ model }: { model: ReviewModel }) {
  const {
    selected,
    result,
    confirmApprove,
    setConfirmApprove,
    rejectOpen,
    setRejectOpen,
    rejectReason,
    setRejectReason,
    sampleOpen,
    setSampleOpen,
    setSamplesConfirmed,
    overrideOpen,
    setOverrideOpen,
    overrideReason,
    setOverrideReason,
    approve,
    reject,
  } = model
  return (
    <>
      {confirmApprove && selected && (
        <ConfirmDialog
          tone="publish"
          title="Approve and publish this version?"
          what={<>The submitted version of “{selected.pageTitle}” will become the live page now.</>}
          reassurance="Only the saved changes you reviewed are published. Newer drafts stay private."
          confirmLabel="Approve and publish"
          onCancel={() => setConfirmApprove(false)}
          onConfirm={() => {
            setConfirmApprove(false)
            approve()
          }}
        />
      )}
      {rejectOpen && (
        <ReasonDialog
          title="Return this page for changes?"
          explanation="The page stays exactly as it is on the live site. The author will see this feedback when they reopen the draft."
          label="What should change?"
          value={rejectReason}
          confirmLabel="Return with feedback"
          onChange={setRejectReason}
          onCancel={() => {
            setRejectOpen(false)
            setRejectReason('')
          }}
          onConfirm={() => {
            const reason = rejectReason.trim()
            if (!reason) return
            setRejectOpen(false)
            setRejectReason('')
            reject(reason)
          }}
        />
      )}
      {sampleOpen && (
        <Dialog title="Publish with sample content?" onClose={() => setSampleOpen(false)}>
          <p>This submitted version still contains examples. Visitors will see them if you approve it.</p>
          {result && !result.ok && result.kind === 'blocked' && (
            <ul>
              {result.report.blocking
                .filter(finding => finding.rule === 'sample_content')
                .map((finding, index) => (
                  <li key={index}>{finding.message}</li>
                ))}
            </ul>
          )}
          <div className="actions">
            <Button variant="secondary" onClick={() => setSampleOpen(false)}>
              Keep in review
            </Button>
            <Button
              variant="publish"
              onClick={() => {
                setSampleOpen(false)
                setSamplesConfirmed(true)
                approve(undefined, true)
              }}
            >
              Publish with sample content
            </Button>
          </div>
        </Dialog>
      )}
      {overrideOpen && (
        <ReasonDialog
          title="Approve despite the readiness warning?"
          explanation="This exception and the blocking findings are recorded with the publication. Return the page instead if the author should fix them."
          label="Why is publishing now the right decision?"
          value={overrideReason}
          confirmLabel="Approve with recorded reason"
          onChange={setOverrideReason}
          onCancel={() => {
            setOverrideOpen(false)
            setOverrideReason('')
          }}
          onConfirm={() => {
            const reason = overrideReason.trim()
            if (!reason) return
            setOverrideOpen(false)
            setOverrideReason('')
            approve(reason)
          }}
        />
      )}
    </>
  )
}
