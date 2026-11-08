import { ReleaseReadinessSummary } from '../../../../components/release-readiness-summary.tsx'
import { releaseLabel } from '../../../../lib/release-copy.ts'
import { Button, Field, Disclosure } from '../../../../components/ui/index.ts'
import { ReleaseRecoveryReview } from './release-recovery-review.tsx'
import styles from './publish.module.css'
import shared from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import type { ReleaseWorkspaceModel } from './use-release-workspace.ts'

function SelectedReleaseChanges({ model }: { model: ReleaseWorkspaceModel }) {
  const { current, descriptions, setCompare, pending } = model
  return (
    <>
      {current && (
        <ul className={siteSummaryStyles.rowList + ' ' + reviewWorkbenchStyles.panel}>
          {current.snapshot.map(item => (
            <li key={item.key}>
              <div className={recordTableStyles.rowCopy}>
                <strong className={recordTableStyles.singleLine} title={releaseLabel(item)}>
                  {releaseLabel(item)}
                  {item.action === 'unpublish' ? ' · will leave the live site' : ''}
                </strong>
                {descriptions.releaseId === current.id && descriptions.values[item.key] && (
                  <p
                    className={recordTableStyles.singleLine + ' ' + recordTableStyles.meta}
                    title={descriptions.values[item.key]!.summary}
                  >
                    {descriptions.values[item.key]!.summary}
                  </p>
                )}
              </div>
              {current.status === 'planned' && (
                <Button
                  variant="secondary"
                  size="s"
                  disabled={pending || !!current.stale}
                  onClick={() => setCompare(item)}
                >
                  View changes
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function ReleaseReview({ model }: { model: ReleaseWorkspaceModel }) {
  const {
    canPublish,
    canAdminister,
    archived,
    schedulingAvailable,
    current,
    setResult,
    override,
    setOverride,
    samplesConfirmed,
    setSamplesConfirmed,
    setConfirm,
    scheduleOpen,
    setScheduleOpen,
    pending,
    reviewHeading,
    setRecoveryPending,
    hasSamples,
    blocked,
    canExecute,
    ready,
    setCurrent,
  } = model
  const { scheduleRequestId } = model.schedule
  return (
    <>
      {current && (
        <div className={shared.workspaceContent} aria-label="Selected changes review">
          <div className={styles.heading}>
            <h2 ref={reviewHeading} tabIndex={-1}>
              Check selected changes
            </h2>
            <span>
              {current.snapshot.length} selected {current.snapshot.length === 1 ? 'change' : 'changes'}
            </span>
          </div>
          {current.snapshot.length > 3 ? (
            <Disclosure title={`Selected changes (${current.snapshot.length})`}>
              {<SelectedReleaseChanges model={model} />}
            </Disclosure>
          ) : (
            <SelectedReleaseChanges model={model} />
          )}

          <ReleaseReadinessSummary
            checks={current.preview_report}
            releaseId={current.id}
            planned={current.status === 'planned'}
            canPreview={canExecute && !archived}
            applied={current.status === 'applied'}
          />
          {current.stale && (
            <p className="notice notice-warn">
              The site changed after this review. Return to Changes ready to publish and prepare a fresh review.
            </p>
          )}
          {current.status === 'planned' && (
            <>
              {hasSamples && (
                <label className={selectionControlsStyles.checkRow}>
                  <input
                    type="checkbox"
                    checked={samplesConfirmed}
                    disabled={pending}
                    onChange={event => setSamplesConfirmed(event.target.checked)}
                  />
                  <span>
                    Publish with sample content<small>I have reviewed the examples listed above.</small>
                  </span>
                </label>
              )}
              {blocked && canPublish && (
                <Field
                  id="release-override"
                  density="compact"
                  label="Reason for publishing despite these findings"
                  help="Your reason and the reviewed findings are kept in activity. Approval and ownership rules still apply."
                >
                  <textarea
                    id="release-override"
                    disabled={pending}
                    value={override}
                    onChange={event => {
                      setOverride(event.target.value)
                      scheduleRequestId.current = null
                    }}
                    maxLength={2000}
                  />
                </Field>
              )}
              {canPublish && !canExecute && (
                <p role="status">A site administrator must publish these shared design or list field changes.</p>
              )}
              {canPublish && !scheduleOpen && (
                <div className={styles.actions}>
                  <Button
                    variant="publish"
                    disabled={pending || !ready}
                    onClick={() => {
                      setResult(null)
                      setConfirm('publish')
                    }}
                  >
                    Publish selected ({current.snapshot.length})
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={pending || !ready || !schedulingAvailable}
                    onClick={() => setScheduleOpen(true)}
                  >
                    Publish later…
                  </Button>
                  <Button
                    variant="tertiary"
                    disabled={pending}
                    onClick={() => {
                      setResult(null)
                      setConfirm('cancel')
                    }}
                  >
                    Cancel review
                  </Button>
                </div>
              )}
            </>
          )}
          {current.status === 'applied' && canPublish && !archived && (
            <ReleaseRecoveryReview
              key={current.id}
              releaseId={current.id}
              canAdminister={canAdminister}
              onBusyChange={setRecoveryPending}
              onPlanned={release => {
                setCurrent(release)
                setResult({
                  ok: true,
                  message: 'Earlier content prepared as a draft. Review its effects before publishing.',
                })
                setOverride('')
              }}
            />
          )}
        </div>
      )}
    </>
  )
}
