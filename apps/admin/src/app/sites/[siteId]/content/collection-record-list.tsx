'use client'

import { useMemo } from 'react'
import type { CollectionModel } from '@cms/schema'
import { IconImage, IconMore } from '../../../../components/icons.tsx'
import { Badge, Button, EmptyState, Menu } from '../../../../components/ui/index.ts'
import { imagePreview } from '../../../../components/collection-field-control.tsx'
import { DropIndicator, ReorderAnnouncement } from '../../../../components/ui/drop-indicator.tsx'
import type { FlatMove } from '../../../../components/ui/flat-reorder.ts'
import type { useReorderableList } from '../../../../components/ui/use-reorderable-list.ts'
import reorderStyles from '../../../../components/ui/reorderable-list.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import type { EntryState } from './collection-entries.ts'
import { entryChanged, entryIdentity, recordImage, recordSubtitle, recordTitle } from './collection-record-display.ts'
import styles from './lists.module.css'
import ownedStyles from './collections-workspace-styles.module.css'

type Props = {
  model: CollectionModel
  listName: string
  noun: string
  entries: EntryState[]
  visible: EntryState[]
  availableMedia: MediaAsset[]
  checked: string[]
  view: string
  canEdit: boolean
  pending: boolean
  busy: () => boolean
  reorder: ReturnType<typeof useReorderableList<FlatMove>>
  openEntry: (entry: EntryState) => void
  moveEntry: (key: string, direction: -1 | 1) => void
  select: (key: string, selected: boolean) => void
}

/** Display records and their row actions; the workspace owns draft commands. */
export function CollectionRecordList({
  model,
  listName,
  noun,
  entries,
  visible,
  availableMedia,
  checked,
  view,
  canEdit,
  pending,
  busy,
  reorder,
  openEntry,
  moveEntry,
  select,
}: Props) {
  const { activePositions, activeCount } = useMemo(() => {
    const activePositions = new Map<string, number>()
    let activeCount = 0
    for (const entry of entries) {
      if (entry.archived) continue
      const key = entryIdentity(entry)
      if (!activePositions.has(key)) activePositions.set(key, activeCount)
      activeCount++
    }
    return { activePositions, activeCount }
  }, [entries])
  const selectedKeys = useMemo(() => new Set(checked), [checked])
  const rejection = reorder.blocked ?? reorder.rejection
  return (
    <div className={styles.recordTable} data-view={view}>
      {view === 'table' && visible.length > 0 && (
        <div className={ownedStyles.recordHeader} aria-hidden="true" data-editable={canEdit}>
          {canEdit && <span />}
          <span>{model.fields.find(field => field.key === model.presentation.titleField)?.label ?? 'Name'}</span>
          <span>{model.fields.find(field => field.key === model.presentation.subtitleField)?.label ?? 'Details'}</span>
          <span>Status</span>
          <span data-secondary>Updated</span>
          {canEdit && <span />}
        </div>
      )}
      <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
      {visible.length === 0 ? (
        <EmptyState title={entries.length ? 'No matching items' : 'Add the first ' + noun}>
          {entries.length ? 'Try another search or filter.' : 'Your list starts as a private draft.'}
        </EmptyState>
      ) : (
        <div
          className={styles.results + ' ' + ownedStyles.recordRows + ' ' + reorderStyles.list}
          data-reorder-list
          data-view={view}
          role="list"
          aria-label={listName + ' items'}
        >
          {visible.map(entry => {
            const key = entryIdentity(entry),
              title = recordTitle(entry, model),
              subtitle = recordSubtitle(entry, model),
              changed = !entry.archived && entryChanged(entry),
              position = activePositions.get(key) ?? -1,
              photo = imagePreview(recordImage(entry, model), availableMedia)
            const dragRow = reorder.row(key, !canEdit || pending || entry.archived)
            return (
              <article
                key={key}
                role="listitem"
                className={styles.item + ' ' + ownedStyles.recordRow}
                data-selected={selectedKeys.has(key)}
                {...dragRow}
                onDragStart={event => {
                  if (busy()) {
                    event.preventDefault()
                    return
                  }
                  dragRow.onDragStart(event)
                }}
              >
                <DropIndicator marker={reorder.marker} row={key} />
                {rejection?.row === key && (
                  <span className={reorderStyles.reason} aria-hidden="true">
                    {rejection.message}
                  </span>
                )}
                {canEdit && (
                  <label className={styles.select + ' ' + selectionControlsStyles.checkRow}>
                    <input
                      type="checkbox"
                      aria-label={'Select ' + title}
                      checked={selectedKeys.has(key)}
                      onChange={event => select(key, event.target.checked)}
                    />
                  </label>
                )}
                <button
                  type="button"
                  className={styles.open + ' ' + ownedStyles.recordOpen}
                  onClick={() => openEntry(entry)}
                  aria-label={'Edit ' + title}
                >
                  <span className={styles.entryName}>
                    {model.presentation.imageField && (
                      <span className={styles.photo + ' ' + ownedStyles.recordPhoto}>
                        {photo ? <img src={photo} alt="" /> : <IconImage size={20} />}
                      </span>
                    )}
                    <span className={styles.identity}>
                      <strong className={ownedStyles.recordName} title={title}>
                        {title}
                      </strong>
                    </span>
                  </span>
                  <span className={ownedStyles.recordValue} title={subtitle}>
                    {subtitle}
                  </span>
                  <Badge tone={entry.archived ? 'neutral' : changed ? 'pending' : 'live'}>
                    {entry.archived
                      ? 'Hidden'
                      : changed
                        ? entry.publishedValues === null
                          ? 'Draft'
                          : 'Changes not live'
                        : 'Live'}
                  </Badge>
                  <small
                    data-secondary
                    className={ownedStyles.recordValue}
                    title={
                      (entry.editedBy ?? 'Not saved yet') +
                      (entry.editedAt ? ' · ' + new Date(entry.editedAt).toLocaleString('en-US') : '')
                    }
                  >
                    {entry.editedBy ?? 'Not saved yet'}
                    {entry.editedAt &&
                      ' · ' +
                        new Date(entry.editedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                  </small>
                </button>
                {canEdit && (
                  <span className={ownedStyles.recordAction}>
                    {!entry.archived && (
                      <Menu label={<IconMore size={16} />} accessibleLabel={'Actions for ' + title}>
                        <Button
                          variant="tertiary"
                          aria-label={'Move ' + title + ' up'}
                          disabled={pending || position <= 0}
                          onClick={() => moveEntry(key, -1)}
                        >
                          Move up
                        </Button>
                        <Button
                          variant="tertiary"
                          aria-label={'Move ' + title + ' down'}
                          disabled={pending || position >= activeCount - 1}
                          onClick={() => moveEntry(key, 1)}
                        >
                          Move down
                        </Button>
                      </Menu>
                    )}
                  </span>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
