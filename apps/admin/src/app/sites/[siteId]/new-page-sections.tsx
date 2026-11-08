import {
  IconAlert,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconPage,
  IconPlus,
  IconSearch,
  IconTrash,
} from '../../../components/icons.tsx'
import { SectionThumbnail } from '../../../components/section-thumbnail.tsx'
import { MAX_STARTER_SECTIONS, type PageStartingPoint } from './new-page-draft.ts'
import ownedStyles from './new-page-styles.module.css'

export function NewPageSectionPicker({ start }: { start: PageStartingPoint }) {
  const { mode, search, setSearch, category, setCategory, categories, library, shown, selectedIds, toggleSection } =
    start
  return (
    <details className={ownedStyles.plannerDisclosure} open={mode === 'custom'}>
      <summary>Choose and arrange starting sections</summary>
      <div className="creator-library">
        <div className="creator-library-tools">
          <label className="search-field" htmlFor="creator-section-search">
            <IconSearch size={15} />
            <span className="sr-only">Search sections</span>
            <input
              id="creator-section-search"
              type="search"
              placeholder="Search sections"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </label>
          <span className="hint">Choose up to {MAX_STARTER_SECTIONS}</span>
        </div>
        <div className="creator-category-row" aria-label="Filter sections by category">
          <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}>
            All <span>{library.length}</span>
          </button>
          {categories.map(([name, count]) => (
            <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>
              {name} <span>{count}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="creator-blank">
            <IconSearch size={22} />
            <div>
              <strong>No matching sections</strong>
              <p>Clear the search or choose another category.</p>
            </div>
          </div>
        ) : (
          <div className="creator-section-grid">
            {shown.map(entry => {
              const added = selectedIds.includes(entry.section_def_id)
              return (
                <button
                  key={entry.section_def_id}
                  type="button"
                  className={added ? 'added' : ''}
                  aria-pressed={added}
                  onClick={() => toggleSection(entry.section_def_id)}
                >
                  <SectionThumbnail entry={entry} element="span" eager />
                  <span className="creator-section-copy">
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.category || 'Other'} · {entry.slots.length} editable{' '}
                      {entry.slots.length === 1 ? 'field' : 'fields'}
                    </small>
                  </span>
                  <span className="creator-section-action">
                    {added ? (
                      <>
                        <IconCheck size={14} /> Added
                      </>
                    ) : (
                      <>
                        <IconPlus size={14} /> Add
                      </>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {selectedIds.length >= MAX_STARTER_SECTIONS && (
          <p className="notice notice-warn">
            <IconAlert size={15} /> Start with at most {MAX_STARTER_SECTIONS} sections; you can add more in the editor.
          </p>
        )}
      </div>
    </details>
  )
}

export function NewPageOutline({ start }: { start: PageStartingPoint }) {
  const { mode, selected, moveSection, toggleSection } = start
  return (
    <details className={ownedStyles.plannerDisclosure} open={mode === 'custom'}>
      <summary>Starting structure</summary>
      <aside className={'page-outline ' + ownedStyles.plannerAside} aria-labelledby="page-outline-title">
        <div className="page-outline-head">
          <div>
            <p className="eyebrow">Starting structure</p>
            <h3 id="page-outline-title">Page outline</h3>
          </div>
          <span className="tally">{selected.length}</span>
        </div>
        {selected.length === 0 ? (
          <div className="page-outline-empty">
            <IconPage size={22} />
            <p>A Page header will keep your title visible. You can add more sections in the editor.</p>
          </div>
        ) : (
          <ol>
            {selected.map((entry, index) => (
              <li key={entry.section_def_id}>
                <span className="outline-index">{index + 1}</span>
                <span className="outline-name">
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.startsHidden ? 'Starts hidden · ' : ''}
                    {entry.category || 'Other'}
                  </small>
                </span>
                <span className="outline-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={index === 0}
                    aria-label={`Move ${entry.name} up`}
                    onClick={() => moveSection(index, -1)}
                  >
                    <IconArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={index === selected.length - 1}
                    aria-label={`Move ${entry.name} down`}
                    onClick={() => moveSection(index, 1)}
                  >
                    <IconArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger-quiet"
                    aria-label={`Remove ${entry.name}`}
                    onClick={() => toggleSection(entry.section_def_id)}
                  >
                    <IconTrash size={14} />
                  </button>
                </span>
                {entry.carries_trusted_code && (
                  <span className="outline-warning">
                    <IconAlert size={12} /> approval required
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="page-outline-note">
          <IconCheck size={15} />
          <p>The page starts as a draft. Creating it does not change the live site.</p>
        </div>
      </aside>
    </details>
  )
}
