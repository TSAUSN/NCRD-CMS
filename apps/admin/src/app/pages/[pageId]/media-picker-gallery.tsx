import { MediaThumbnail } from '../../../components/media-thumbnail.tsx'
import { IconSearch } from '../../../components/icons.tsx'
import { formatBytes, formatDimensions, mediaStatusLabel } from '../../../lib/media-library.ts'
import type { MediaPickerModel } from './media-picker-state.ts'
import mediaUi from '../../../components/media-ui.module.css'

export function MediaPickerSearch({ picker, headingId }: { picker: MediaPickerModel; headingId: string }) {
  const { view, setView, search, setSearch, refreshing, refreshLibrary, visible } = picker
  return (
    <div className="media-picker-tools">
      <div className="media-search">
        <IconSearch size={16} />
        <label className="sr-only" htmlFor={`${headingId}-search`}>
          Search images
        </label>
        <input
          id={`${headingId}-search`}
          type="search"
          autoFocus
          placeholder="Search images"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>
      <div className="media-density" role="group" aria-label="Library view">
        <button
          type="button"
          className="small secondary"
          aria-pressed={view === 'grid'}
          onClick={() => setView('grid')}
        >
          Grid
        </button>
        <button
          type="button"
          className="small secondary"
          aria-pressed={view === 'list'}
          onClick={() => setView('list')}
        >
          List
        </button>
      </div>
      <button type="button" className="secondary small" disabled={refreshing} onClick={refreshLibrary}>
        {refreshing ? 'Refreshing…' : 'Refresh library'}
      </button>
      <span className="media-result-count" role="status">
        {visible.length} shown
      </span>
    </div>
  )
}

export function MediaPickerGallery({ picker }: { picker: MediaPickerModel }) {
  const { view, visible, search, refreshing, refreshError, selected, select } = picker
  function move(index: number, direction: -1 | 1) {
    if (visible.length === 0) return
    const next = visible[(index + direction + visible.length) % visible.length]!
    select(next)
    window.requestAnimationFrame(() => document.getElementById(`picker-media-${next.id}`)?.focus())
  }

  return (
    <div
      className={`media-picker-assets is-${view} ${mediaUi.gallery}`}
      data-view={view}
      data-compact="true"
      role="listbox"
      aria-label="Available images"
    >
      {visible.length === 0 ? (
        <div className="media-empty compact" role={refreshing ? 'status' : undefined}>
          <IconSearch size={22} />
          <h3>
            {refreshError
              ? 'Images unavailable'
              : refreshing
                ? 'Loading images…'
                : search.trim()
                  ? 'No images match'
                  : 'No images yet'}
          </h3>
          <p>
            {refreshError
              ? 'Use Refresh library above to try again.'
              : refreshing
                ? 'Checking the images available to this site.'
                : search.trim()
                  ? 'Try another search.'
                  : 'Use Upload above to add the first image to this site.'}
          </p>
        </div>
      ) : (
        visible.map((asset, index) => (
          <button
            id={`picker-media-${asset.id}`}
            key={asset.id}
            type="button"
            role="option"
            aria-selected={selected?.id === asset.id}
            className={'media-asset ' + mediaUi.asset}
            onClick={() => select(asset)}
            onKeyDown={event => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                move(index, 1)
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                move(index, -1)
              }
            }}
          >
            <MediaThumbnail readyOnly lazy asset={asset} />
            <span className={'media-asset-copy ' + mediaUi.copy}>
              <strong title={asset.name}>{asset.name}</strong>
              <small>
                {formatDimensions(asset)} · {formatBytes(asset.bytes)}
              </small>
              {asset.status !== 'ready' && (
                <span className={`media-status status-${asset.status}`}>{mediaStatusLabel(asset.status)}</span>
              )}
            </span>
          </button>
        ))
      )}
    </div>
  )
}
