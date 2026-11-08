'use client'
import styles from './library-overlay.module.css'
import { Dialog, Button } from '../../../components/ui/index.ts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconClose } from '../../../components/icons.tsx'
import { LibraryCatalog } from './library-catalog.tsx'
import { LibraryPreviewDialog } from './library-preview-dialog.tsx'

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

  const active = Math.min(cursor, Math.max(0, shown.length - 1))

  useEffect(() => {
    opener.current = document.activeElement
    searchInput.current?.focus()
    const restore = opener.current
    return () => {
      // Restore focus before a new mount can move it again.
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
      if (event.target instanceof Element && event.target.closest('.section-request-form')) return
      if (
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLInputElement && event.target.type === 'checkbox')
      )
        return

      // Let the search field keep focus while its highlighted result moves.
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

      // Preserve the native Enter action on a focused control.
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

  function setFavourite(id: string, value: boolean) {
    setFavourites(previous => {
      const next = new Set(previous)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
    onFavouriteChange?.(id, value)
  }

  const shelf = (
    <aside
      id="editor-panel-library"
      className={`pane library-drawer ${styles.shelf} ${browseAll ? styles.expanded : ''}`}
      ref={dialog}
      role="dialog"
      aria-modal="false"
      aria-labelledby="library-title"
    >
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
          <LibraryCatalog
            siteId={siteId}
            placement={placement}
            replacing={replacing}
            searchInput={searchInput}
            grid={grid}
            search={search}
            setSearch={setSearch}
            shown={shown}
            library={library}
            category={category}
            setCategory={setCategory}
            categories={categories}
            favouritesOnly={favouritesOnly}
            setFavouritesOnly={setFavouritesOnly}
            favourites={favourites}
            onSetFavourite={setFavourite}
            setCursor={setCursor}
            active={active}
            setPreviewing={setPreviewing}
            onChoose={onChoose}
            requestOpen={requestOpen}
            toggleRequest={() => setRequestOpen(value => !value)}
          />
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
function columnCount(node: HTMLElement | null): number {
  if (!node) return 1
  const columns = getComputedStyle(node).gridTemplateColumns
  const measured = columns.split(' ').filter(part => part.trim() !== '').length
  return Math.max(1, measured)
}
