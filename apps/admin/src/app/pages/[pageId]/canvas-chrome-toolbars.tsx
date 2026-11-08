import type { RefObject } from 'react'
import { repeatItemSpec, type FieldLike } from '@cms/schema/repeat-items'
import type { EditorSection } from '@cms/domain'
import { listItemUnit } from '../../../lib/list-items.ts'
import { Button, IconButton } from '../../../components/ui/button.tsx'
import { Menu } from '../../../components/ui/menu.tsx'
import { IconArrowUp, IconArrowDown, IconEye, IconMore } from '../../../components/icons.tsx'
import type { CanvasChromeProps } from './canvas-chrome.tsx'
import styles from './canvas-chrome.module.css'

type SectionToolbarProps = Pick<
  CanvasChromeProps,
  'viewport' | 'zoomControl' | 'sections' | 'canReset' | 'onAction' | 'onAdd' | 'nativeSectionTools' | 'name'
> &
  Required<Pick<CanvasChromeProps, 'canMove' | 'canInsertAt' | 'canRemove'>> & {
    section: EditorSection
    selected: number
    sectionTools: RefObject<HTMLDivElement | null>
    toolbarInHeader: boolean
    toolbarTop: number
  }

export function CanvasSectionToolbar({
  sectionTools,
  toolbarInHeader,
  toolbarTop,
  section,
  selected,
  name,
  canMove,
  sections,
  canInsertAt,
  canRemove,
  onAction,
  viewport,
  zoomControl,
  nativeSectionTools,
  canReset,
  onAdd,
}: SectionToolbarProps) {
  const label = name(section)
  return (
    <div
      ref={sectionTools}
      role="toolbar"
      aria-label="Selected section actions"
      className={`${styles.toolbar} ${toolbarInHeader ? styles.headerToolbar : ''}`}
      style={toolbarInHeader ? undefined : { top: toolbarTop }}
    >
      <strong className={styles.sectionName} title={label}>
        {label}
      </strong>
      <IconButton
        variant="secondary"
        size="s"
        tooltip="Move section up"
        disabled={selected === 0 || !canMove(selected, selected - 1)}
        onClick={() => onAction('up', selected)}
      >
        <IconArrowUp size={16} />
      </IconButton>
      <IconButton
        variant="secondary"
        size="s"
        tooltip="Move section down"
        disabled={selected === sections.length - 1 || !canMove(selected, selected + 1)}
        onClick={() => onAction('down', selected)}
      >
        <IconArrowDown size={16} />
      </IconButton>
      <IconButton
        variant="secondary"
        size="s"
        tooltip="Duplicate section"
        disabled={!canInsertAt(selected + 1)}
        onClick={() => onAction('duplicate', selected)}
      >
        ⧉
      </IconButton>
      <IconButton
        variant="secondary"
        size="s"
        tooltip={section.hidden ? 'Show section' : 'Hide until ready'}
        aria-pressed={section.hidden === true}
        onClick={() => onAction('hide', selected)}
      >
        <IconEye size={16} />
      </IconButton>
      <Menu
        boundary={viewport}
        avoid={zoomControl}
        accessibleLabel="More section actions"
        label={<IconMore size={16} />}
      >
        {nativeSectionTools && (
          <>
            <Button variant="tertiary" disabled={!canInsertAt(selected)} onClick={() => onAdd(selected)}>
              Add above
            </Button>
            <Button variant="tertiary" disabled={!canInsertAt(selected + 1)} onClick={() => onAdd(selected + 1)}>
              Add below
            </Button>
            <Button variant="tertiary" onClick={() => onAction('link-copy', selected)}>
              Copy link to this section
            </Button>
            <Button variant="tertiary" onClick={() => onAction('link-name', selected)}>
              Change link name
            </Button>
            <Button variant="tertiary" onClick={() => onAction('send', selected)}>
              Copy to another page
            </Button>
          </>
        )}
        <Button variant="tertiary" onClick={() => onAction('layout', selected)}>
          Change layout
        </Button>
        {canReset && (
          <Button variant="tertiary" onClick={() => onAction('reset', selected)}>
            Reset to live version
          </Button>
        )}
        <Button variant="tertiary" onClick={() => onAction('copy', selected)}>
          Copy section
        </Button>
        <Button
          variant={nativeSectionTools ? 'tertiary' : 'destructive'}
          disabled={!canRemove(selected)}
          onClick={() => onAction('delete', selected)}
        >
          Delete section
        </Button>
      </Menu>
    </div>
  )
}

export function CanvasListItemToolbar({
  item,
  onListAction,
}: {
  item: NonNullable<CanvasChromeProps['selectedItem']>
  onListAction: CanvasChromeProps['onListAction']
}) {
  return (
    <div className={styles.itemToolbar} role="toolbar" aria-label="Selected list item actions">
      <Button size="s" onClick={() => onListAction('edit')}>
        Edit {listItemUnit(item.readerKey)}
      </Button>
      <Button variant="tertiary" size="s" onClick={() => onListAction('hide')}>
        Hide on this page
      </Button>
      <IconButton variant="tertiary" size="s" tooltip="Move item up" onClick={() => onListAction('up')}>
        <IconArrowUp size={14} />
      </IconButton>
      <IconButton variant="tertiary" size="s" tooltip="Move item down" onClick={() => onListAction('down')}>
        <IconArrowDown size={14} />
      </IconButton>
    </div>
  )
}

export function CanvasCardToolbar({
  repeat,
  index,
  count,
  onAction,
}: {
  repeat: FieldLike
  index: number
  count: number
  onAction: (action: 'up' | 'down' | 'duplicate' | 'delete') => void
}) {
  const spec = repeatItemSpec(repeat)
  if (!spec) return null
  return (
    <div className={styles.itemToolbar} role="toolbar" aria-label="Selected card actions">
      <span>
        {spec.unit} {index + 1}
      </span>
      <IconButton
        variant="tertiary"
        size="s"
        tooltip="Move card up"
        disabled={index === 0}
        onClick={() => onAction('up')}
      >
        <IconArrowUp size={14} />
      </IconButton>
      <IconButton
        variant="tertiary"
        size="s"
        tooltip="Move card down"
        disabled={index === count - 1}
        onClick={() => onAction('down')}
      >
        <IconArrowDown size={14} />
      </IconButton>
      <IconButton
        variant="tertiary"
        size="s"
        tooltip="Duplicate card"
        disabled={count >= spec.max}
        onClick={() => onAction('duplicate')}
      >
        ⧉
      </IconButton>
      <IconButton
        variant="destructive"
        size="s"
        tooltip="Delete card"
        disabled={count <= spec.min}
        onClick={() => onAction('delete')}
      >
        ×
      </IconButton>
    </div>
  )
}
