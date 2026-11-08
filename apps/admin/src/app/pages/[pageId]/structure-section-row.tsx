import { isIconSlot } from '@cms/schema'
import { isSectionChanged, isSlotChanged, type EditorSection, type EditorState } from '@cms/domain'
import { Button, Menu } from '../../../components/ui/index.ts'
import type { useReorderableList } from '../../../components/ui/use-reorderable-list.ts'
import reorderStyles from '../../../components/ui/reorderable-list.module.css'
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconMore,
  IconDrag,
  IconEye,
  IconEyeOff,
  SlotIcon,
} from '../../../components/icons.tsx'
import type { structureFields } from '../../../lib/structure-fields.ts'
import { inspectorFieldGroups } from '../../../lib/inspector-groups.ts'

const BREAKPOINT_NAMES: Record<string, string> = { sm: 'phones', md: 'tablets', lg: 'desktops' }
export const structureSectionKey = (origin: string) => 'section:' + origin

type StructureRow = {
  index: number
  label: string
  section: EditorSection
  visibleSlots: ReturnType<typeof structureFields>
  fieldCount: number
}

type SectionRowProps = {
  row: StructureRow
  origin: string
  state: EditorState
  sectionCount: number
  expanded: boolean
  filterActive: boolean
  oneSectionAtATime: boolean
  canManageSections: boolean
  reorderable: boolean
  reorder: ReturnType<typeof useReorderableList<{ from: number; to: number }>>
  locked: (at: number) => boolean
  canInsertAt: (at: number) => boolean
  canMove: (from: number, to: number) => boolean
  moveByKeyboard: (from: number, to: number) => void
  toggleExpanded: () => void
  selectSection: () => void
  onSelect: (section: number, slot: string | null) => void
  onToggleHidden: (section: number) => void
}

