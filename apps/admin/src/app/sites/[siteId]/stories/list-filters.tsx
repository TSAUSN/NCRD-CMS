import type { RefObject } from 'react'
import type { StoryListFilters as Filters } from '../../../../lib/story-list.ts'
import type { StoryListSnapshot } from './list-draft.ts'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import ownedStyles from './list-workspace-styles.module.css'

export function StoryListFilters({
  search,
  filters,
  setFilters,
  settings,
  visibleCount,
  totalCount,
}: {
  search: RefObject<HTMLInputElement | null>
  filters: Filters
  setFilters: (filters: Filters) => void
  settings: StoryListSnapshot['settings']
  visibleCount: number
  totalCount: number
}) {
  return (
    <div className={workspaceFormsStyles.filters + ' ' + ownedStyles.listFilters} aria-label="Filter stories">
      <label className={selectionControlsStyles.visuallyHidden} htmlFor="story-search">
        Search titles and descriptions
      </label>
      <input
        ref={search}
        id="story-search"
        type="search"
        value={filters.q}
        maxLength={120}
        placeholder="Search titles and descriptions"
        onChange={event => setFilters({ ...filters, q: event.target.value })}
      />
      <label className={selectionControlsStyles.visuallyHidden} htmlFor="story-status">
        Story status
      </label>
      <select
        id="story-status"
        value={filters.status}
        onChange={event => setFilters({ ...filters, status: event.target.value as Filters['status'] })}
      >
        {[
          ['all', 'All stories'],
          ['review', 'Needs review'],
          [
            'untagged',
            settings.mainLabel === 'Project Sectors' && settings.secondaryLabel === 'Regions'
              ? 'Missing sector or region'
              : 'Missing tags',
          ],
          ['live', 'Live'],
          ['hidden', 'Hidden'],
          ['removed', 'No longer in feed'],
        ].map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label className={selectionControlsStyles.visuallyHidden} htmlFor="story-main">
        {settings.mainLabel}
      </label>
      <select
        id="story-main"
        value={filters.main}
        onChange={event => setFilters({ ...filters, main: event.target.value })}
      >
        <option value="">
          {settings.mainLabel === 'Project Sectors' ? 'All project sectors' : 'All ' + settings.mainLabel}
        </option>
        <option value="__none">No {settings.mainLabel === 'Project Sectors' ? 'project sector' : 'main tag'}</option>
        {settings.mainTags.map(tag => (
          <option key={tag.id} value={tag.id}>
            {tag.label}
          </option>
        ))}
      </select>
      <label className={selectionControlsStyles.visuallyHidden} htmlFor="story-secondary">
        {settings.secondaryLabel}
      </label>
      <select
        id="story-secondary"
        value={filters.secondary}
        onChange={event => setFilters({ ...filters, secondary: event.target.value })}
      >
        <option value="">
          {settings.secondaryLabel === 'Regions' ? 'All regions' : 'All ' + settings.secondaryLabel}
        </option>
        <option value="__none">No {settings.secondaryLabel === 'Regions' ? 'region' : 'secondary tag'}</option>
        {settings.secondaryTags.map(tag => (
          <option key={tag.id} value={tag.id}>
            {tag.label}
          </option>
        ))}
      </select>
      <span className={recordTableStyles.meta} role="status">
        {visibleCount} of {totalCount}
      </span>
    </div>
  )
}
