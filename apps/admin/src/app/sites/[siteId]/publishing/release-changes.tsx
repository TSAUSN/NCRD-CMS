import { releaseGroup, releaseLabel } from '../../../../lib/release-copy.ts'
import { Button, EmptyState, Card, TextLink as Link } from '../../../../components/ui/index.ts'
import { requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import styles from './publish.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import ownedStyles from './release-workspace-styles.module.css'
import type { ReleaseStamp } from '../../../../lib/release-stamps.ts'
import type { ReleaseWorkspaceModel } from './use-release-workspace.ts'

export function ReleaseChanges({ model }: { model: ReleaseWorkspaceModel }) {
  const {
    siteId,
    items,
    canPublish,
    canAdminister,
    archived,
    initialRelease,
    presentations,
    view,
    schedulingAvailable,
    native,
    stamps,
    current,
    setCompare,
    pending,
    leaveIntent,
    checkedItems,
    resetReview,
    setSelected,
    chooseItem,
  } = model
  return (
    <>
      {view === 'changes' && !(current?.status === 'planned' && current.snapshot.some(item => item.entryIds)) && (
        <>
          <div className={styles.heading}>
            <div>
              <h2 className={native && !initialRelease ? selectionControlsStyles.visuallyHidden : undefined}>
                {initialRelease ? 'Publish your site for the first time' : 'Changes ready to publish'}
              </h2>
              <p className={styles.muted}>
                {canPublish ? 'Choose what goes live together.' : 'See saved work and publishing history.'}
              </p>
            </div>
            {items.length > 0 && canPublish && (
              <Button
                variant="tertiary"
                disabled={pending}
                onClick={() => {
                  const change = () => {
                    resetReview()
                    setSelected(items.filter(item => !item.requiresAdmin || canAdminister).map(item => item.key))
                  }
                  if (requestLocalDraftNavigation(leaveIntent, change)) change()
                }}
              >
                Select everything
              </Button>
            )}
          </div>
          {!canPublish && (
            <p className="notice">
              An editor can put these changes live. Submit your changes from the page or list you edited.{' '}
              <Link href={`/sites/${siteId}`}>Open pages</Link>
            </p>
          )}
          {initialRelease && (
            <p className="notice">
              Your site is private. Include its pages, Site look, header, footer and menu in its first publication.
            </p>
          )}
          {native && items.length > 0 ? (
            <div className={recordTableStyles.tableWrap}>
              <table data-density="content" className={recordTableStyles.table + ' ' + ownedStyles.publishTable}>
                <caption className={selectionControlsStyles.visuallyHidden}>Saved changes ready to publish</caption>
                <thead>
                  <tr>
                    <th>
                      <span className={selectionControlsStyles.visuallyHidden}>Select</span>
                    </th>
                    <th>What</th>
                    <th>What changed</th>
                    <th>Who</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.key}>
                      <td>
                        {canPublish && (!item.requiresAdmin || canAdminister) && (
                          <label className={selectionControlsStyles.checkRow}>
                            <input
                              type="checkbox"
                              aria-label={releaseLabel(item)}
                              checked={checkedItems.has(item.key)}
                              disabled={pending || archived}
                              onChange={event => chooseItem(item.key, event.target.checked)}
                            />
                          </label>
                        )}
                      </td>
                      <th scope="row">
                        <strong className={recordTableStyles.singleLine} title={releaseLabel(item)}>
                          {releaseLabel(item)}
                        </strong>
                        <small className={recordTableStyles.meta}>
                          {releaseGroup(item) === 'Pages' ? 'Page' : releaseGroup(item)}
                          {item.requiresAdmin && !canAdminister ? ' · needs an Admin' : ''}
                        </small>
                      </th>
                      <td>
                        <div className={recordTableStyles.summaryAction}>
                          <p
                            className={recordTableStyles.singleLine}
                            title={
                              presentations[item.key]?.summary ??
                              (item.unpublished ? 'New page · not live yet' : 'Saved changes')
                            }
                          >
                            {presentations[item.key]?.summary ??
                              (item.unpublished ? 'New page · not live yet' : 'Saved changes')}
                          </p>
                          <Button variant="tertiary" size="s" disabled={pending} onClick={() => setCompare(item)}>
                            View changes
                          </Button>
                        </div>
                      </td>
                      <td>
                        <span
                          className={recordTableStyles.singleLine}
                          title={stamps[item.key]?.actor ?? 'Not recorded'}
                        >
                          {stamps[item.key]?.actor ?? 'Not recorded'}
                        </span>
                      </td>
                      <td>
                        <ReleaseChangeTime stamp={stamps[item.key]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !items.length ? (
            <EmptyState title={native && archived ? 'No changes can be published' : 'Everything saved is live'}>
              {native && archived
                ? 'This site is archived. Open History to view earlier releases.'
                : 'Your next saved changes will appear here.'}
            </EmptyState>
          ) : (
            ['Pages', 'Lists', 'Data values', 'Site look'].map(group => {
              const grouped = items.filter(item => releaseGroup(item) === group)
              return (
                grouped.length > 0 && (
                  <Card title={group} density="compact" key={group}>
                    <ul className={siteSummaryStyles.rowList}>
                      {grouped.map(item => (
                        <li key={item.key}>
                          <label className={selectionControlsStyles.checkRow}>
                            {canPublish && (
                              <input
                                type="checkbox"
                                checked={checkedItems.has(item.key)}
                                disabled={
                                  pending || !canPublish || archived || (!!item.requiresAdmin && !canAdminister)
                                }
                                onChange={event => chooseItem(item.key, event.target.checked)}
                              />
                            )}
                            <span>
                              <strong>{releaseLabel(item)}</strong>
                              <small>
                                {presentations[item.key]?.summary ??
                                  (item.unpublished ? 'New page · not live yet' : 'Saved changes')}
                                {item.requiresAdmin && !canAdminister ? ' · needs a site admin' : ''}
                              </small>
                            </span>
                          </label>
                          <Button
                            variant="secondary"
                            size="s"
                            disabled={pending}
                            onClick={() => {
                              setCompare(item)
                            }}
                          >
                            View changes
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )
              )
            })
          )}
          {!native && canPublish && !archived && items.length > 0 && !current && (
            <div className={styles.bar}>
              <ReleasePublishActions model={model} />
              <span className={styles.muted}>Review the checks before confirming.</span>
            </div>
          )}
          {native && items.length > 0 && (
            <p className={ownedStyles.publishNote}>
              Selected items go live together. Pages that show a changed list update after it is published.{' '}
              <Link href={'/sites/' + siteId + '/publishing?tab=scheduled'}>View scheduled publishing</Link>
            </p>
          )}
          {!schedulingAvailable && canPublish && (
            <p className={styles.muted}>
              Scheduling is off. Ask an administrator to turn on automatic publishing and check that it is running.
            </p>
          )}
        </>
      )}
    </>
  )
}

export function ReleasePublishActions({ model }: { model: ReleaseWorkspaceModel }) {
  const { schedulingAvailable, pending, picked, prepare } = model
  return (
    <>
      <Button variant="publish" disabled={pending || !picked.length} loading={pending} onClick={() => prepare(false)}>
        Publish selected ({picked.length})
      </Button>
      <Button
        variant="secondary"
        disabled={pending || !picked.length || !schedulingAvailable}
        onClick={() => prepare(true)}
      >
        Publish later…
      </Button>
    </>
  )
}

const releaseDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'America/New_York',
})
const releaseHour = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
})

function ReleaseChangeTime({ stamp }: { stamp: ReleaseStamp | undefined }) {
  if (!stamp) return 'Not recorded'
  const date = new Date(stamp.when)
  return (
    <time dateTime={stamp.when} title={date.toLocaleString()}>
      {releaseDay.format(date)}
      <small>{releaseHour.format(date)}</small>
    </time>
  )
}
