'use client'
import { useMemo, type ReactNode } from 'react'
import styles from './media-workspace.module.css'
import state from '../../../../components/state.module.css'
import mediaUi from '../../../../components/media-ui.module.css'
import { MediaThumbnail as MediaThumb } from '../../../../components/media-thumbnail.tsx'
import { Badge, Button, Disclosure, Field, SegmentedControl } from '../../../../components/ui/index.ts'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { IconChevronLeft, IconChevronRight, IconSearch } from '../../../../components/icons.tsx'
import {
  formatDimensions,
  mediaStatusLabel,
  type MediaAsset,
  type MediaLibraryQuery,
  type MediaLibraryResult,
  type MediaStatus,
} from '../../../../lib/media-library.ts'
import { MediaSearch } from './media-search.tsx'

export type MediaLibraryView = 'grid' | 'list'
type Browse = {
  native: boolean
  loading: boolean
  selectionBusy: boolean
  result: MediaLibraryResult
  query: MediaLibraryQuery
  view: MediaLibraryView
  searchInput: string
  foldersExpanded: boolean
  selectedId: string | undefined
  checkedIds: ReadonlySet<string>
}
type Actions = {
  changeSearch: (value: string) => void
  changeQuery: (change: Partial<MediaLibraryQuery>) => void
  changeView: (view: MediaLibraryView) => void
  changeFoldersExpanded: (expanded: boolean) => void
  selectPage: () => void
  clearFilters: () => void
  canEdit: (asset: MediaAsset) => boolean
  toggleChecked: (asset: MediaAsset) => void
  openImage: (id: string) => void
}

const FILTERS: Array<{ value: 'all' | MediaStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
  { value: 'deleted', label: 'Deleted' },
]

