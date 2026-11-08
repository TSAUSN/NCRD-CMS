import { TextLink as Link, Button, Field } from '../../../../components/ui/index.ts'
import { localScheduleHint } from '../../../../lib/local-schedule-time.ts'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import type { ScheduleWorkspaceModel } from './use-schedule-workspace.ts'
export function RetryScheduleDialog({ model }: { model: ScheduleWorkspaceModel }) {
  const {
    retry,
    retrySaved,
    clearRetryChoices,
    retryDraftError,
    retryZone,
    retryTime,
    retryScheduleTime,
    editRetryTime,
    retryOverride,
    editRetryOverride,
    closeRetry,
    submitRetry,
  } = model.retry
  const { pending, result } = model
  return (
    <>
      {retry && (
        <ConfirmDialog
          title="Retry this failed schedule?"
          what={
            <>
              <p>Save draft and leave keeps retry choices only in this browser. It does not queue a new attempt.</p>
              {retrySaved && (
                <>
                  <p role="status">
                    Retry choices restored or saved in this browser. Check the exact version and review any findings
                    again.
                  </p>
                  <Button variant="secondary" disabled={pending} onClick={clearRetryChoices}>
                    Clear saved retry choices
                  </Button>
                </>
              )}
              {retryDraftError && <p role="alert">{retryDraftError}</p>}
              <p>
                {retry.job.action === 'publish' ? 'Publish' : 'Unpublish'} the same saved version of “{retry.job.title}”
                in a new attempt. Later draft edits are not included.
              </p>
              <p>
                <Link href={`/preview/${retry.job.version_id}?readonly=1`} target="_blank" rel="noopener">
                  Preview the version being retried
                </Link>
              </p>
              <Field density="compact" id="retry-schedule-time" label={`Retry date and time (${retryZone})`}>
                <input
                  id="retry-schedule-time"
                  type="datetime-local"
                  aria-describedby="retry-time-hint"
                  value={retryTime}
                  disabled={pending}
                  onChange={event => editRetryTime(event.target.value)}
                />
              </Field>
              {localScheduleHint(retryTime, retryScheduleTime) && (
                <p id="retry-time-hint" className="hint">
                  {localScheduleHint(retryTime, retryScheduleTime)}
                </p>
              )}
              <p>
                Choose at least one minute from now. Permissions, readiness and worker availability are checked again.
              </p>
              {(result?.report || retryOverride) && (
                <div>
                  <ul>
                    {(result?.report?.blocking ?? []).map((finding, index) => (
                      <li key={index}>{finding.message}</li>
                    ))}
                  </ul>
                  <Field density="compact" id="retry-schedule-override" label="Reason for the new publishing exception">
                    <textarea
                      id="retry-schedule-override"
                      value={retryOverride}
                      disabled={pending}
                      maxLength={2000}
                      onChange={event => editRetryOverride(event.target.value)}
                    />
                  </Field>
                  <p>
                    The earlier attempt's exception is not carried forward. Only these reviewed findings can be
                    approved.
                  </p>
                </div>
              )}
            </>
          }
          reassurance="Nothing changes on the live site now. The failed attempt and its error remain in history."
          confirmLabel="Schedule new attempt"
          tone="primary"
          pending={pending}
          error={result && !result.ok ? result.message : undefined}
          onCancel={closeRetry}
          onConfirm={submitRetry}
        />
      )}
    </>
  )
}
