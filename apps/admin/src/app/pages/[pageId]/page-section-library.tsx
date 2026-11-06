'use client'
import { useState, type ReactNode } from 'react'
import type { LibraryEntry } from './editor.tsx'
import { Button, Field, EmptyState, ActionNote } from '../../../components/ui/index.ts'
import { SectionLibraryCard } from '../../../components/section-library-card.tsx'
import { SectionFavourite } from '../../../components/section-favourite.tsx'
import { SectionThumbnail } from '../../../components/section-thumbnail.tsx'
import { matchesSectionSearch, symphonySectionNames } from '../../../lib/section-library-search.ts'
import shared from '../../../components/workspace.module.css'
import styles from './library-overlay.module.css'
export function PageSectionLibrary({
  siteId,
  onFavouriteChange,
  library,
  placement,
  at,
  placements,
  preview,
  preparing,
  ready,
  error,
  onPreview,
  onAdd,
  onClose,
  onChangeSpot,
  onMove,
  pasteControl,
  recipeControl,
}: {
  siteId: string
  onFavouriteChange: (id: string, value: boolean) => void
  library: LibraryEntry[]
  placement: string
  at: number
  placements: { at: number; label: string }[]
  preview: LibraryEntry | null
  preparing: boolean
  ready: boolean
  error: string
  onPreview: (entry: LibraryEntry | null) => void
  onAdd: () => void
  onClose: () => void
  onChangeSpot: () => void
  onMove: (at: number) => void
  pasteControl?: ReactNode
  recipeControl?: ReactNode
}) {
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [view, setView] = useState<'sections' | 'templates'>('sections')
  const categories = [...new Set(library.map(entry => entry.category || 'Other'))],
    shown = library.filter(
      entry =>
        (!category || (category === '__favourites' ? entry.is_favourite : (entry.category || 'Other') === category)) &&
        matchesSectionSearch(entry, search),
    ),
    previous = [...placements].filter(p => p.at < at).sort((a, b) => b.at - a.at)[0],
    next = [...placements].filter(p => p.at > at).sort((a, b) => a.at - b.at)[0]
  // Explicit tab stops keep these controls reachable with Safari's default
  // keyboard navigation as well as with full keyboard access enabled.
  return (
    <aside
      id="editor-panel-library"
      data-compact="true"
      className={'pane library-drawer ' + styles.shelf}
      role="dialog"
      aria-modal="false"
      aria-label="Add a section"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className={styles.destination}>
        <div className={shared.panelActions}>
          <Button
            tabIndex={0}
            variant="tertiary"
            disabled={preparing}
            onClick={() => (preview ? onPreview(null) : onClose())}
          >
            {preview ? 'Back to sections' : 'Back'}
          </Button>
        </div>
      </div>
      <div className={styles.browser}>
        <div className={styles.destination + ' ' + shared.formStack}>
          <h2>Add a section</h2>
          <p>
            Adding <strong>{placement}</strong>{' '}
            <Button tabIndex={0} variant="tertiary" disabled={preparing} onClick={onChangeSpot}>
              Change spot
            </Button>
          </p>

          {error && !preview && <p role="alert">{error}</p>}
          <>
            <Field id="page-section-search" label="Search sections">
              <input
                type="search"
                autoFocus
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search sections"
              />
            </Field>
            <Field id="page-section-category" label="Category">
              <select value={category} onChange={event => setCategory(event.target.value)}>
                <option value="">All sections</option>
                <option value="__favourites">Favourites</option>
                {categories.map(name => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
            {!preview && <p className={shared.meta}>Choose one to see it on the page.</p>}
            {recipeControl && (
              <div className={shared.actions}>
                <Button
                  tabIndex={0}
                  variant="tertiary"
                  onClick={() => setView('sections')}
                  aria-pressed={view === 'sections'}
                >
                  Sections
                </Button>
                <Button
                  tabIndex={0}
                  variant="tertiary"
                  onClick={() => setView('templates')}
                  aria-pressed={view === 'templates'}
                >
                  Page templates
                </Button>
              </div>
            )}
          </>
        </div>
        {view === 'templates' ? (
          recipeControl
        ) : (
          <div className="overlay-grid">
            {shown.length ? (
              shown.map(entry => (
                <SectionLibraryCard
                  density="compact"
                  key={entry.section_def_id}
                  entry={entry}
                  aria-current={preview?.section_def_id === entry.section_def_id ? true : undefined}
                  favourite={
                    <SectionFavourite
                      key={entry.section_def_id + '-' + entry.is_favourite}
                      siteId={siteId}
                      compact
                      definitionId={entry.section_def_id}
                      name={entry.name}
                      initial={entry.is_favourite}
                      onChange={value => onFavouriteChange(entry.section_def_id, value)}
                    />
                  }
                  data-testid={'library-card-' + entry.slug}
                  draggable={!preparing}
                  onDragStart={event => {
                    if (preparing) {
                      event.preventDefault()
                      return
                    }
                    event.dataTransfer.effectAllowed = 'copy'
                    event.dataTransfer.setData('application/x-cms-section', entry.section_def_id)
                    event.dataTransfer.setData('text/plain', entry.name)
                  }}
                  thumbnail={
                    <button
                      tabIndex={0}
                      type="button"
                      className="section-card-preview"
                      aria-label={'Preview ' + entry.name}
                      disabled={preparing}
                      onClick={() => onPreview(entry)}
                    >
                      <SectionThumbnail
                        entry={entry.slug.startsWith('core-') ? { ...entry, thumbnail_path: null } : entry}
                        element="span"
                        eager
                      />
                    </button>
                  }
                  usage={
                    symphonySectionNames(entry.slug).length ? (
                      <span className="section-card-meta">
                        In Symphony: {symphonySectionNames(entry.slug).join(', ')}
                      </span>
                    ) : undefined
                  }
                  actions={
                    <Button
                      tabIndex={0}
                      variant="secondary"
                      disabled={preparing}
                      onClick={() => onPreview(entry)}
                      aria-label={'Add ' + entry.name + ' ' + placement}
                    >
                      Choose
                    </Button>
                  }
                />
              ))
            ) : (
              <EmptyState title="No sections match">Change the search or choose All sections.</EmptyState>
            )}
          </div>
        )}
        {!preview && pasteControl && <div className={styles.destination + ' ' + shared.formStack}>{pasteControl}</div>}
      </div>
      {preview && view === 'sections' && (
        <div className={shared.detailPanelFooter}>
          <ActionNote>Showing {preview.name} on the page with sample text. You replace it after adding.</ActionNote>
          {!ready && !error && (
            <p role="status">{preparing ? 'Preparing the section preview…' : 'Opening the section on the page…'}</p>
          )}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button tabIndex={0} variant="secondary" disabled={preparing} onClick={() => onPreview(preview)}>
                Try again
              </Button>
            </div>
          )}
          <div className={shared.actions}>
            <Button
              tabIndex={0}
              variant="secondary"
              disabled={preparing || !previous}
              onClick={() => previous && onMove(previous.at)}
            >
              Move up
            </Button>
            <Button
              tabIndex={0}
              variant="secondary"
              disabled={preparing || !next}
              onClick={() => next && onMove(next.at)}
            >
              Move down
            </Button>
            <Button tabIndex={0} disabled={preparing || !ready || Boolean(error)} onClick={onAdd}>
              Add this section
            </Button>
          </div>
        </div>
      )}
    </aside>
  )
}
