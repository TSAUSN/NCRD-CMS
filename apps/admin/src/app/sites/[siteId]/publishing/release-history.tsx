import { releaseLabel } from '../../../../lib/release-copy.ts'
import { Button, EmptyState, Badge } from '../../../../components/ui/index.ts'
import { requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import type { ReleaseWorkspaceModel } from './use-release-workspace.ts'

export function ReleaseHistory({ model }: { model: ReleaseWorkspaceModel }) {
  const { releases, view, setResult, setOverride, pending, leaveIntent, setCurrent } = model
  return (
    <>
      {view === 'history' && (
        <>
          <h2>History</h2>
          {releases.length ? (
            <ul className={siteSummaryStyles.rowList + ' ' + reviewWorkbenchStyles.panel}>
              {releases.map(release => (
                <li key={release.id}>
                  <div className={recordTableStyles.rowCopy}>
                    <div className={recordTableStyles.summaryAction}>
                      <Badge
                        tone={
                          release.status === 'applied' ? 'live' : release.status === 'cancelled' ? 'neutral' : 'pending'
                        }
                      >
                        {release.status === 'applied'
                          ? 'Went live'
                          : release.status === 'cancelled'
                            ? 'Cancelled review'
                            : release.stale
                              ? 'Review out of date'
                              : 'Reviewed draft'}
                      </Badge>
                      <p className={recordTableStyles.singleLine} title={release.snapshot.map(releaseLabel).join(', ')}>
                        {release.snapshot.map(releaseLabel).join(', ')}
                      </p>
                    </div>
                    <small>
                      {new Date(release.finished_at ?? release.created_at).toLocaleString()} ·{' '}
                      {release.actorLabel ?? 'Another editor'}
                    </small>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      const change = () => {
                        setCurrent(release)
                        setResult(null)
                        setOverride('')
                      }
                      if (requestLocalDraftNavigation(leaveIntent, change)) change()
                    }}
                  >
                    View details
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No publishing history yet">A record is kept every time changes go live.</EmptyState>
          )}
        </>
      )}
    </>
  )
}
