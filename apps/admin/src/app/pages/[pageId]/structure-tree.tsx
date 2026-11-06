'use client'
import { Button, Menu, SearchField } from '../../../components/ui/index.ts'
import { editorContentSlots } from '../../../lib/editor-content-slots.ts'
import { structureFields } from '../../../lib/structure-fields.ts'
// Section cards keep selection, field changes, and keyboard reordering together.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { isIconSlot, repeatItemSpec } from '@cms/schema'
import { changedSlots, isSectionChanged, isSlotChanged, type EditorState } from '@cms/domain'
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconMore,
  IconDrag,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconSearch,
  IconSections,
  SlotIcon,
} from '../../../components/icons.tsx'
import type { LibraryEntry } from './editor.tsx'
import { sectionDisplayName } from '../../../lib/section-display-name.ts'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import { inspectorFieldGroups } from '../../../lib/inspector-groups.ts'

const BREAKPOINT_NAMES: Record<string, string> = { sm: 'phones', md: 'tablets', lg: 'desktops' }

type Props = {
  canManageSections?: boolean
  canInsertAt?: (index: number) => boolean
  canMove?: (from: number, to: number) => boolean
  locked?: (index: number) => boolean
  oneSectionAtATime?: boolean
  state: EditorState
  library: Map<string, LibraryEntry>
  onSelect: (section: number, slot: string | null) => void
  onMove: (from: number, to: number) => void
  onAdd: (at: number) => void
  onDropLibrary: (sectionDefId: string, at: number) => void
  onToggleHidden: (section: number) => void
  /** Kept for the page-settings entry point that lives in the editor bar. */
  onPageSettings?: () => void
}

