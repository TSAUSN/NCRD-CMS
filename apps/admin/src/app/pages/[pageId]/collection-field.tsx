'use client'

import { listItemUnit } from '../../../lib/list-items.ts'
import { useEffect, useState } from 'react'
import {
  readCollectionBinding,
  toggleCollectionEntry,
  moveCollectionEntry,
  type CollectionBindingOption,
} from '../../../lib/collection-binding.ts'

export function CollectionField({
  id,
  value,
  siteId,
  definitionId,
  version,
  fieldId,
  onChange,
  onEditList,
}: {
  id: string
  value: unknown
  siteId: string
  definitionId: string
  version: number
  fieldId: string
  onEditList?: (readerKey: string, stableKey?: string) => void
  onChange: (value: unknown) => void
}) {
  const [options, setOptions] = useState<CollectionBindingOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ definition: definitionId, version: String(version), field: fieldId })
    void fetch(`/api/sites/${encodeURIComponent(siteId)}/collection-options?${params}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error('List choices could not be loaded. Your saved selection is unchanged.')
        const result = (await response.json()) as { options: CollectionBindingOption[] }
        if (!controller.signal.aborted) setOptions(result.options)
      })
      .catch(error => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'List choices could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [siteId, definitionId, version, fieldId, reload])
  const binding = readCollectionBinding(value)
  const [filterText, setFilterText] = useState('')
  const filterValue = binding?.selection.mode === 'automatic' ? binding.selection.filter?.value : undefined
  useEffect(() => setFilterText(filterValue ?? ''), [filterValue])
  const selected = options.find(option => option.readerKey === binding?.readerKey)
  const keys = binding?.selection.mode === 'manual' ? binding.selection.stableKeys : []
  const missing = keys.filter(key => !selected?.entries.some(entry => entry.stableKey === key))
  const canSelect = selected?.compatible && !loading && !error
  return (
    <div className="subfields">
      {selected && (
        <div className="collection-edit-handoff">
          <p>
            Shows: <strong>{selected.name}</strong> ·{' '}
            {binding?.selection.mode === 'manual'
              ? 'Picked items'
              : binding?.selection.order === 'newest'
                ? 'Newest first'
                : binding?.selection.filter
                  ? 'Filtered by ' + binding.selection.filter.value
                  : 'All, in list order'}
          </p>
          {onEditList && (
            <>
              <button type="button" className="secondary small" onClick={() => onEditList(selected.readerKey)}>
                Add {listItemUnit(selected.readerKey)}
              </button>
              <label htmlFor={`${id}-edit`}>
                Edit an item
                <select
                  id={`${id}-edit`}
                  value=""
                  onChange={event => {
                    if (event.target.value) onEditList(selected.readerKey, event.target.value)
                  }}
                >
                  <option value="">Choose…</option>
                  {selected.entries.map(entry => (
                    <option key={entry.stableKey} value={entry.stableKey}>
                      {entry.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <a
            href={`/sites/${siteId}/content?collection=${selected.id}`}
            target="_blank"
            rel="noopener"
            title={`Open ${selected.name} in a new tab`}
          >
            Edit {selected.name}
          </a>
          <p className="hint">
            This list is shared across pages. Save creates a private draft; publish the list to update it everywhere.
          </p>
        </div>
      )}
      <select
        id={id}
        value={binding?.readerKey ?? ''}
        disabled={loading || !!error}
        onChange={event => {
          const chosen = options.find(option => option.readerKey === event.target.value)
          if (chosen?.compatible) onChange({ readerKey: chosen.readerKey, selection: { mode: 'automatic', limit: 50 } })
        }}
      >
        <option value="" disabled>
          Choose a list…
        </option>
        {binding && !selected && <option value={binding.readerKey}>{binding.readerKey} (current selection)</option>}
        {options.map(option => (
          <option key={option.id} value={option.readerKey} disabled={!option.compatible}>
            {option.name} · {option.entries.length} live{!option.compatible ? ' · needs attention' : ''}
          </option>
        ))}
      </select>
      {loading && (
        <p className="hint" role="status">
          Loading lists for this site…
        </p>
      )}
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && selected && !selected.compatible && (
        <p className="warn-inline">{selected.problem} Your saved selection has not changed.</p>
      )}
      {!loading && !error && options.filter(option => option.compatible).length === 0 && (
        <p className="hint">
          No list fits this layout yet. Create or publish its fields in Lists, then refresh these choices.
        </p>
      )}
      {!loading && !error && !binding && value !== undefined && (
        <p className="warn-inline">This field needs a list selection. Choose one above to repair it.</p>
      )}
      {binding && (
        <>
          <label htmlFor={`${id}-mode`}>Items to show</label>
          <select
            id={`${id}-mode`}
            value={
              binding.selection.mode === 'manual'
                ? 'manual'
                : binding.selection.order === 'newest'
                  ? 'newest'
                  : binding.selection.filter
                    ? 'filtered'
                    : 'automatic'
            }
            disabled={!canSelect}
            onChange={event =>
              onChange({
                readerKey: binding.readerKey,
                selection:
                  event.target.value === 'manual'
                    ? { mode: 'manual', stableKeys: [] }
                    : {
                        mode: 'automatic',
                        limit: 50,
                        ...(event.target.value === 'newest'
                          ? { order: 'newest' }
                          : event.target.value === 'filtered' && selected?.filters?.[0]
                            ? {
                                filter: {
                                  field: selected.filters[0].key,
                                  value: selected.filters[0].values[0] ?? 'Choose a category',
                                },
                              }
                            : {}),
                      },
              })
            }
          >
            <option value="automatic">All, in list order</option>
            <option value="manual">Pick specific items</option>
            <option value="newest">Newest items</option>
            {Boolean(selected?.filters?.length) && <option value="filtered">Filter by tag or category</option>}
          </select>
          {binding.selection.mode === 'automatic' ? (
            <>
              <label htmlFor={`${id}-limit`}>Maximum items</label>
              <input
                id={`${id}-limit`}
                type="number"
                min={1}
                max={200}
                value={binding.selection.limit}
                disabled={!canSelect}
                onChange={event => {
                  const limit = Number(event.target.value)
                  if (Number.isSafeInteger(limit) && limit >= 1 && limit <= 200)
                    onChange({ ...binding, selection: { ...binding.selection, mode: 'automatic', limit } })
                }}
              />
              {binding.selection.filter && (
                <>
                  <label htmlFor={`${id}-category`}>Tag or category</label>
                  <select
                    id={`${id}-category`}
                    value={binding.selection.filter.field}
                    disabled={!canSelect}
                    onChange={event =>
                      onChange({
                        ...binding,
                        selection: {
                          ...binding.selection,
                          filter: {
                            field: event.target.value,
                            value:
                              selected?.filters?.find(field => field.key === event.target.value)?.values[0] ??
                              'Choose a category',
                          },
                        },
                      })
                    }
                  >
                    {selected?.filters?.map(field => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`${id}-category-value`}>Matching value</label>
                  <input
                    id={`${id}-category-value`}
                    maxLength={120}
                    list={`${id}-category-values`}
                    value={filterText}
                    disabled={!canSelect}
                    onChange={event => setFilterText(event.target.value)}
                    onBlur={() => {
                      if (filterText.trim())
                        onChange({
                          ...binding,
                          selection: {
                            ...binding.selection,
                            filter: {
                              field: binding.selection.mode === 'automatic' ? binding.selection.filter!.field : '',
                              value: filterText.trim(),
                            },
                          },
                        })
                      else setFilterText(filterValue ?? '')
                    }}
                  />
                  <datalist id={`${id}-category-values`}>
                    {selected?.filters
                      ?.find(
                        field =>
                          binding.selection.mode === 'automatic' && field.key === binding.selection.filter?.field,
                      )
                      ?.values.map(value => (
                        <option key={value} value={value} />
                      ))}
                  </datalist>
                </>
              )}
              <p className="hint">
                Shows up to {binding.selection.limit}{' '}
                {binding.selection.order === 'newest'
                  ? 'newest items (by the date they were added)'
                  : binding.selection.filter
                    ? 'matching items, in list order'
                    : 'items, in the order set in Lists'}
                . The canvas includes saved list drafts. Visitors see published items.
              </p>
            </>
          ) : (
            <>
              <p className="hint">
                Select up to 200 published items. Reorder the selected list below. {keys.length} selected.
              </p>
              <div className="collection-binding-choices">
                {selected?.entries.map(entry => (
                  <label className="checkbox" key={entry.stableKey}>
                    <input
                      type="checkbox"
                      checked={keys.includes(entry.stableKey)}
                      disabled={!canSelect || (!keys.includes(entry.stableKey) && keys.length >= 200)}
                      onChange={event =>
                        onChange({
                          ...binding,
                          selection: {
                            mode: 'manual',
                            stableKeys: toggleCollectionEntry(keys, entry.stableKey, event.target.checked),
                          },
                        })
                      }
                    />
                    <span>{entry.title}</span>
                  </label>
                ))}
              </div>
              {keys.length === 0 && <p className="hint">No items selected. The section will show its empty state.</p>}
              <ol className="collection-binding-order">
                {keys.map((key, index) => (
                  <li key={key}>
                    <span>
                      {selected?.entries.find(entry => entry.stableKey === key)?.title ?? `${key} (not published)`}
                    </span>
                    <span className="btn-row">
                      <button
                        type="button"
                        className="secondary small"
                        aria-label={`Move ${key} up`}
                        disabled={!canSelect || index === 0}
                        onClick={() =>
                          onChange({
                            ...binding,
                            selection: { mode: 'manual', stableKeys: moveCollectionEntry(keys, index, -1) },
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="secondary small"
                        aria-label={`Move ${key} down`}
                        disabled={!canSelect || index === keys.length - 1}
                        onClick={() =>
                          onChange({
                            ...binding,
                            selection: { mode: 'manual', stableKeys: moveCollectionEntry(keys, index, 1) },
                          })
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="ghost small"
                        aria-label={`Remove ${key} from selection`}
                        disabled={loading}
                        onClick={() =>
                          onChange({
                            ...binding,
                            selection: { mode: 'manual', stableKeys: keys.filter(entry => entry !== key) },
                          })
                        }
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
              {missing.length > 0 && !loading && !error && (
                <p className="warn-inline">
                  Some selected items are no longer published. Restore them in Lists or remove them from this selection
                  before publishing the page.
                </p>
              )}
            </>
          )}
        </>
      )}
      {selected?.entries.length === 0 && !loading && (
        <p className="hint">
          This list has no published items. Saved list drafts appear on this private canvas; visitors see them after
          publication.
        </p>
      )}
      <div className="btn-row">
        {!selected && (
          <a href={`/sites/${siteId}/content`} target="_blank" rel="noopener">
            Open Lists
          </a>
        )}
        <button
          type="button"
          className="ghost small"
          disabled={loading}
          onClick={() => setReload(current => current + 1)}
        >
          Refresh choices
        </button>
      </div>
    </div>
  )
}
