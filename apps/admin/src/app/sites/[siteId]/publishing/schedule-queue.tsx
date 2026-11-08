import { TextLink as Link, Button, Badge } from '../../../../components/ui/index.ts'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import type { ScheduleWorkspaceModel, ScheduleWorkspaceProps } from './use-schedule-workspace.ts'
function localScheduleTime(value: string, zone: string): string {
  if (zone === 'your device time zone') return new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
  return `${new Intl.DateTimeFormat(undefined, { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value))} · ${zone}`
}
export function ScheduleQueue({
  model,
  pages,
  schedules,
  available,
  canManage,
  archived,
  siteId,
}: {
  model: ScheduleWorkspaceModel
} & Pick<ScheduleWorkspaceProps, 'pages' | 'schedules' | 'available' | 'canManage' | 'archived' | 'siteId'>) {
  const { pending, setResult, setCancelId } = model
  const { zone } = model.single
  const { openRetry } = model.retry
  return (
    <>
      {schedules.length === 0 ? (
        <p className="muted">No scheduled actions for this site yet.</p>
      ) : (
        <ul className={siteSummaryStyles.rowList + ' ' + reviewWorkbenchStyles.panel}>
          {schedules.map(job => (
            <li key={job.id} id={`schedule-${job.id}`} aria-label={`Scheduled action ${job.title}`}>
              <div>
                <strong className={recordTableStyles.singleLine} title={job.title}>
                  {job.title}
                </strong>
                <p>
                  {job.action === 'publish' ? 'Publish saved changes' : 'Unpublish saved page'} ·{' '}
                  <time dateTime={job.run_at} title={new Date(job.run_at).toISOString()}>
                    {localScheduleTime(job.run_at, zone)}
                  </time>
                </p>
                <p>
                  <span className={selectionControlsStyles.visuallyHidden}>Status: </span>
                  <Badge tone={job.status === 'failed' ? 'error' : job.status === 'succeeded' ? 'live' : 'neutral'}>
                    {job.status}
                  </Badge>
                  {job.attempt_count
                    ? ` · ${job.attempt_count} ${job.attempt_count === 1 ? 'attempt' : 'attempts'}`
                    : ''}
                </p>
                {job.last_error && <p className="notice notice-error">{job.last_error}</p>}
                {job.retry_of_id && (
                  <p>
                    Retry of <Link href={`#schedule-${job.retry_of_id}`}>an earlier failed attempt</Link>.
                  </p>
                )}
                {job.retried_as_id && (
                  <p>
                    A retry was created:{' '}
                    <Link href={`#schedule-${job.retried_as_id}`}>{job.retried_as_status} attempt</Link>.
                  </p>
                )}
                {job.override_reason && <p>Recorded exception: {job.override_reason}</p>}
              </div>
              {job.item_type === 'release' && (
                <Link
                  href={`${siteId ? '/sites/' + siteId + '/publishing' : ''}?tab=${job.status === 'failed' ? 'changes' : 'history'}${job.status === 'failed' ? '' : '&release=' + job.item_id}`}
                >
                  {job.status === 'failed' ? 'Review changes again' : 'View selected changes'}
                </Link>
              )}
              {canManage && job.item_type !== 'release' && job.status === 'failed' && !job.retried_as_id && (
                <Button
                  size="s"
                  variant="secondary"
                  disabled={pending || !available || archived || !pages.some(page => page.id === job.item_id)}
                  onClick={() => openRetry(job)}
                >
                  Retry failed schedule
                </Button>
              )}
              {canManage && ['pending', 'running'].includes(job.status) && (
                <Button
                  size="s"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setResult(null)
                    setCancelId(job.id)
                  }}
                >
                  Cancel schedule
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
