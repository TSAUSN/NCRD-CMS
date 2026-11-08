'use client'
import { useReorderableList } from '../../../components/ui/use-reorderable-list.ts'
import { ReorderAnnouncement } from '../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../components/ui/reorderable-list.module.css'
import { Button, Menu, SearchField } from '../../../components/ui/index.ts'
import { editorContentSlots } from '../../../lib/editor-content-slots.ts'
import { structureFields } from '../../../lib/structure-fields.ts'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { repeatItemSpec } from '@cms/schema'
import { changedSlots, isSectionChanged, type EditorState } from '@cms/domain'
import { IconMore, IconPlus, IconSearch, IconSections } from '../../../components/icons.tsx'
import type { LibraryEntry } from './editor.tsx'
import { sectionDisplayName } from '../../../lib/section-display-name.ts'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import { StructureSectionRow, structureSectionKey } from './structure-section-row.tsx'
import { StructureInsertionTarget, structureGapKey } from './structure-insertion-target.tsx'

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
        return { index, section, label, visibleSlots, matchesSelf, fieldCount: slots.length }
      })
      .filter(row => {
        if (changedOnly && !isSectionChanged(state, row.index)) return false
        return row.matchesSelf || row.visibleSlots.length > 0
      })
  }, [sections, library, search, changedOnly, state, oneSectionAtATime])

  // Filtered or searched, dragging would move a section relative to positions
  // that are not all on screen — so it is offered only over the whole list,
  // where what somebody sees is what they are rearranging.
  const filterActive = search.trim() !== '' || changedOnly
  const reorderable = canManageSections && !filterActive

  const origins = state.sectionOrigins
  function moveLabel(from: number, to: number) {
    const name = rows.find(row => row.index === from)?.label ?? 'section'
    onMove(from, to)
    return `Moved ${name} to position ${to + 1}.`
  }
  const reorder = useReorderableList<{ from: number; to: number }>({
    mimeType: 'application/x-cms-section-order',
    decide: ({ from: source, over, edge }) => {
      const from = origins.findIndex(origin => structureSectionKey(origin) === source)
      const target = origins.findIndex(origin => structureSectionKey(origin) === over)
      const at = over.startsWith('gap:') ? Number(over.slice(4)) : target + (edge === 'after' ? 1 : 0)
      const to = at - (from < at ? 1 : 0)
      if (from < 0 || at < 0 || at > sections.length || (target < 0 && !over.startsWith('gap:')))
        return { status: 'blocked', message: 'The page structure changed. Try moving the section again.' }
      if (from === to) return { status: 'unchanged' }
      if (locked(from) || !canInsertAt(at) || !canMove(from, to))
        return {
          status: 'blocked',
          message: 'Keep shared sections in place. Move this section within the part you can edit.',
        }
      return { status: 'move', marker: { row: structureGapKey(at), edge: 'before' }, move: { from, to } }
    },
    apply: ({ from, to }) => moveLabel(from, to),
  })
  function moveByKeyboard(from: number, to: number) {
    reorder.announce(moveLabel(from, to))
  }

  function gap(at: number, label: string) {
    return canManageSections && canInsertAt(at) ? (
      <StructureInsertionTarget
        at={at}
        label={label}
        reorder={reorder}
        dropAt={dropAt}
        setDropAt={setDropAt}
        onAdd={onAdd}
        onDropLibrary={onDropLibrary}
      />
    ) : null
  }

  function toggleExpanded(origin: string) {
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
        <ul className={'tree-list ' + reorderStyles.list} data-reorder-list>
          {reorderable && gap(0, 'Add a section here')}
          {rows.map(row => {
            const origin = state.sectionOrigins[row.index]!
            const expanded = filterActive || (oneSectionAtATime ? openOrigin === origin : !collapsed.has(origin))
            return (
              <Fragment key={origin}>
                <StructureSectionRow
                  row={row}
                  origin={origin}
                  state={state}
                  sectionCount={sections.length}
                  expanded={expanded}
                  filterActive={filterActive}
                  oneSectionAtATime={oneSectionAtATime}
                  canManageSections={canManageSections}
                  reorderable={reorderable}
                  reorder={reorder}
                  locked={locked}
                  canInsertAt={canInsertAt}
                  canMove={canMove}
                  moveByKeyboard={moveByKeyboard}
                  toggleExpanded={() => toggleExpanded(origin)}
                  selectSection={() => {
                    if (oneSectionAtATime) setOpenOrigin(origin)
                    onSelect(row.index, null)
                  }}
                  onSelect={onSelect}
                  onToggleHidden={onToggleHidden}
                />
                {reorderable && gap(row.index + 1, 'Add a section here')}
              </Fragment>
            )
          })}
        </ul>
      )}
      <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
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