export function StructureSectionRow({
  row,
  origin,
  state,
  sectionCount,
  expanded,
  filterActive,
  oneSectionAtATime,
  canManageSections,
  reorderable,
  reorder,
  locked,
  canInsertAt,
  canMove,
  moveByKeyboard,
  toggleExpanded,
  selectSection,
  onSelect,
  onToggleHidden,
}: SectionRowProps) {
  const isLocked = locked(row.index)
  const selected = state.selection.section === row.index
  const hiddenAt = (row.section.hidden_at ?? []).map(name => BREAKPOINT_NAMES[name] ?? name)
  return (
    <li className={`tree-card ${selected ? 'is-selected' : ''}`}>
      <div
        className={`tree-section ${row.section.hidden ? 'is-hidden' : ''} ${selected && !state.selection.slot ? 'on' : ''}`}
        {...reorder.row(structureSectionKey(origin), !reorderable, reorderable && !isLocked && canInsertAt(row.index))}
      >
        {(reorder.blocked ?? reorder.rejection)?.row === structureSectionKey(origin) && (
          <span aria-hidden="true" className={reorderStyles.reason}>
            {(reorder.blocked ?? reorder.rejection)?.message}
          </span>
        )}
        {row.visibleSlots.length > 0 && (
          <button
            type="button"
            className="tree-collapse"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.label}`}
            aria-expanded={expanded}
            aria-controls={`tree-fields-${row.index}`}
            disabled={filterActive}
            onClick={toggleExpanded}
          >
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>
        )}
        <button
          type="button"
          className="tree-label"
          aria-label={row.label}
          title={row.label}
          onClick={selectSection}
          aria-current={selected && !state.selection.slot ? 'true' : undefined}
          onKeyDown={event => {
            // Alt+arrow moves the section; a bare arrow is left alone
            // so it still scrolls and still moves a screen reader's
            // cursor the way the rest of the page does.
            if (!canManageSections || !event.altKey || isLocked) return
            if (event.key === 'ArrowUp' && row.index > 0 && canMove(row.index, row.index - 1)) {
              event.preventDefault()
              moveByKeyboard(row.index, row.index - 1)
            } else if (event.key === 'ArrowDown' && row.index < sectionCount - 1 && canMove(row.index, row.index + 1)) {
              event.preventDefault()
              moveByKeyboard(row.index, row.index + 1)
            }
          }}
        >
          {!oneSectionAtATime && reorderable && canInsertAt(row.index) && (
            <IconDrag size={13} className="icon-svg tree-grip" />
          )}
          {isSectionChanged(state, row.index) && <span className="dot" aria-label="Changed" />}
          <span className="tree-text">
            <span className="tree-name">{row.label}</span>
            {(!oneSectionAtATime || isLocked) && (
              <span className="tree-field-count">
                {isLocked
                  ? 'Site editors only'
                  : row.fieldCount === 0
                    ? 'Nothing to edit'
                    : `${row.fieldCount} editable ${row.fieldCount === 1 ? 'field' : 'fields'}`}
              </span>
            )}
            {row.section.hidden && <span className="tree-flag">hidden</span>}
            {hiddenAt.length > 0 && <span className="tree-flag">hidden on {hiddenAt.join(' and ')}</span>}
          </span>
        </button>
        {oneSectionAtATime && canManageSections && (
          <Menu label={<IconMore size={16} />} accessibleLabel={'Actions for ' + row.label}>
            <Button
              variant="tertiary"
              aria-label={`${row.section.hidden ? 'Show' : 'Hide'} ${row.label}`}
              disabled={isLocked}
              onClick={() => onToggleHidden(row.index)}
            >
              {row.section.hidden ? 'Show section' : 'Hide section'}
            </Button>
            {reorderable && (
              <>
                <Button
                  variant="tertiary"
                  aria-label={`Move ${row.label} up`}
                  disabled={row.index === 0 || isLocked || !canMove(row.index, row.index - 1)}
                  onClick={() => moveByKeyboard(row.index, row.index - 1)}
                >
                  Move up
                </Button>
                <Button
                  variant="tertiary"
                  aria-label={`Move ${row.label} down`}
                  disabled={row.index === sectionCount - 1 || isLocked || !canMove(row.index, row.index + 1)}
                  onClick={() => moveByKeyboard(row.index, row.index + 1)}
                >
                  Move down
                </Button>
              </>
            )}
          </Menu>
        )}
        {canManageSections && !oneSectionAtATime && (
          <>
            <button
              type="button"
              className="tree-visibility"
              aria-label={`${row.section.hidden ? 'Show' : 'Hide'} ${row.label}`}
              title={`${row.section.hidden ? 'Show' : 'Hide'} this section`}
              disabled={isLocked}
              aria-pressed={row.section.hidden === true}
              onClick={() => onToggleHidden(row.index)}
            >
              {row.section.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
            </button>
            <span className="reorder" role="group" aria-label={`Move ${row.label}`}>
              <button
                type="button"
                aria-label={`Move ${row.label} up`}
                disabled={row.index === 0 || isLocked || locked(row.index - 1)}
                onClick={() => moveByKeyboard(row.index, row.index - 1)}
              >
                <IconArrowUp size={13} />
              </button>
              <button
                type="button"
                aria-label={`Move ${row.label} down`}
                disabled={row.index === sectionCount - 1 || isLocked || locked(row.index + 1)}
                onClick={() => moveByKeyboard(row.index, row.index + 1)}
              >
                <IconArrowDown size={13} />
              </button>
            </span>
          </>
        )}
      </div>

      {!isLocked && row.visibleSlots.length > 0 && (
        <ul id={`tree-fields-${row.index}`} className="tree-slots" hidden={!expanded}>
          {inspectorFieldGroups(row.visibleSlots).map(group => {
            const members = group.kind === 'link' ? [...group.words, group.destination] : [group.slot]
            const target = members[0]!
            const on = selected && members.some(slot => slot.memberIds.includes(state.selection.slot ?? ''))
            const changed = members.some(slot => slot.memberIds.some(id => isSlotChanged(state, row.index, id)))
            return (
              <li key={target.id}>
                <button
                  type="button"
                  className={`tree-slot ${on ? 'on' : ''}`}
                  onClick={() => onSelect(row.index, target.id)}
                >
                  {!oneSectionAtATime && (
                    <span className="kind">
                      <SlotIcon
                        kind={group.kind === 'link' ? 'link' : isIconSlot(target) ? 'icon' : target.kind}
                        size={14}
                      />
                    </span>
                  )}
                  <span className="tree-name">{group.kind === 'link' ? group.name : target.label}</span>
                  {changed && <span className="dot" aria-label="Changed" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
