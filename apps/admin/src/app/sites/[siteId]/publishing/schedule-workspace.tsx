'use client'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { cancelSchedule } from './schedule-actions.ts'
import { useScheduleWorkspace, type ScheduleWorkspaceProps } from './use-schedule-workspace.ts'
import { SinglePageScheduleForm } from './single-page-schedule-form.tsx'
import { ScheduleQueue } from './schedule-queue.tsx'
import { RetryScheduleDialog } from './retry-schedule-dialog.tsx'
export function ScheduleWorkspace(props: ScheduleWorkspaceProps) {
  const model = useScheduleWorkspace(props)
  const { result, cancelId, setCancelId, pending, run } = model
  const { retry } = model.retry
  const { available } = props
  return (
    <section
      className={shared.workspaceContent + ' ' + workspaceFormsStyles.compactForm + ' ' + shared.denseStack}
      aria-labelledby="schedules-title"
    >
      <h2 id="schedules-title">Scheduled publishing</h2>
      {!available && (
        <p className="notice">
          Scheduling is switched off on this installation, so pages publish only when somebody presses Publish. An
          administrator can switch it on once background tasks are monitored.
        </p>
      )}

      <SinglePageScheduleForm model={model} {...props} />
      {result && !cancelId && !retry && (
        <p className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
          {result.message}
        </p>
      )}

      <ScheduleQueue model={model} {...props} />
      <RetryScheduleDialog model={model} />
      {cancelId && (
        <ConfirmDialog
          title="Cancel this scheduled action?"
          what="This intention will not run if it has not already completed."
          reassurance="The page and its current live version stay unchanged."
          confirmLabel="Cancel schedule"
          pending={pending}
          error={result && !result.ok ? result.message : undefined}
          onCancel={() => setCancelId(null)}
          onConfirm={() => run(() => cancelSchedule(cancelId))}
        />
      )}
    </section>
  )
}
