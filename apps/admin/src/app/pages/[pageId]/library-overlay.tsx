'use client'
// The section library as a docked working shelf. V1 proved that keeping the
// catalogue beside the page makes building feel direct; its problem was the
// ~180px width, not the idea. V2 uses the full inspector column, keeps the page
// structure and canvas visible, and retains a detailed preview before insert.
//
// WHERE THE NEW SECTION GOES, AND WHY THAT IS DECIDED BEFORE THIS OPENS
//
// Every Add control still opens with an explicit insertion point, so clicking
// Insert and all keyboard use stay deterministic. A pointer user may instead
// drag any card onto the page itself, where a red line shows the gap it will
// land in (V1 reference 10), or onto a gap in the page-structure tree. The
// canvas works the gap out from its own section boxes and the editor checks it.
//
// This is deliberately non-modal: keyboard focus may leave it for the tree or
// canvas. Esc closes it and focus returns to the control that opened it.
import styles from './library-overlay.module.css'
import { Dialog, Button } from '../../../components/ui/index.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconAlert,
  IconChevronLeft,
  IconClose,
  IconPlus,
  IconSearch,
  IconSections,
} from '../../../components/icons.tsx'
import { SectionLibraryCard } from '../../../components/section-library-card.tsx'
import { SectionThumbnail } from '../../../components/section-thumbnail.tsx'
import { SectionRequestForm } from '../../../components/section-request.tsx'
import { SectionFavourite } from '../../../components/section-favourite.tsx'
import { SectionLivePreview } from '../../../components/section-live-preview.tsx'
import type { LibraryEntry } from './editor.tsx'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import { compareSectionCategories } from '../../../lib/section-library-order.ts'

type Props = {
  siteId: string
  previewContext: SitePreviewContext
  library: LibraryEntry[]
  /** Where the chosen section will be inserted, and how to say so. */
  placement: string
  onChangePlacement?: (at: number) => void
  placementIndex?: number
  placements?: { at: number; label: string }[]
  onClose: () => void
  onChoose: (entry: LibraryEntry) => void
  onFavouriteChange?: (definitionId: string, favourite: boolean) => void
  /** Page recipes, offered as the library's second view (V1 reference 12). */
  pasteControl?: ReactNode
  recipeControl?: ReactNode
  /**
   * Replacing a layout opens the field mapping review. The draft changes only after the author
   * accepts it.
   */
  mode?: 'insert' | 'replace' | undefined
  /** The layout the section already uses, which cannot be its replacement. */
  excludeDefinitionId?: string | undefined
}