export function StructureTree({
  state,
  library,
  canManageSections = true,
  oneSectionAtATime = false,
  locked = () => false,
  canInsertAt = () => true,
  canMove = () => true,
  onSelect,
  onMove,
  onAdd,
  onDropLibrary,
  onToggleHidden,
}: Props) {
  const [search, setSearch] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [openOrigin, setOpenOrigin] = useState<string | null>(() =>
    oneSectionAtATime && state.selection.section !== null
      ? (state.sectionOrigins[state.selection.section] ?? null)
      : null,
  )
  /** The row being dragged, and the gap the pointer is currently over. */
  const dragging = useRef<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const sections = state.document.sections
  const selectedOrigin = state.selection.section === null ? null : state.sectionOrigins[state.selection.section]
  useEffect(() => {
    if (oneSectionAtATime) {
      setOpenOrigin(selectedOrigin ?? null)
      return
    }
    if (!selectedOrigin || !state.selection.slot) return
    setCollapsed(previous => {
      if (!previous.has(selectedOrigin)) return previous
      const next = new Set(previous)
      next.delete(selectedOrigin)
      return next
    })
  }, [selectedOrigin, state.selection.slot, oneSectionAtATime])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return sections
      .map((section, index) => {
        const entry = library.get(sectionVersionKey(section.section_def_id, section.section_def_version))
        // A repeated list's item fields are listed by item (“Card 2 · Title”, LIB-02).
        const slots = structureFields(
          editorContentSlots(entry?.slots ?? [], entry?.slug, oneSectionAtATime, section.values),
          section.values,
          oneSectionAtATime,
        ).filter(slot => !repeatItemSpec(slot))
        const changed = changedSlots(state, index)

        const visibleSlots = slots.filter(slot => {
          if (changedOnly && !slot.memberIds.some(id => changed.includes(id))) return false
          if (!term) return true
          const value = searchableValue(slot.searchValues).toLowerCase()
          return slot.label.toLowerCase().includes(term) || value.includes(term)
        })

        const label = sectionDisplayName(section, entry)
        const matchesSelf = !term || label.toLowerCase().includes(term)
        return { index, section, entry, label, visibleSlots, changed, matchesSelf, fieldCount: slots.length }
      })
      .filter(row => {
        if (changedOnly && !isSectionChanged(state, row.index)) return false
        return row.matchesSelf || row.visibleSlots.length > 0
      })
  }, [sections, library, search, changedOnly, state, oneSectionAtATime])

  // Filtered or searched, dragging would move a section relative to positions
  // that are not all on screen — so it is offered only over the whole list,
  // where what somebody sees is what they are rearranging.
  const reorderable = canManageSections && search.trim() === '' && !changedOnly

  function gap(at: number, label: string) {
    if (!canManageSections || !canInsertAt(at)) return null
    return (
      <li
        className={`tree-gap ${dropAt === at ? 'drop-active' : ''}`}
        key={`gap-${at}`}
        onDragOver={event => {
          const fromLibrary = event.dataTransfer.types.includes('application/x-cms-section')
          if (dragging.current === null && !fromLibrary) return
          event.preventDefault()
          event.dataTransfer.dropEffect = fromLibrary ? 'copy' : 'move'
          setDropAt(at)
        }}
        onDragLeave={() => setDropAt(current => (current === at ? null : current))}
        onDrop={event => {
          event.preventDefault()
          const from = dragging.current
          setDropAt(null)
          dragging.current = null
          if (from === null) {
            const sectionDefId = event.dataTransfer.getData('application/x-cms-section')
            if (sectionDefId) onDropLibrary(sectionDefId, at)
            return
          }
          // Dropping into the gap *after* the row being dragged is a no-op, and
          // dropping below it means the target index has already shifted up by
          // one now that the row has left its old place.
          const to = at > from ? at - 1 : at
          if (to !== from && canMove(from, to)) onMove(from, to)
        }}
      >
        <button type="button" aria-label={label} onClick={() => onAdd(at)}>
          <span>
            <IconPlus size={11} /> Add here
          </span>
        </button>
      </li>
    )
  }

  return (
    <aside id="editor-panel-tree" className="pane tree" data-compact={oneSectionAtATime} aria-label="Page structure">
      <div className="pane-head">
        <h2>Page structure</h2>
        {canManageSections && (
          <Button
            id="editor-add-section-end"
            variant="secondary"
            size="s"
            aria-label="Add at end"
            onClick={() => onAdd(sections.length)}
          >
            <IconPlus size={14} />
            {oneSectionAtATime ? 'Add' : 'Add at end'}
          </Button>
        )}
      </div>

      <div className="tree-tools">
        {oneSectionAtATime ? (
          <SearchField
            id="tree-search"
            label="Search this page"
            value={search}
            onChange={event => setSearch(event.target.value)}
            actions={
              <Menu label={<IconMore size={16} />} accessibleLabel="Page structure options">
                <Button
                  variant="tertiary"
                  aria-pressed={changedOnly}
                  onClick={() => setChangedOnly(current => !current)}
                >
                  Changed only
                </Button>
                <Button variant="tertiary" disabled={!openOrigin} onClick={() => setOpenOrigin(null)}>
                  Collapse all
                </Button>
              </Menu>
            }
          />
        ) : (
          <>
            <label className="sr-only" htmlFor="tree-search">
              Search this page
            </label>
            <span className="search-field">
              <IconSearch size={15} />
              <input
                id="tree-search"
                type="search"
                placeholder="Search this page"
                value={search}
                autoComplete="off"
                onChange={event => setSearch(event.target.value)}
              />
            </span>
          </>
        )}

        {/* V1's toggles in one row: collapse and expand are one button that
            says what it will do — expand while anything is folded away — so
            both fit beside "Changed only". */}
        {!oneSectionAtATime && (
          <div className="tree-disclosures">
            <button
              type="button"
              className="secondary small"
              aria-pressed={changedOnly}
              onClick={() => setChangedOnly(current => !current)}
            >
              Changed only
            </button>
            {oneSectionAtATime ? (
              <button
                type="button"
                className="secondary small"
                disabled={!openOrigin}
                onClick={() => setOpenOrigin(null)}
              >
                Collapse all
              </button>
            ) : state.sectionOrigins.some(origin => collapsed.has(origin)) ? (
              <button type="button" className="secondary small" onClick={() => setCollapsed(new Set())}>
                Expand all
              </button>
            ) : (
              <button
                type="button"
                className="secondary small"
                onClick={() => setCollapsed(new Set(state.sectionOrigins))}
              >
                Collapse all
              </button>
            )}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="empty-note">
          {sections.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 1rem' }}>
              <div className="empty-icon">
                <IconSections size={20} />
              </div>
              <p style={{ margin: '0 0 .9rem' }}>
                A section is one band across the page — a heading with a picture, a row of cards, a call to action.
              </p>
              <button type="button" onClick={() => onAdd(0)}>
                <IconPlus size={15} /> Add the first section
              </button>
            </div>
          ) : changedOnly ? (
            <p style={{ margin: 0 }}>You have not changed anything on this page yet.</p>
          ) : (
            <p style={{ margin: 0 }}>Nothing on this page matches “{search}”.</p>
          )}
        </div>
      ) : (
        <ul className="tree-list">
          {reorderable && gap(0, 'Add a section here')}
          {rows.map(row => {
            const selected = state.selection.section === row.index
            const origin = state.sectionOrigins[row.index]!
            const expanded =
              search.trim() !== '' ||
              changedOnly ||
              (oneSectionAtATime ? openOrigin === origin : !collapsed.has(origin))
            const hiddenAt = (row.section.hidden_at ?? []).map(name => BREAKPOINT_NAMES[name] ?? name)
            // A fragment rather than nesting the gap inside the row's <li>:
            // an <li> inside an <li> is not a list item, it is a parse error
            // the browser silently repairs into a different tree than the one
            // React rendered — which shows up as a hydration failure and, on a
            // good day, as a drop target in the wrong place.
            return (
              <Fragment key={origin}>
                <li className={`tree-card ${selected ? 'is-selected' : ''}`}>
                  <div
                    className={`tree-section ${row.section.hidden ? 'is-hidden' : ''} ${selected && !state.selection.slot ? 'on' : ''}`}
                    draggable={reorderable && !locked(row.index) && canInsertAt(row.index)}
                    onDragStart={event => {
                      dragging.current = row.index
                      event.dataTransfer.effectAllowed = 'move'
                      // Firefox refuses to start a drag without data on the
                      // transfer, and the payload is never read: the index is
                      // held in a ref because it belongs to this document and
                      // nothing outside it should be able to forge one.
                      event.dataTransfer.setData('text/plain', row.label)
                    }}
                    onDragEnd={() => {
                      dragging.current = null
                      setDropAt(null)
                    }}
                  >
                    {row.visibleSlots.length > 0 && (
                      <button
                        type="button"
                        className="tree-collapse"
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.label}`}
                        aria-expanded={expanded}
                        aria-controls={`tree-fields-${row.index}`}
                        disabled={search.trim() !== '' || changedOnly}
                        onClick={() => {
                          if (oneSectionAtATime) {
                            setOpenOrigin(previous => (previous === origin ? null : origin))
                            return
                          }
                          setCollapsed(previous => {
                            const next = new Set(previous)
                            if (next.has(origin)) next.delete(origin)
                            else next.add(origin)
                            return next
                          })
                        }}
                      >
                        {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="tree-label"
                      aria-label={row.label}
                      title={row.label}
                      onClick={() => {
                        if (oneSectionAtATime) setOpenOrigin(origin)
                        onSelect(row.index, null)
                      }}
                      aria-current={selected && !state.selection.slot ? 'true' : undefined}
                      onKeyDown={event => {
                        // Alt+arrow moves the section; a bare arrow is left alone
                        // so it still scrolls and still moves a screen reader's
                        // cursor the way the rest of the page does.
                        if (!canManageSections || !event.altKey || locked(row.index)) return
                        if (event.key === 'ArrowUp' && row.index > 0 && canMove(row.index, row.index - 1)) {
                          event.preventDefault()
                          onMove(row.index, row.index - 1)
                        } else if (
                          event.key === 'ArrowDown' &&
                          row.index < sections.length - 1 &&
                          canMove(row.index, row.index + 1)
                        ) {
                          event.preventDefault()
                          onMove(row.index, row.index + 1)
                        }
                      }}
                    >
                      {!oneSectionAtATime && reorderable && canInsertAt(row.index) && (
                        <IconDrag size={13} className="icon-svg tree-grip" />
                      )}
                      {isSectionChanged(state, row.index) && <span className="dot" aria-label="Changed" />}
                      <span className="tree-text">
                        <span className="tree-name">{row.label}</span>
                        {(!oneSectionAtATime || locked(row.index)) && (
                          <span className="tree-field-count">
                            {locked(row.index)
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
                          disabled={locked(row.index)}
                          onClick={() => onToggleHidden(row.index)}
                        >
                          {row.section.hidden ? 'Show section' : 'Hide section'}
                        </Button>
                        {reorderable && (
                          <>
                            <Button
                              variant="tertiary"
                              aria-label={`Move ${row.label} up`}
                              disabled={row.index === 0 || locked(row.index) || !canMove(row.index, row.index - 1)}
                              onClick={() => onMove(row.index, row.index - 1)}
                            >
                              Move up
                            </Button>
                            <Button
                              variant="tertiary"
                              aria-label={`Move ${row.label} down`}
                              disabled={
                                row.index === sections.length - 1 ||
                                locked(row.index) ||
                                !canMove(row.index, row.index + 1)
                              }
                              onClick={() => onMove(row.index, row.index + 1)}
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
                          disabled={locked(row.index)}
                          aria-pressed={row.section.hidden === true}
                          onClick={() => onToggleHidden(row.index)}
                        >
                          {row.section.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                        </button>
                        <span className="reorder" role="group" aria-label={`Move ${row.label}`}>
                          <button
                            type="button"
                            aria-label={`Move ${row.label} up`}
                            disabled={row.index === 0 || locked(row.index) || locked(row.index - 1)}
                            onClick={() => onMove(row.index, row.index - 1)}
                          >
                            <IconArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${row.label} down`}
                            disabled={row.index === sections.length - 1 || locked(row.index) || locked(row.index + 1)}
                            onClick={() => onMove(row.index, row.index + 1)}
                          >
                            <IconArrowDown size={13} />
                          </button>
                        </span>
                      </>
                    )}
                  </div>

                  {!locked(row.index) && row.visibleSlots.length > 0 && (
                    <ul id={`tree-fields-${row.index}`} className="tree-slots" hidden={!expanded}>
                      {/* An imported link is one row, named after the link, as in
                        V1 and as the inspector shows it: its words and where it
                        goes are edited together. */}
                      {inspectorFieldGroups(row.visibleSlots).map(group => {
                        const members = group.kind === 'link' ? [...group.words, group.destination] : [group.slot]
                        const target = members[0]!
                        const on = selected && members.some(slot => slot.memberIds.includes(state.selection.slot ?? ''))
                        const changed = members.some(slot =>
                          slot.memberIds.some(id => isSlotChanged(state, row.index, id)),
                        )
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
                {reorderable && gap(row.index + 1, 'Add a section here')}
              </Fragment>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

/**
 * Search the words people actually entered into a structured field. Calling
 * String on a link or image produces "[object Object]", which made their label,
 * destination, alt text and file name impossible to find from the page tree.
 * The value graph is JSON-like, but the guards keep a malformed in-memory value
 * from turning a search keystroke into an unbounded walk.
 */
function searchableValue(value: unknown): string {
  const words: string[] = []
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  let visited = 0

  while (pending.length > 0 && visited < 500) {
    visited += 1
    const current = pending.pop()
    if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
      words.push(String(current))
    } else if (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current)
      if (Array.isArray(current)) pending.push(...current)
      else pending.push(...Object.values(current as Record<string, unknown>))
    }
  }

  return words.join(' ')
}
