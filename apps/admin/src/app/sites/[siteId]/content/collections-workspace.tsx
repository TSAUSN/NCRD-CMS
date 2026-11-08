'use client'

import { createPortal } from 'react-dom'
import styles from './lists.module.css'
import shared from '../../../../components/workspace.module.css'
import { Button } from '../../../../components/ui/index.ts'
import { type ActionResult } from '../../../../lib/action-result.ts'
import { IconPlus } from '../../../../components/icons.tsx'
import { useCollectionsWorkspace, type CollectionsWorkspaceProps } from './use-collections-workspace.ts'
import { CollectionOverview, CollectionRail } from './collection-overview.tsx'
import { SelectedCollection } from './selected-collection.tsx'
import { CollectionWorkspaceDialogs } from './collection-workspace-dialogs.tsx'

function noticeClass(notice: ActionResult): string {
  return notice.ok ? 'notice notice-ok' : 'notice notice-error'
}

export function CollectionsWorkspace(props: CollectionsWorkspaceProps) {
  const model = useCollectionsWorkspace(props)
  const { headerTarget, rights, pending, openCreateDialog, router } = model
  const { notice, selected } = model.draft
  return (
    <div className={styles.workspace}>
      {headerTarget &&
        rights.manageSchema &&
        createPortal(
          <Button variant="secondary" disabled={pending} onClick={openCreateDialog}>
            <IconPlus size={16} />
            New list
          </Button>,
          headerTarget,
        )}
      <CollectionWorkspaceDialogs model={model} />
      {notice && (
        <p className={noticeClass(notice)} role={notice.ok ? 'status' : 'alert'}>
          {notice.message}
          {!notice.ok && notice.kind === 'conflict' && (
            <Button variant="secondary" size="s" onClick={() => router.refresh()}>
              Reload
            </Button>
          )}
        </p>
      )}
      {!rights.editEntries && <p>You can look through this list. A contributor or editor can update it.</p>}
      {!selected || !model.draft.model ? (
        <CollectionOverview model={model} />
      ) : (
        <div className={shared.workspaceSplit + ' ' + styles.split}>
          <CollectionRail model={model} />
          <SelectedCollection model={model} />
        </div>
      )}
    </div>
  )
}