export function LibraryOverlay({
  siteId,
  previewContext,
  library: offered,
  placement,
  onClose,
  onChoose,
  onFavouriteChange,
  recipeControl,
  pasteControl,
  onChangePlacement,
  placementIndex,
  placements = [],
  mode = 'insert',
  excludeDefinitionId,
}: Props) {
  const replacing = mode === 'replace'
  const library = useMemo(
    () =>
      offered
        .filter(entry => entry.section_def_id !== excludeDefinitionId)
        .map(entry => (entry.category === 'Collections' ? { ...entry, category: 'Lists' } : entry))
        .sort(
          (a, b) =>
            compareSectionCategories(a.category || 'Other', b.category || 'Other') || a.name.localeCompare(b.name),
        ),
    [offered, excludeDefinitionId],
  )
  const [browseAll, setBrowseAll] = useState(false)
  const [choosingPlacement, setChoosingPlacement] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const keyboardReveal = useRef(false)
  const previousResultCount = useRef<number | null>(null)
  const [previewing, setPreviewing] = useState<LibraryEntry | null>(null)
  const [favouritesOnly, setFavouritesOnly] = useState(false)
  const [view, setView] = useState<'sections' | 'recipes'>('sections')
  const showingRecipes = !replacing && recipeControl !== undefined && view === 'recipes'
  const [favourites, setFavourites] = useState(
    () => new Set(library.filter(entry => entry.is_favourite).map(entry => entry.section_def_id)),
  )
  const dialog = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const scrollSurface = useRef<HTMLDivElement>(null)
  /** Whatever had focus when this opened, so it can be given back. */
  const opener = useRef<Element | null>(null)

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of library) {
      const name = entry.category || 'Other'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => compareSectionCategories(a, b))
  }, [library])

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return library.filter(entry => {
      if (category && (entry.category || 'Other') !== category) return false
      if (favouritesOnly && !favourites.has(entry.section_def_id)) return false
      if (!term) return true
      return (
        entry.name.toLowerCase().includes(term) ||
        entry.slug.toLowerCase().includes(term) ||
        (entry.category ?? '').toLowerCase().includes(term)
      )
    })
  }, [library, search, category, favouritesOnly, favourites])

  // The cursor is an index into a list that shrinks as somebody types, so it has
  // to be pulled back rather than left pointing past the end — a highlighted
  // card that is not on screen is a keyboard user pressing Enter and getting
  // whatever used to be there.
  const active = Math.min(cursor, Math.max(0, shown.length - 1))

  useEffect(() => {
    opener.current = document.activeElement
    searchInput.current?.focus()
    const restore = opener.current
    return () => {
      // Focus goes back where it came from, synchronously.
      //
      // Deferring it to a microtask looks safer and is not: React's development
      // double-invoke runs mount → cleanup → mount, so a deferred restore
      // landed *after* the second mount had focused the search box and left
      // the opener focused inside an open dialog. The dialog's DOM is still
      // present when a cleanup runs, so there is nothing to wait for.
      if (restore instanceof HTMLElement && document.contains(restore)) restore.focus()
    }
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        if (previewing) setPreviewing(null)
        else onClose()
        return
      }

      if (previewing || showingRecipes) return
      if (!dialog.current?.contains(event.target as Node)) return
      // Request fields are ordinary form controls, not the catalogue's search
      // box. Enter must submit the request and arrows must move its text caret.
      if (event.target instanceof Element && event.target.closest('.section-request-form')) return
      if (
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLInputElement && event.target.type === 'checkbox')
      )
        return

      // Arrow keys move a highlight through the cards from anywhere in the
      // dialog, including from the search box, so somebody can type two letters
      // and press Down without first having to work out how to leave the field.
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowLeft'
      ) {
        if (shown.length === 0) return
        keyboardReveal.current = true
        const columns = columnCount(grid.current)
        const step =
          event.key === 'ArrowRight'
            ? 1
            : event.key === 'ArrowLeft'
              ? -1
              : event.key === 'ArrowDown'
                ? columns
                : -columns
        event.preventDefault()
        setCursor(current => {
          const next = Math.min(shown.length - 1, Math.max(0, Math.min(current, shown.length - 1) + step))
          return next
        })
        return
      }

      // Enter adds the highlighted section — but only from somewhere that is
      // not itself an activatable control. Enter on the Close button has to
      // close, and Enter on a card has to add *that* card; taking the key over
      // everywhere would make both of those do something else.
      if (event.key === 'Enter') {
        const focused = document.activeElement
        if (focused instanceof HTMLButtonElement || focused instanceof HTMLAnchorElement) return
        const entry = shown[active]
        if (entry) {
          event.preventDefault()
          onChoose(entry)
        }
        return
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose, onChoose, shown, active, previewing, showingRecipes])

  // Keyboard/filter navigation reveals the highlighted card while keeping
  // search focus. Hover must never move the button under the pointer.
  useEffect(() => {
    const initial = previousResultCount.current === null
    const reveal = keyboardReveal.current || previousResultCount.current !== shown.length
    keyboardReveal.current = false
    previousResultCount.current = shown.length
    if (initial || !reveal) return
    if (!shown.length) {
      grid.current?.scrollIntoView({ block: 'start' })
      return
    }
    grid.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, shown.length])

  useEffect(() => {
    if (choosingPlacement) scrollSurface.current?.scrollTo({ top: 0 })
  }, [choosingPlacement])

  const shelf = (
    <aside
      id="editor-panel-library"
      className={`pane library-drawer ${styles.shelf} ${browseAll ? styles.expanded : ''}`}
      ref={dialog}
      role="dialog"
      aria-modal="false"
      aria-labelledby="library-title"
    >
      {/* Where the section will land is the heading, not a footnote: it is the
            thing the canvas insertion line used to say and the overlay covers
            the canvas. */}
      <div className="overlay-head">
        <h2 id="library-title">
          {replacing ? 'Change layout' : showingRecipes ? 'Add a page template' : 'Add a section'}{' '}
          <span className="where">
            {replacing ? placement : `Adding ${placement}`} ·{' '}
            {!replacing && onChangePlacement && (
              <button
                type="button"
                className="link"
                aria-expanded={choosingPlacement}
                onClick={() => setChoosingPlacement(current => !current)}
              >
                Change
              </button>
            )}
          </span>
        </h2>
        <button
          type="button"
          className="icon-btn tip tip-right"
          data-tip="Close (Esc)"
          aria-label="Close"
          onClick={onClose}
        >
          <IconClose size={18} />
        </button>
      </div>

      <div className={styles.browser} ref={scrollSurface}>
        {!replacing && choosingPlacement && onChangePlacement && (
          <div className={styles.destination}>
            <label htmlFor="section-destination">Add section</label>
            <select
              id="section-destination"
              aria-label="Section destination"
              value={placementIndex}
              onChange={event => onChangePlacement(Number(event.target.value))}
            >
              {placements.map(place => (
                <option key={place.at} value={place.at}>
                  {place.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {!replacing && pasteControl}
        {!browseAll && (
          <Button variant="secondary" onClick={() => setBrowseAll(true)}>
            Browse all
          </Button>
        )}
        {/* V1 offered its catalogue and its page templates side by side in the
            docked library; so does this, with the recipes as cards. */}
        {!replacing && recipeControl !== undefined && (
          <div className="group library-views" role="group" aria-label="Show in the library">
            <button type="button" aria-pressed={view === 'sections'} onClick={() => setView('sections')}>
              Sections
            </button>
            <button type="button" aria-pressed={view === 'recipes'} onClick={() => setView('recipes')}>
              Page templates
            </button>
          </div>
        )}
        {showingRecipes ? (
          recipeControl
        ) : (
          <>
            {!replacing && <p className="library-drag-hint">Drag a card onto the page to place it, or choose Add.</p>}
            <div className="overlay-controls">
              <label className="sr-only" htmlFor="library-search">
                Search sections
              </label>
              <span className="search-field">
                <IconSearch size={15} />
                <input
                  id="library-search"
                  ref={searchInput}
                  type="search"
                  placeholder="Search sections"
                  value={search}
                  autoComplete="off"
                  onChange={event => {
                    setSearch(event.target.value)
                    setCursor(0)
                  }}
                />
              </span>
              <span className="overlay-count" aria-live="polite">
                {shown.length === library.length
                  ? `${library.length} ${library.length === 1 ? 'section' : 'sections'}`
                  : `${shown.length} of ${library.length}`}
              </span>
              <span className="overlay-keyhint">
                <kbd>↑</kbd>
                <kbd>↓</kbd> to look through them, <kbd>Enter</kbd> to {replacing ? 'review one' : 'add one'}
              </span>
            </div>

            <div className="overlay-body">
              <nav className="overlay-categories" aria-label="Categories">
                <p className="eyebrow">Categories</p>
                <button
                  type="button"
                  aria-pressed={category === null && !favouritesOnly}
                  onClick={() => {
                    setCategory(null)
                    setFavouritesOnly(false)
                    setCursor(0)
                  }}
                >
                  <span>All</span> <span className="tally">{library.length}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={favouritesOnly}
                  onClick={() => {
                    setFavouritesOnly(!favouritesOnly)
                    setCursor(0)
                  }}
                >
                  <span>
                    <span aria-hidden="true">★</span> Favourites
                  </span>{' '}
                  <span className="tally">{favourites.size}</span>
                </button>
                {categories.map(([name, count]) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={category === name}
                    onClick={() => {
                      setCategory(name)
                      setCursor(0)
                    }}
                  >
                    <span>{name}</span> <span className="tally">{count}</span>
                  </button>
                ))}
              </nav>

              {/* No `role="list"` here and no `role="listitem"` on the cards. A
              <button> given a listitem role stops being a button to assistive
              technology — it keeps looking activatable and stops announcing that
              it is — and the group is already named by the dialog it is in. */}
              <div className="overlay-grid" ref={grid}>
                {shown.length === 0 ? (
                  <div className="empty-state overlay-empty">
                    <div className="empty-icon">
                      <IconSections size={22} />
                    </div>
                    {favouritesOnly && !search.trim() && !category ? (
                      <>
                        <h3>No favourites yet</h3>
                        <p>Star a section to keep it here, on this site, for next time.</p>
                      </>
                    ) : (
                      <>
                        <h3>{search.trim() ? <>Nothing matches “{search}”</> : 'Nothing in this view'}</h3>
                        <p>
                          Sections are made by a site owner. If the one you need is not here, ask for it — or clear the
                          search to see everything.
                        </p>
                      </>
                    )}
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setSearch('')
                          setCategory(null)
                          setFavouritesOnly(false)
                        }}
                      >
                        Show everything
                      </button>
                    </div>
                  </div>
                ) : (
                  shown.map((entry, index) => (
                    <SectionLibraryCard
                      key={entry.section_def_id}
                      entry={entry}
                      draggable={!replacing}
                      data-active={index === active}
                      data-testid={`library-card-${entry.slug}`}
                      onDragStart={event => {
                        if (replacing) {
                          event.preventDefault()
                          return
                        }
                        event.dataTransfer.effectAllowed = 'copy'
                        event.dataTransfer.setData('application/x-cms-section', entry.section_def_id)
                        event.dataTransfer.setData('text/plain', entry.name)
                      }}
                      onMouseEnter={() => setCursor(index)}
                      thumbnail={
                        <button
                          type="button"
                          className="section-card-preview"
                          aria-label={`Preview ${entry.name}`}
                          onClick={event => {
                            event.currentTarget.focus()
                            setPreviewing(entry)
                          }}
                        >
                          <SectionThumbnail entry={entry} element="span" eager />
                        </button>
                      }
                      favourite={
                        <SectionFavourite
                          key={`${entry.section_def_id}-${favourites.has(entry.section_def_id)}`}
                          siteId={siteId}
                          compact
                          definitionId={entry.section_def_id}
                          name={entry.name}
                          initial={favourites.has(entry.section_def_id)}
                          onChange={value => {
                            setFavourites(previous => {
                              const next = new Set(previous)
                              if (value) next.add(entry.section_def_id)
                              else next.delete(entry.section_def_id)
                              return next
                            })
                            onFavouriteChange?.(entry.section_def_id, value)
                          }}
                        />
                      }
                      usage={
                        entry.used_on_pages > 0 ? (
                          <span className="section-card-meta">
                            Used on {entry.used_on_pages} {entry.used_on_pages === 1 ? 'page' : 'pages'}
                          </span>
                        ) : undefined
                      }
                      actions={
                        <>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={event => {
                              event.currentTarget.focus()
                              setPreviewing(entry)
                            }}
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            className="small"
                            onClick={() => onChoose(entry)}
                            aria-label={replacing ? `Use ${entry.name} layout` : `Add ${entry.name} ${placement}`}
                          >
                            {replacing ? (
                              'Use layout'
                            ) : (
                              <>
                                <IconPlus size={13} /> Add
                              </>
                            )}
                          </button>
                        </>
                      }
                    />
                  ))
                )}
                <div className={styles.request}>
                  <button type="button" className="link" onClick={() => setRequestOpen(!requestOpen)}>
                    Request a section
                  </button>
                  {requestOpen && <SectionRequestForm siteId={siteId} preserveEditor />}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {previewing && (
        <LibraryPreviewDialog
          entry={previewing}
          siteId={siteId}
          previewContext={previewContext}
          placement={placement}
          replacing={replacing}
          onBack={() => setPreviewing(null)}
          onChoose={() => onChoose(previewing)}
        />
      )}
    </aside>
  )
  return browseAll ? (
    <Dialog size="wide" title="Browse all sections" onClose={() => setBrowseAll(false)}>
      {shelf}
    </Dialog>
  ) : (
    shelf
  )
}

/**
 * A section at full width before it is added (V1 reference 11). The page
 * behind is dimmed; the section is shown at desktop, tablet or phone width in
 * the site's chosen appearance, with the fields an editor will be able to fill
 * in. It used to replace the shelf's own list inside its narrow column, where a
 * 1200px band could not be seen. Esc or Back returns to the list, focused where
 * it was.
 */
function LibraryPreviewDialog({
  entry,
  siteId,
  previewContext,
  placement,
  replacing,
  onBack,
  onChoose,
}: {
  entry: LibraryEntry
  siteId: string
  previewContext: SitePreviewContext
  placement: string
  replacing: boolean
  onBack: () => void
  onChoose: () => void
}) {
  const [previewReady, setPreviewReady] = useState(false)
  const box = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const opener = document.activeElement,
      dialog = box.current
    if (dialog && !dialog.open) dialog.showModal()
    back.current?.focus()
    return () => {
      dialog?.close()
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])
  return (
    <dialog
      ref={box}
      className="section-preview-dialog library-preview-dialog"
      aria-labelledby="library-preview-title"
      onCancel={event => {
        event.preventDefault()
        onBack()
      }}
    >
      <div className="section-preview-dialog-head">
        <div>
          <h3 id="library-preview-title">{entry.name}</h3>
          <p className="muted">
            {entry.category || 'Other'} · {entry.scope === 'site' ? 'This site only' : 'Shared across sites'}
          </p>
        </div>
        <button ref={back} type="button" className="secondary small" onClick={onBack}>
          <IconChevronLeft size={14} /> Back to sections
        </button>
      </div>
      <SectionLivePreview
        onReady={setPreviewReady}
        previewContext={previewContext}
        siteId={siteId}
        definitionId={entry.section_def_id}
        name={entry.name}
      />
      <div className="library-preview-foot">
        <div>
          {entry.slots.length === 0 ? (
            <p>This section has no page-specific fields.</p>
          ) : (
            <p className="library-preview-fields">
              <span>You can edit</span>
              {entry.slots.map(slot => (
                <span className="chip chip-neutral" key={slot.id}>
                  {slot.label}
                </span>
              ))}
            </p>
          )}
          <p className="hint">
            {entry.used_on_pages === 0
              ? 'It is not used on another page yet.'
              : `It is already used on ${entry.used_on_pages} ${entry.used_on_pages === 1 ? 'page' : 'pages'}.`}
          </p>
          {entry.carries_trusted_code && (
            <p className="section-card-warn">
              <IconAlert size={13} />
              Contains custom code — needs approval before the page goes live
            </p>
          )}
        </div>
        <button type="button" disabled={!previewReady} onClick={onChoose}>
          {replacing ? (
            <>Review this layout</>
          ) : (
            <>
              <IconPlus size={15} /> Add here {placement}
            </>
          )}
        </button>
      </div>
    </dialog>
  )
}

/**
 * How many cards are on a row right now, read off the grid rather than assumed.
 *
 * Arrow-down has to move by one row, and the row length is whatever the CSS
 * `auto-fill` produced at this window width. Hard-coding it would make the
 * keyboard and the eye disagree at every size but one.
 */
function columnCount(node: HTMLElement | null): number {
  if (!node) return 1
  const columns = getComputedStyle(node).gridTemplateColumns
  const measured = columns.split(' ').filter(part => part.trim() !== '').length
  return Math.max(1, measured)
}
