'use client'

import { listItemUnit } from '../../../lib/list-items.ts'
import { useEffect, useState } from 'react'
import { readCollectionBinding, type CollectionBindingOption } from '../../../lib/collection-binding.ts'
import { AutomaticCollectionSelection, ManualCollectionSelection } from './collection-selection-controls.tsx'

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
  const selected = options.find(option => option.readerKey === binding?.readerKey)
  const canSelect = Boolean(selected?.compatible && !loading && !error)
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
      {!loading && !error && !options.some(option => option.compatible) && (
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
            <AutomaticCollectionSelection
              id={id}
              selection={binding.selection}
              option={selected}
              enabled={canSelect}
              onChange={selection => onChange({ ...binding, selection })}
            />
          ) : (
            <ManualCollectionSelection
              selection={binding.selection}
              option={selected}
              enabled={canSelect}
              loading={loading}
              choicesFailed={Boolean(error)}
              onChange={selection => onChange({ ...binding, selection })}
            />
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
