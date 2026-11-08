import styles from './lists.module.css'
import shared from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import ownedStyles from './collections-workspace-styles.module.css'
import { Button, StatusPill, EmptyState } from '../../../../components/ui/index.ts'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { IconCollection } from '../../../../components/icons.tsx'
import type { CollectionsWorkspaceModel } from './use-collections-workspace.ts'

export function CollectionOverview({ model: workspace }: { model: CollectionsWorkspaceModel }) {
  const { initial, rights, headerActionsId, openCreateDialog } = workspace
  return (
    <>
      <>
        <div className={styles.heading}>
          <h2>Your lists</h2>
          {rights.manageSchema && !headerActionsId && <Button onClick={openCreateDialog}>New list</Button>}
        </div>
        {initial.collections.length === 0 ? (
          <EmptyState title="Keep shared items in a list">
            Add speakers, sessions or resources once, then show them on any page.
          </EmptyState>
        ) : (
          <div className={styles.tiles}>
            {initial.collections.map(list => (
              <Link
                className={selectionControlsStyles.optionCard + ' ' + ownedStyles.workspaceTile}
                key={list.id}
                href={'?collection=' + list.id}
              >
                <IconCollection size={24} />
                <strong>{list.name}</strong>
                <span>
                  {list.totalEntries} {list.totalEntries === 1 ? 'item' : 'items'} · {list.liveEntries} live
                </span>
                <StatusPill
                  status={
                    list.changedEntries || list.draftSchemaVersionId !== list.publishedSchemaVersionId
                      ? list.publishedSchemaVersionId
                        ? 'Live · changes not published'
                        : 'Draft'
                      : 'Live'
                  }
                />
                <small>
                  {list.usedOn?.length
                    ? `Used on ${list.usedOn.length} ${list.usedOn.length === 1 ? 'page' : 'pages'}`
                    : 'No pages yet'}
                </small>
              </Link>
            ))}
          </div>
        )}
      </>
    </>
  )
}

export function CollectionRail({ model: workspace }: { model: CollectionsWorkspaceModel }) {
  const { selected } = workspace.draft
  const { siteId, initial, pending, busy } = workspace
  if (!selected) return null
  return (
    <>
      <nav className={shared.workspaceRail} aria-label="Site lists">
        {initial.collections.map(list => (
          <Link
            key={list.id}
            href={'?collection=' + list.id}
            aria-current={list.id === selected.id ? 'page' : undefined}
            aria-disabled={pending || undefined}
            tabIndex={pending ? -1 : undefined}
            onClick={event => {
              if (busy()) event.preventDefault()
            }}
          >
            <IconCollection size={18} />
            <span className={recordTableStyles.rowCopy}>
              <strong>{list.name}</strong>
              <span className={recordTableStyles.meta}>
                {list.totalEntries} {list.totalEntries === 1 ? 'item' : 'items'}
              </span>
            </span>
          </Link>
        ))}
        <Link
          href={'/sites/' + siteId + '/content?all=1'}
          aria-disabled={pending || undefined}
          tabIndex={pending ? -1 : undefined}
          onClick={event => {
            if (busy()) event.preventDefault()
          }}
        >
          All lists
        </Link>
      </nav>
    </>
  )
}
