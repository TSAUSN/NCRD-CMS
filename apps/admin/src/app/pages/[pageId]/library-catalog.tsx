import type { MouseEvent, RefObject } from 'react'
import { IconPlus, IconSearch, IconSections } from '../../../components/icons.tsx'
import { SectionLibraryCard } from '../../../components/section-library-card.tsx'
import { SectionThumbnail } from '../../../components/section-thumbnail.tsx'
import { SectionRequestForm } from '../../../components/section-request.tsx'
import { SectionFavourite } from '../../../components/section-favourite.tsx'
import type { LibraryEntry } from './editor.tsx'
import styles from './library-overlay.module.css'

type CatalogProps = {
  siteId: string
  placement: string
  replacing: boolean
  searchInput: RefObject<HTMLInputElement | null>
  grid: RefObject<HTMLDivElement | null>
  search: string
  setSearch: (value: string) => void
  shown: LibraryEntry[]
  library: LibraryEntry[]
  category: string | null
  setCategory: (value: string | null) => void
  categories: [string, number][]
  favouritesOnly: boolean
  setFavouritesOnly: (value: boolean) => void
  favourites: Set<string>
  onSetFavourite: (id: string, value: boolean) => void
  setCursor: (index: number) => void
  active: number
  setPreviewing: (entry: LibraryEntry) => void
  onChoose: (entry: LibraryEntry) => void
  requestOpen: boolean
  toggleRequest: () => void
}

export function LibraryCatalog({
  siteId,
  placement,
  replacing,
  searchInput,
  grid,
  search,
  setSearch,
  shown,
  library,
  category,
  setCategory,
  categories,
  favouritesOnly,
  setFavouritesOnly,
  favourites,
  onSetFavourite,
  setCursor,
  active,
  setPreviewing,
  onChoose,
  requestOpen,
  toggleRequest,
}: CatalogProps) {
  function previewEntry(event: MouseEvent<HTMLButtonElement>, entry: LibraryEntry) {
    event.currentTarget.focus()
    setPreviewing(entry)
  }

  return (
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
                    Sections are made by a site owner. If the one you need is not here, ask for it — or clear the search
                    to see everything.
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
                    onClick={event => previewEntry(event, entry)}
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
                    onChange={value => onSetFavourite(entry.section_def_id, value)}
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
                    <button type="button" className="secondary small" onClick={event => previewEntry(event, entry)}>
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
            <button type="button" className="link" onClick={() => toggleRequest()}>
              Request a section
            </button>
            {requestOpen && <SectionRequestForm siteId={siteId} preserveEditor />}
          </div>
        </div>
      </div>
    </>
  )
}
