'use client'
import { useCanvasChromeGeometry } from './canvas-chrome-geometry.ts'
import { CanvasCardToolbar, CanvasListItemToolbar, CanvasSectionToolbar } from './canvas-chrome-toolbars.tsx'
import { listItemUnit } from '../../../lib/list-items.ts'
import { useRef, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { parseRepeatItemSlotId, repeatItemKeys, repeatItemSpec, type FieldLike } from '@cms/schema/repeat-items'
import type { EditorSection } from '@cms/domain'
import { Button } from '../../../components/ui/button.tsx'
import { IconPlus } from '../../../components/icons.tsx'
import styles from './canvas-chrome.module.css'

export type CanvasHover = { section: number; repeatId: string; key: string }
type CanvasSurface = { document: Document; element: HTMLElement }
export type CanvasAction =
  | 'up'
  | 'down'
  | 'duplicate'
  | 'hide'
  | 'layout'
  | 'reset'
  | 'delete'
  | 'copy'
  | 'link-copy'
  | 'link-name'
  | 'send'
export type CanvasChromeProps = {
  nativeSectionTools?: boolean
  canManageSections?: boolean
  insertionMarker?: number | null
  choosingInsertion?: boolean
  preserveLayout?: boolean
  /** Isolated frames reuse the canvas layer locally; the admin keeps toolbars. */
  mode?: 'full' | 'canvas-only' | 'toolbar-only'
  surface?: CanvasSurface
  hoveredItem?: CanvasHover | null
  canInsertAt?: (index: number) => boolean
  canMove?: (from: number, to: number) => boolean
  canRemove?: (index: number) => boolean
  onHover?: (item: CanvasHover | null) => void
  toolbarHost: RefObject<HTMLDivElement | null>
  zoomControl: RefObject<HTMLDivElement | null>
  slotsFor: (section: EditorSection) => readonly FieldLike[]
  frame: RefObject<HTMLIFrameElement | null>
  viewport: RefObject<HTMLElement | null>
  ready: number
  scale: number
  sections: readonly EditorSection[]
  selected: number | null
  selectedSlot: string | null
  slots: readonly FieldLike[]
  name: (section: EditorSection) => string
  onAdd: (at: number) => void
  onAction: (action: CanvasAction, index: number) => void
  selectedItem: { readerKey: string; stableKey: string; field: string } | null
  onListAction: (action: 'edit' | 'hide' | 'up' | 'down') => void
  onListAdd: (readerKey: string) => void
  canReset: boolean
  onRepeat: (
    index: number,
    slot: FieldLike,
    action: 'add' | 'up' | 'down' | 'duplicate' | 'delete',
    key?: string,
  ) => void
}

export function CanvasChrome({
  frame,
  viewport,
  ready,
  scale,
  sections,
  selected,
  selectedSlot,
  slots,
  name,
  onAdd,
  onAction,
  canReset,
  onRepeat,
  selectedItem,
  onListAction,
  onListAdd,
  slotsFor,
  zoomControl,
  toolbarHost,
  mode = 'full',
  surface,
  hoveredItem,
  onHover,
  canInsertAt = () => true,
  canMove = () => true,
  canRemove = () => true,
  preserveLayout = false,
  canManageSections = true,
  nativeSectionTools = false,
  choosingInsertion = false,
  insertionMarker = null,
}: CanvasChromeProps) {
  const sectionTools = useRef<HTMLDivElement | null>(null)
  const { geometry, hovered } = useCanvasChromeGeometry({
    frame,
    viewport,
    ready,
    scale,
    sections,
    selected,
    selectedSlot,
    selectedItem,
    mode,
    surface,
    onHover,
    preserveLayout,
    slotsFor,
    sectionTools,
  })
  const effectiveHover = hoveredItem === undefined ? hovered : hoveredItem
  const item = effectiveHover ?? (selectedSlot ? parseRepeatItemSlotId(selectedSlot) : null)
  const itemSection = effectiveHover?.section ?? selected
  const active = selected !== null ? geometry.boxes.get(selected) : null
  const repeat =
    item && itemSection !== null && sections[itemSection]
      ? slotsFor(sections[itemSection]!).find(slot => slot.id === item.repeatId)
      : null
  const repeats = slots.filter(slot => repeatItemSpec(slot))
  const section = selected !== null ? sections[selected] : null
  const lists = section
    ? slots.flatMap(slot => {
        const value = section.values[slot.id] as { readerKey?: unknown } | undefined
        return slot.kind === 'repeat' && !repeatItemSpec(slot) && typeof value?.readerKey === 'string'
          ? [value.readerKey]
          : []
      })
    : []
  const unit = listItemUnit
  const keys =
    repeat && itemSection !== null && sections[itemSection]
      ? repeatItemKeys(sections[itemSection]!.values[repeat.id])
      : []
  const itemIndex = item ? keys.indexOf(item.key) : -1
  const ghostStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--cms-space-2)',
    width: '100%',
    minHeight: 'calc(var(--cms-target-small) / var(--cms-editor-scale))',
    marginBlock: 'var(--cms-space-2)',
    padding: 'calc(var(--cms-space-2) / var(--cms-editor-scale))',
    border: 'var(--cms-line-thin) dashed var(--cms-editor-select)',
    borderRadius: 'var(--cms-radius-control)',
    background: 'var(--cms-surface)',
    color: 'var(--cms-editor-select)',
    cursor: 'pointer',
    fontSize: 'calc(var(--cms-text-meta) / var(--cms-editor-scale))',
    lineHeight: '1.4',
    '--cms-editor-scale': scale,
  } as CSSProperties
  const toolbarInHeader = preserveLayout || mode !== 'full' || geometry.toolbarInHeader

  const sectionToolbar =
    canManageSections && section && selected !== null ? (
      <CanvasSectionToolbar
        sectionTools={sectionTools}
        toolbarInHeader={toolbarInHeader}
        toolbarTop={geometry.toolbarTop}
        section={section}
        selected={selected}
        name={name}
        canMove={canMove}
        sections={sections}
        canInsertAt={canInsertAt}
        canRemove={canRemove}
        onAction={onAction}
        viewport={viewport}
        zoomControl={zoomControl}
        nativeSectionTools={nativeSectionTools}
        canReset={canReset}
        onAdd={onAdd}
      />
    ) : null
  const itemToolbar = selectedItem ? (
    <CanvasListItemToolbar item={selectedItem} onListAction={onListAction} />
  ) : !preserveLayout && repeat && item && itemSection !== null && itemIndex >= 0 ? (
    <CanvasCardToolbar
      repeat={repeat}
      index={itemIndex}
      count={keys.length}
      onAction={action => onRepeat(itemSection, repeat, action, item.key)}
    />
  ) : null
  const headerToolbar = (
    <>
      {toolbarInHeader && sectionToolbar}
      {itemToolbar}
    </>
  )
  const hasHeaderToolbar = Boolean(itemToolbar || (toolbarInHeader && sectionToolbar))
  return (
    <>
      <div className={styles.overlay} aria-label="Page canvas actions">
        {insertionMarker !== null &&
          (() => {
            const box =
              insertionMarker === sections.length
                ? geometry.boxes.get(sections.length - 1)
                : geometry.boxes.get(insertionMarker)
            const top = insertionMarker === sections.length ? box?.bottom : box?.top
            return top !== undefined && top >= 0 && top < geometry.height ? (
              <div className={styles.insertion} data-choosing="true" style={{ top }}>
                <Button variant="secondary" size="s" disabled>
                  The new section goes here
                </Button>
              </div>
            ) : null
          })()}
        {canManageSections &&
          (!preserveLayout || choosingInsertion) &&
          [...geometry.boxes]
            .filter(([index]) => index >= 0 && index < sections.length)
            .map(([index, box]) => {
              if (!canInsertAt(index) || box.top < 0 || box.top > geometry.height - 32) return null
              return (
                <div
                  key={index}
                  className={styles.insertion}
                  data-choosing={choosingInsertion}
                  style={{ top: box.top }}
                >
                  <Button
                    size="s"
                    variant="secondary"
                    aria-label={
                      index === 0 ? 'Add section at start of page' : 'Add section after ' + name(sections[index - 1]!)
                    }
                    onClick={() => onAdd(index)}
                  >
                    <IconPlus size={14} />
                    <span>{choosingInsertion ? 'Add here' : 'Add section'}</span>
                  </Button>
                </div>
              )
            })}
        {canManageSections &&
          (!preserveLayout || choosingInsertion) &&
          sections.length > 0 &&
          (() => {
            const last = geometry.boxes.get(sections.length - 1)
            return last && last.bottom > 0 && last.bottom < geometry.height - 32 ? (
              <div className={styles.insertion} data-choosing={choosingInsertion} style={{ top: last.bottom }}>
                <Button
                  size="s"
                  variant="secondary"
                  aria-label={'Add section after ' + name(sections.at(-1)!)}
                  onClick={() => onAdd(sections.length)}
                >
                  <IconPlus size={14} />
                  <span>{choosingInsertion ? 'Add here' : 'Add section'}</span>
                </Button>
              </div>
            ) : null
          })()}
        {active && section && selected !== null && (
          <>
            {!toolbarInHeader && sectionToolbar}
            {!preserveLayout &&
              active.bottom > 80 &&
              active.bottom < geometry.height - 48 &&
              lists
                .filter(reader => !geometry.listGhosts.some(ghost => ghost.reader === reader))
                .map(reader => (
                  <Button
                    key={reader}
                    className={styles.ghost}
                    style={{ top: active.bottom - 48 }}
                    variant="secondary"
                    size="s"
                    onClick={() => onListAdd(reader)}
                  >
                    <IconPlus size={16} />
                    Add {unit(reader)}
                  </Button>
                ))}
            {!preserveLayout &&
              active.bottom > 80 &&
              active.bottom < geometry.height - 48 &&
              repeats
                .filter(slot => !geometry.ghosts.some(ghost => ghost.slot.id === slot.id))
                .map(slot => {
                  const spec = repeatItemSpec(slot)!
                  return (
                    <Button
                      key={slot.id}
                      className={styles.ghost}
                      style={{ top: active.bottom - 48 }}
                      variant="secondary"
                      size="s"
                      disabled={repeatItemKeys(section.values[slot.id]).length >= spec.max}
                      onClick={() => onRepeat(selected!, slot, 'add')}
                    >
                      <IconPlus size={16} />
                      Add {spec.unit.toLowerCase()}
                    </Button>
                  )
                })}
          </>
        )}
      </div>
      {mode !== 'canvas-only' &&
        toolbarHost.current &&
        hasHeaderToolbar &&
        createPortal(headerToolbar, toolbarHost.current)}
      {selected !== null &&
        geometry.ghosts.map(ghost =>
          createPortal(
            <div
              className={ghost.className}
              data-cms-editor-ghost=""
              style={{ display: 'flex', alignItems: 'stretch' }}
            >
              <Button variant="secondary" style={ghostStyle} onClick={() => onRepeat(selected, ghost.slot, 'add')}>
                <IconPlus size={16} />
                Add {repeatItemSpec(ghost.slot)!.unit.toLowerCase()}
              </Button>
            </div>,
            ghost.host,
            ghost.slot.id + '-' + ready,
          ),
        )}
      {selected !== null &&
        geometry.listGhosts.map(ghost => {
          const button = (
            <Button
              variant="secondary"
              aria-label={'Add ' + unit(ghost.reader)}
              style={ghostStyle}
              onClick={() => onListAdd(ghost.reader)}
            >
              + Add {unit(ghost.reader)}
            </Button>
          )
          // Site table scripts own tbody children. Keep the control beside the table
          // so sorting, filtering and pagination cannot remove React's portal.
          const content = (
            <div
              className={ghost.className}
              data-cms-editor-list-ghost=""
              style={{ display: 'flex', alignItems: 'stretch', opacity: 1, transform: 'none', animation: 'none' }}
            >
              {button}
            </div>
          )
          return createPortal(content, ghost.host, ghost.reader + '-' + ghost.field + '-' + ready)
        })}
    </>
  )
}
