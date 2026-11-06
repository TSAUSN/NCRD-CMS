'use client'
import { installNativeFieldFeedback } from './canvas-field-feedback.ts'
import { listItemUnit } from '../../../lib/list-items.ts'
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { parseRepeatItemSlotId, repeatItemKeys, repeatItemSpec, type FieldLike } from '@cms/schema/repeat-items'
import type { EditorSection } from '@cms/domain'
import { Button, IconButton } from '../../../components/ui/button.tsx'
import { Menu } from '../../../components/ui/menu.tsx'
import { IconArrowUp, IconArrowDown, IconEye, IconMore, IconPlus } from '../../../components/icons.tsx'
import styles from './canvas-chrome.module.css'

export type CanvasHover = { section: number; repeatId: string; key: string }
export type CanvasSurface = { document: Document; element: HTMLElement }
type Box = { top: number; bottom: number; left: number; width: number }
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
}: {
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
}) {
  const [hovered, setHovered] = useState<CanvasHover | null>(null)
  const lastHover = useRef('null')
  const sectionTools = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<{
    boxes: Map<number, Box>
    height: number
    ghosts: { slot: FieldLike; host: Element; className: string }[]
    listGhosts: { reader: string; field: string; host: Element; className: string }[]
    toolbarTop: number
    toolbarInHeader: boolean
  }>({ boxes: new Map(), height: 0, ghosts: [], listGhosts: [], toolbarTop: 0, toolbarInHeader: false })
  const effectiveHover = hoveredItem === undefined ? hovered : hoveredItem
  const item = effectiveHover ?? (selectedSlot ? parseRepeatItemSlotId(selectedSlot) : null)
  const itemSection = effectiveHover?.section ?? selected
  useLayoutEffect(() => {
    if (mode === 'toolbar-only') {
      setGeometry({ boxes: new Map(), height: 0, ghosts: [], listGhosts: [], toolbarTop: 0, toolbarInHeader: true })
      return
    }
    const doc = surface?.document ?? frame.current?.contentDocument,
      container = viewport.current,
      iframe = surface?.element ?? frame.current
    if (!doc || !container || !iframe || !ready) return
    if (preserveLayout) installNativeFieldFeedback(doc)
    let queued = 0
    function measure() {
      doc!.documentElement.toggleAttribute('data-cms-site-controls', preserveLayout)
      queued = 0
      const base = container!.getBoundingClientRect(),
        offset = iframe!.getBoundingClientRect()
      const boxes = new Map<number, Box>()
      const box = (rect: { top: number; bottom: number; left: number; width: number }): Box => ({
        top: offset.top - base.top + rect.top * scale,
        bottom: offset.top - base.top + rect.bottom * scale,
        left: offset.left - base.left + rect.left * scale,
        width: rect.width * scale,
      })
      doc!.querySelectorAll<HTMLElement>('[data-cms-section]').forEach(node => {
        const index = Number(node.dataset.cmsSection)
        if (Number.isSafeInteger(index) && index >= 0 && index < sections.length)
          boxes.set(index, box(node.getBoundingClientRect()))
      })
      const ghosts: { slot: FieldLike; host: Element; className: string }[] = []
      if (!preserveLayout && selected !== null && sections[selected])
        for (const slot of slotsFor(sections[selected]!)) {
          const spec = repeatItemSpec(slot)
          if (!spec) continue
          const keys = repeatItemKeys(sections[selected]!.values[slot.id])
          if (keys.length >= spec.max) continue
          const roots = keys.flatMap(key => {
            const node = [
              ...doc!.querySelectorAll<HTMLElement>('[data-cms-section="' + selected + '"] [data-cms-slot]'),
            ].find(node => node.dataset.cmsSlot?.startsWith(slot.id + '__' + key + '__'))
            return node ? [node.closest('article,li,figure') ?? node] : []
          })
          let host: Element | null = roots[0]?.parentElement ?? null
          while (host && !roots.every(root => host!.contains(root))) host = host.parentElement
          const section = doc!.querySelector('[data-cms-section="' + selected + '"]')
          if (!host || !section?.contains(host) || host === section) continue
          let layout = roots[0]!
          while (layout.parentElement && layout.parentElement !== host) layout = layout.parentElement
          ghosts.push({ slot, host, className: layout.className })
        }
      const listGhosts =
        preserveLayout || selected === null
          ? []
          : [
              ...doc!.querySelectorAll<HTMLElement>(
                '[data-cms-section="' + selected + '"] [data-cms-kind="repeat"][data-cms-reader]',
              ),
            ].map(parent => {
              const table = parent.tagName === 'TBODY' ? parent.closest('table') : null
              return {
                reader: parent.dataset.cmsReader!,
                field: parent.dataset.cmsSlot!,
                host: table
                  ? (table.closest('.bootstrap-table')?.parentElement ?? table.parentElement ?? parent)
                  : parent,
                className: table ? '' : (parent.querySelector('[data-cms-entry]')?.className ?? ''),
              }
            })
      const active = selected === null ? null : boxes.get(selected)
      const toolbarTop = active ? Math.max(0, Math.min(Math.max(32, active.top + 32), container!.clientHeight - 96)) : 0
      const toolbarWidth = Math.min(sectionTools.current?.offsetWidth ?? 192, container!.clientWidth)
      const toolbarHeight = sectionTools.current?.offsetHeight ?? 48
      const toolbarLeft = container!.clientWidth - toolbarWidth - 8
      const selectedRoot = selected === null ? null : doc!.querySelector('[data-cms-section="' + selected + '"]')
      const text = [...(selectedRoot?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,a,button,summary') ?? [])]
      const coversText = text.some(
        node =>
          node.textContent?.trim() &&
          [...node.getClientRects()].some(rect => {
            const bounds = box(rect)
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              bounds.left < toolbarLeft + toolbarWidth &&
              bounds.left + bounds.width > toolbarLeft &&
              bounds.top < toolbarTop + toolbarHeight &&
              bounds.bottom > toolbarTop
            )
          }),
      )
      setGeometry({
        boxes,
        height: container!.clientHeight,
        ghosts,
        listGhosts,
        toolbarTop,
        toolbarInHeader:
          iframe!.clientWidth <= 768 ||
          !active ||
          active.top < 0 ||
          active.top > container!.clientHeight - 128 ||
          coversText,
      })
    }
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(measure)
    }
    const hover = (event: PointerEvent) => {
      const target = event.target as Element
      const card = target.closest?.('article,li,figure,.core-card,.card')
      const field = target.closest?.('[data-cms-slot]') ?? card?.querySelector('[data-cms-slot]')
      const parsed = field ? parseRepeatItemSlotId(field.getAttribute('data-cms-slot') ?? '') : null
      const index = Number(field?.closest('[data-cms-section]')?.getAttribute('data-cms-section'))
      const next =
        parsed && Number.isSafeInteger(index) ? { section: index, repeatId: parsed.repeatId, key: parsed.key } : null
      const encoded = JSON.stringify(next)
      if (lastHover.current !== encoded) {
        lastHover.current = encoded
        setHovered(next)
        onHover?.(next)
      }
    }
    doc.addEventListener('pointermove', hover)
    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(doc.documentElement)
    observer.observe(container)
    if (sectionTools.current) observer.observe(sectionTools.current)
    doc.addEventListener('scroll', schedule, true)
    container.addEventListener('scroll', schedule)
    const mutations = new MutationObserver(schedule)
    mutations.observe(doc.body, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(queued)
      observer.disconnect()
      mutations.disconnect()
      doc.removeEventListener('pointermove', hover)
      doc.removeEventListener('scroll', schedule, true)
      container.removeEventListener('scroll', schedule)
    }
  }, [
    frame,
    viewport,
    ready,
    scale,
    sections,
    selected,
    selectedSlot,
    selectedItem,
    hovered,
    mode,
    surface,
    onHover,
    preserveLayout,
  ])
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
      <div
        ref={sectionTools}
        role="toolbar"
        aria-label="Selected section actions"
        className={`${styles.toolbar} ${toolbarInHeader ? styles.headerToolbar : ''}`}
        style={toolbarInHeader ? undefined : { top: geometry.toolbarTop }}
      >
        <strong className={styles.sectionName} title={name(section)}>
          {name(section)}
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
    ) : null
  const itemToolbar = selectedItem ? (
    <div className={styles.itemToolbar} role="toolbar" aria-label="Selected list item actions">
      <Button size="s" onClick={() => onListAction('edit')}>
        Edit {unit(selectedItem.readerKey)}
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
  ) : !preserveLayout && repeat && item && itemIndex >= 0 ? (
    <div className={styles.itemToolbar} role="toolbar" aria-label="Selected card actions">
      <span>
        {repeatItemSpec(repeat)?.unit} {itemIndex + 1}
      </span>
      <IconButton
        variant="tertiary"
        size="s"
        tooltip="Move card up"
        disabled={itemIndex === 0}
        onClick={() => onRepeat(itemSection!, repeat, 'up', item.key)}
      >
        <IconArrowUp size={14} />
      </IconButton>
      <IconButton
        variant="tertiary"
        size="s"
        tooltip="Move card down"
        disabled={itemIndex === keys.length - 1}
        onClick={() => onRepeat(itemSection!, repeat, 'down', item.key)}
      >
        <IconArrowDown size={14} />
      </IconButton>
      <IconButton
        variant="tertiary"
        size="s"
        tooltip="Duplicate card"
        disabled={keys.length >= repeatItemSpec(repeat)!.max}
        onClick={() => onRepeat(itemSection!, repeat, 'duplicate', item.key)}
      >
        ⧉
      </IconButton>
      <IconButton
        variant="destructive"
        size="s"
        tooltip="Delete card"
        disabled={keys.length <= repeatItemSpec(repeat)!.min}
        onClick={() => onRepeat(itemSection!, repeat, 'delete', item.key)}
      >
        ×
      </IconButton>
    </div>
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
                  : geometry.boxes.get(insertionMarker),
              top = insertionMarker === sections.length ? box?.bottom : box?.top
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