/** Browse and select images. The workspace owns mutations and unsaved work. */
export function MediaLibraryBrowser({ browse, actions }: { browse: Browse; actions: Actions }) {
  const { native, loading, selectionBusy, result, query, view, searchInput, foldersExpanded, selectedId, checkedIds } =
    browse
  const {
    changeSearch,
    changeQuery,
    changeView,
    changeFoldersExpanded,
    selectPage,
    clearFilters,
    canEdit,
    toggleChecked,
    openImage,
  } = actions
  const folders = useMemo(() => folderTree(result.facets.folders), [result.facets.folders])
  return (
    <section className="media-library" aria-labelledby="media-library-title" aria-busy={loading}>
      <div className={'media-library-head ' + mediaUi.toolbar}>
        <div>
          {!native && <p className="eyebrow">Browse and organize</p>}
          <h2 id="media-library-title" className={native ? selectionControlsStyles.visuallyHidden : undefined}>
            Image library
          </h2>
        </div>
        <MediaSearch value={searchInput} onChange={changeSearch} />
      </div>
      <div className={'media-controls ' + mediaUi.toolbar}>
        <SegmentedControl
          appearance="pills"
          size="s"
          label="Filter images by status"
          value={query.status}
          options={FILTERS.filter(option => option.value !== 'failed')}
          onChange={value => changeQuery({ status: value as MediaLibraryQuery['status'] })}
        />
        <MoreMediaFilters native={native}>
          <Field id="media-filter-scope" label="Library" density="compact">
            <select
              value={query.scope}
              onChange={event => changeQuery({ scope: event.target.value as MediaLibraryQuery['scope'] })}
            >
              <option value="all">Site + shared</option>
              <option value="site">This site ({result.facets.scopes.site})</option>
              <option value="shared">Shared ({result.facets.scopes.shared})</option>
            </select>
          </Field>
          <Field id="media-filter-tag" label="Tag" density="compact">
            <select value={query.tag} onChange={event => changeQuery({ tag: event.target.value })}>
              <option value="">Any tag</option>
              {result.facets.tags.map(tag => (
                <option key={tag.tag} value={tag.tag}>
                  {tag.tag} ({tag.count})
                </option>
              ))}
            </select>
          </Field>
          <Field id="media-filter-sort" label="Sort" density="compact">
            <select
              value={query.sort}
              onChange={event => changeQuery({ sort: event.target.value as MediaLibraryQuery['sort'] })}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
            </select>
          </Field>
        </MoreMediaFilters>
        <SegmentedControl
          appearance="pills"
          size="s"
          label="Library view"
          value={view}
          options={[
            { value: 'grid', label: 'Grid' },
            { value: 'list', label: 'List' },
          ]}
          onChange={value => changeView(value as MediaLibraryView)}
        />
      </div>

      <div className="media-organizer">
        <Disclosure
          title="Folders"
          className={styles.folders + ' ' + mediaUi.folders}
          open={foldersExpanded}
          onToggle={event => {
            if (event.target === event.currentTarget) changeFoldersExpanded(event.currentTarget.open)
          }}
          aria-label="Folders"
        >
          <button type="button" className={query.folder === '' ? 'on' : ''} onClick={() => changeQuery({ folder: '' })}>
            <span>All images</span>
            <strong>{result.facets.folders.reduce((sum, row) => sum + row.count, 0)}</strong>
          </button>
          {folders.map(folder => (
            <button
              type="button"
              key={folder.path}
              className={query.folder === folder.path ? 'on' : ''}
              style={{ paddingInlineStart: `calc(var(--space-3) + var(--space-4) * ${folder.depth})` }}
              onClick={() => changeQuery({ folder: folder.path })}
            >
              <span className={listInspectorStyles.itemLabel} title={folder.path}>
                {folder.label || 'Unfiled'}
              </span>
              <strong>{folder.count}</strong>
            </button>
          ))}
        </Disclosure>

        <div className={'media-results ' + mediaUi.results}>
          <div className="media-results-head">
            <p role="status">{loading ? 'Loading…' : `${result.total} ${result.total === 1 ? 'result' : 'results'}`}</p>
            {result.assets.some(canEdit) && (
              <Button
                variant="secondary"
                type="button"
                className="small secondary"
                disabled={selectionBusy}
                onClick={selectPage}
              >
                Select this page
              </Button>
            )}
          </div>
          {result.assets.length === 0 ? (
            <div className={'media-empty ' + state.state}>
              <span>
                <IconSearch size={24} />
              </span>
              <h3>No images match these filters</h3>
              <p>Try all folders, clear the tag, or use fewer search terms.</p>
              <Button variant="secondary" type="button" className="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            // A plain list: each image opens its details with a button, and its bulk-selection checkbox
            // sits beside that button rather than inside an option, so no control nests in another.
            <ul
              className={`media-assets is-${view} ${mediaUi.gallery}`}
              data-view={view}
              data-compact={native || undefined}
              aria-label="Images"
            >
              {result.assets.map(asset => (
                <li
                  id={`media-${asset.id}`}
                  key={asset.id}
                  className={'media-asset ' + mediaUi.asset}
                  data-selected={selectedId === asset.id ? 'true' : undefined}
                >
                  {canEdit(asset) && (
                    <label className={'media-asset-check ' + selectionControlsStyles.checkRow}>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(asset.id)}
                        disabled={selectionBusy}
                        onChange={() => toggleChecked(asset)}
                        aria-label={`Select ${asset.name}`}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    className="media-asset-open"
                    aria-pressed={selectedId === asset.id}
                    onClick={() => openImage(asset.id)}
                  >
                    <MediaThumb asset={asset} />
                    <span className={'media-asset-copy ' + mediaUi.copy}>
                      <strong title={asset.name}>{asset.name}</strong>
                      <small>
                        {asset.folder || 'Unfiled'} · {formatDimensions(asset)}
                      </small>
                      <Badge
                        tone={
                          asset.status === 'ready'
                            ? 'live'
                            : asset.status === 'failed'
                              ? 'error'
                              : asset.status === 'processing'
                                ? 'info'
                                : 'neutral'
                        }
                      >
                        {mediaStatusLabel(asset.status)}
                      </Badge>
                      {asset.tags.length > 0 && (
                        <span className="media-card-tags">{asset.tags.slice(0, 3).join(' · ')}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <nav className="media-pagination" aria-label="Media pages">
            <Button
              variant="secondary"
              type="button"
              className="secondary"
              disabled={result.page <= 1 || loading}
              onClick={() => changeQuery({ page: result.page - 1 })}
            >
              <IconChevronLeft size={15} /> Previous
            </Button>
            <span>
              Page {result.page} of {result.pageCount}
            </span>
            <label>
              <span>Items per page</span>
              <select
                value={query.pageSize}
                onChange={event =>
                  changeQuery({
                    pageSize: Number(event.target.value),
                  })
                }
              >
                <option value="12">12</option>
                <option value="24">24</option>
                <option value="48">48</option>
              </select>
            </label>
            <Button
              variant="secondary"
              type="button"
              className="secondary"
              disabled={result.page >= result.pageCount || loading}
              onClick={() => changeQuery({ page: result.page + 1 })}
            >
              Next <IconChevronRight size={15} />
            </Button>
          </nav>
        </div>
      </div>
    </section>
  )
}

function MoreMediaFilters({ native, children }: { native: boolean; children: ReactNode }) {
  return native ? (
    <Disclosure title="More filters" className={mediaUi.options}>
      <div className={mediaUi.optionFields}>{children}</div>
    </Disclosure>
  ) : (
    children
  )
}

function folderTree(rows: Array<{ path: string; count: number }>) {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (!row.path) {
      totals.set('', (totals.get('') ?? 0) + row.count)
      continue
    }
    const parts = row.path.split('/')
    for (let index = 1; index <= parts.length; index += 1) {
      const path = parts.slice(0, index).join('/')
      totals.set(path, (totals.get(path) ?? 0) + row.count)
    }
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, count]) => ({
      path,
      count,
      depth: path ? path.split('/').length - 1 : 0,
      label: path ? path.split('/').at(-1)! : 'Unfiled',
    }))
}
