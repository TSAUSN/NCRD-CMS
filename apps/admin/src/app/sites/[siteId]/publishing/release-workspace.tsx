'use client'

import { createPortal } from 'react-dom'
import styles from './publish.module.css'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import { ReleaseComparisonDialog } from './release-comparison-dialog.tsx'
import { useReleaseWorkspace, type ReleaseWorkspaceProps } from './use-release-workspace.ts'
import { ReleaseChanges, ReleasePublishActions } from './release-changes.tsx'
import { ReleaseHistory } from './release-history.tsx'
import { ReleaseReview } from './release-review.tsx'
import { ReleaseConfirmation } from './release-confirmation.tsx'
import { ReleaseScheduleDrawer } from './release-schedule-drawer.tsx'

export function ReleaseWorkspace(props: ReleaseWorkspaceProps) {
  const model = useReleaseWorkspace(props)
  const {
    native,
    headerTarget,
    view,
    canPublish,
    archived,
    items,
    current,
    scheduleOpen,
    result,
    confirm,
    transitionPending,
    compare,
    siteId,
    presentations,
    setCompare,
  } = model
  const publishActions = <ReleasePublishActions model={model} />
  const review = <ReleaseReview model={model} />
  return (
    <section
      data-native={native || undefined}
      className={styles.workspace + ' ' + shared.denseStack}
      aria-label={view === 'history' ? 'Publishing history' : 'Changes ready to publish'}
    >
      {native &&
        headerTarget &&
        view === 'changes' &&
        canPublish &&
        !archived &&
        items.length > 0 &&
        !current &&
        createPortal(<div className={workspaceFormsStyles.actions}>{publishActions}</div>, headerTarget)}
      <ReleaseChanges model={model} />
      <ReleaseHistory model={model} />
      {result && !confirm && !transitionPending && (
        <p className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
          {result.message}
        </p>
      )}
      {!scheduleOpen && review}
      {compare && (
        <ReleaseComparisonDialog
          key={compare.key}
          siteId={siteId}
          item={compare}
          initial={presentations[compare.key]}
          onClose={() => setCompare(null)}
        />
      )}
      <ReleaseScheduleDrawer model={model}>{review}</ReleaseScheduleDrawer>
      <ReleaseConfirmation model={model} />
    </section>
  )
}
