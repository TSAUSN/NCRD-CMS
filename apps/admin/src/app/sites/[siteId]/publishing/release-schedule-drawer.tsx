import { Button, Drawer, Field, ActionNote } from '../../../../components/ui/index.ts'
import { scheduleRelease } from './release-actions.ts'
import styles from './publish.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import type { ReactNode } from 'react'
import type { ReleaseWorkspaceModel } from './use-release-workspace.ts'

export function ReleaseScheduleDrawer({ model, children }: { model: ReleaseWorkspaceModel; children: ReactNode }) {
  const { current, result, override, samplesConfirmed, scheduleOpen, pending, scheduleError, ready, run } = model
  const {
    time,
    setTime,
    zone,
    scheduleRequestId,
    intentSaved,
    intentError,
    closeSchedule,
    clearIntent,
    finishIntent,
    scheduleTime,
    scheduleHint,
    preset,
  } = model.schedule
  return (
    <>
      {scheduleOpen && current && (
        <Drawer
          density="compact"
          title="Publish later"
          pending={pending}
          onClose={closeSchedule}
          footer={
            <>
              <ActionNote>
                Save draft and leave keeps the time and reason only in this browser. It does not schedule anything.
              </ActionNote>
              <Button variant="secondary" disabled={pending} onClick={closeSchedule}>
                Cancel
              </Button>
              <Button
                disabled={pending || !ready || !time || !scheduleTime}
                loading={pending}
                onClick={() => {
                  if (!time || !scheduleTime) return
                  scheduleRequestId.current ??= crypto.randomUUID()
                  run(
                    () =>
                      scheduleRelease(
                        current.id,
                        scheduleTime!.runAt,
                        override,
                        samplesConfirmed,
                        scheduleRequestId.current!,
                      ),
                    true,
                    finishIntent,
                  )
                }}
              >
                Schedule selected changes
              </Button>
            </>
          }
        >
          <div className={listInspectorStyles.formStack}>
            {intentSaved && (
              <p role="status">
                Choices restored or saved in this browser. Review this exact set of changes and confirm any required
                approvals again before scheduling.
              </p>
            )}
            {intentSaved && (
              <Button variant="secondary" disabled={pending} onClick={clearIntent}>
                Clear saved choices
              </Button>
            )}
            {intentError && <p role="alert">{intentError}</p>}
            <p>
              {current.snapshot.length} selected {current.snapshot.length === 1 ? 'change will' : 'changes will'} go
              live together.{' '}
              {current.scope_before_hash
                ? 'Changes to this story, its article or required site settings stop this schedule for another review. You can keep working on other stories.'
                : 'New edits after this review stop the schedule so they can be checked again.'}
            </p>
            <div className={styles.presets}>
              <Button variant="secondary" disabled={pending} onClick={() => preset(false)}>
                Tomorrow 9:00 AM
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => preset(true)}>
                Monday 9:00 AM
              </Button>
            </div>
            {result && !result.ok && (
              <p ref={scheduleError} tabIndex={-1} role="alert" className="notice notice-error">
                {result.message}
              </p>
            )}
            <Field
              density="compact"
              id="release-schedule-time"
              label={`Date and time (${zone})`}
              help={['Choose at least one minute from now.', scheduleHint].filter(Boolean).join(' ')}
            >
              <input
                id="release-schedule-time"
                type="datetime-local"
                value={time}
                disabled={pending}
                onChange={event => {
                  setTime(event.target.value)
                  scheduleRequestId.current = null
                }}
              />
            </Field>
            {children}
          </div>
        </Drawer>
      )}
    </>
  )
}
