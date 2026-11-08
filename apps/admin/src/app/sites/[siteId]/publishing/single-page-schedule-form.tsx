import { TextLink as Link, Button, Disclosure, Field } from '../../../../components/ui/index.ts'
import { localScheduleHint } from '../../../../lib/local-schedule-time.ts'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import type { ScheduleWorkspaceModel, ScheduleWorkspaceProps } from './use-schedule-workspace.ts'
export function SinglePageScheduleForm({
  model,
  pages,
  available,
  canManage,
  archived,
}: {
  model: ScheduleWorkspaceModel
} & Pick<ScheduleWorkspaceProps, 'pages' | 'available' | 'canManage' | 'archived'>) {
  const {
    zone,
    formOpen,
    toggleForm,
    submit,
    saved,
    clearChoices,
    draftError,
    pageId,
    action,
    choosePage,
    time,
    editTime,
    scheduleTime,
    current,
    versionId,
    changed,
    override,
    editOverride,
  } = model.single
  const { pending, result } = model
  const { retry } = model.retry
  return (
    <>
      {canManage && available && !archived && (
        <Disclosure
          title="Schedule a single page"
          open={formOpen}
          summaryProps={{
            onClick: event => {
              event.preventDefault()
              toggleForm()
            },
          }}
        >
          <form
            className={listInspectorStyles.formStack}
            onSubmit={event => {
              event.preventDefault()
              submit()
            }}
          >
            <p>Save draft and leave keeps these choices only in this browser. It does not schedule anything.</p>
            {saved && (
              <p role="status">
                Schedule choices restored or saved in this browser. Review the page, version, time and any checks again.
              </p>
            )}
            {saved && (
              <Button variant="secondary" disabled={pending} onClick={clearChoices}>
                Clear saved schedule choices
              </Button>
            )}
            {draftError && <p role="alert">{draftError}</p>}
            <fieldset data-align="controls" disabled={pending} className={shared.threeColumns}>
              <Field density="compact" id="schedule-page" label="Page">
                <select id="schedule-page" value={pageId} onChange={event => choosePage(event.target.value)}>
                  {!current && pageId && (
                    <option value={pageId} disabled>
                      Saved page is unavailable — choose a current page
                    </option>
                  )}
                  {pages.map(page => (
                    <option key={page.id} value={page.id}>
                      {page.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field density="compact" id="schedule-action" label="Action">
                <select
                  id="schedule-action"
                  value={action}
                  onChange={event => choosePage(pageId, event.target.value as typeof action)}
                >
                  <option value="publish">Publish the current saved draft</option>
                  <option value="unpublish">Unpublish the current live version</option>
                </select>
              </Field>
              <Field density="compact" id="schedule-time" label={`Date and time (${zone})`}>
                <input
                  id="schedule-time"
                  type="datetime-local"
                  aria-describedby="schedule-time-hint"
                  required
                  value={time}
                  onChange={event => editTime(event.target.value)}
                />
              </Field>
            </fieldset>
            {localScheduleHint(time, scheduleTime) && (
              <p id="schedule-time-hint" className="hint">
                {localScheduleHint(time, scheduleTime)}
              </p>
            )}
            <p className="hint">
              Choose at least one minute from now.{' '}
              {action === 'unpublish'
                ? 'If another version goes live first, this schedule will not remove it.'
                : 'Later draft edits do not change the version this schedule will publish.'}
            </p>
            {versionId && (
              <p className="hint">
                <Link href={`/preview/${versionId}?readonly=1`} target="_blank" rel="noopener">
                  Preview the exact content being scheduled
                </Link>
              </p>
            )}
            {changed && (
              <p className="notice notice-warn">
                The page changed or is no longer available.{' '}
                <Button size="s" variant="secondary" disabled={pending} onClick={() => choosePage(pageId)}>
                  Reload version
                </Button>
              </p>
            )}
            {!versionId && (
              <p className="notice">
                {action === 'publish' ? 'Save a draft of this page first.' : 'This page does not have a live version.'}
              </p>
            )}
            {!retry && (result?.report || override) && (
              <div className="notice notice-warn">
                <ul>
                  {(result?.report?.blocking ?? []).map((finding, index) => (
                    <li key={index}>{finding.message}</li>
                  ))}
                </ul>
                <Field density="compact" id="schedule-override" label="Reason for the publishing exception">
                  <textarea
                    id="schedule-override"
                    disabled={pending}
                    value={override}
                    maxLength={2000}
                    onChange={event => editOverride(event.target.value)}
                  />
                  <p>
                    Only these reviewed findings may be overridden. New problems at execution time will stop the
                    schedule.
                  </p>
                </Field>
              </div>
            )}
            <div className={workspaceFormsStyles.actions}>
              <Button type="submit" disabled={pending || !versionId || !time || !scheduleTime || changed}>
                {pending ? 'Saving…' : 'Save schedule'}
              </Button>
            </div>
          </form>
        </Disclosure>
      )}
    </>
  )
}
