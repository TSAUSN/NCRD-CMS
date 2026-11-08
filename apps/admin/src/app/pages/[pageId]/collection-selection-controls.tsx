import { useEffect, useMemo, useState } from 'react'
import type { StructuredRepeatBinding } from '@cms/schema'
import {
  moveCollectionEntry,
  toggleCollectionEntry,
  type CollectionBindingOption,
} from '../../../lib/collection-binding.ts'

type Selection = StructuredRepeatBinding['selection']
type Automatic = Extract<Selection, { mode: 'automatic' }>
type Manual = Extract<Selection, { mode: 'manual' }>
type SelectionProps<T> = {
  selection: T
  option: CollectionBindingOption | undefined
  enabled: boolean
  onChange: (value: T) => void
}

export function AutomaticCollectionSelection({
  id,
  selection,
  option,
  enabled,
  onChange,
}: SelectionProps<Automatic> & { id: string }) {
  const { filter } = selection
  const [filterText, setFilterText] = useState(filter?.value ?? '')
  useEffect(() => setFilterText(filter?.value ?? ''), [filter?.value])
  const filterFields = option?.filters
  const matchingValues = filterFields?.find(field => field.key === filter?.field)?.values
  return (
    <>
      <label htmlFor={`${id}-limit`}>Maximum items</label>
      <input
        id={`${id}-limit`}
        type="number"
        min={1}
        max={200}
        value={selection.limit}
        disabled={!enabled}
        onChange={event => {
          const limit = Number(event.target.value)
          if (Number.isSafeInteger(limit) && limit >= 1 && limit <= 200) onChange({ ...selection, limit })
        }}
      />
      {filter && (
        <>
          <label htmlFor={`${id}-category`}>Tag or category</label>
          <select
            id={`${id}-category`}
            value={filter.field}
            disabled={!enabled}
            onChange={event => {
              const field = event.target.value
              const value = filterFields?.find(candidate => candidate.key === field)?.values[0] ?? 'Choose a category'
              onChange({ ...selection, filter: { field, value } })
            }}
          >
            {filterFields?.map(field => (
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
            disabled={!enabled}
            onChange={event => setFilterText(event.target.value)}
            onBlur={() => {
              const value = filterText.trim()
              if (value) onChange({ ...selection, filter: { field: filter.field, value } })
              else setFilterText(filter.value)
            }}
          />
          <datalist id={`${id}-category-values`}>
            {matchingValues?.map(value => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </>
      )}
      <p className="hint">
        Shows up to {selection.limit}{' '}
        {selection.order === 'newest'
          ? 'newest items (by the date they were added)'
          : filter
            ? 'matching items, in list order'
            : 'items, in the order set in Lists'}
        . The canvas includes saved list drafts. Visitors see published items.
      </p>
    </>
  )
}

export function ManualCollectionSelection({
  selection,
  option,
  enabled,
  onChange,
  loading,
  choicesFailed,
}: SelectionProps<Manual> & { loading: boolean; choicesFailed: boolean }) {
  const keys = selection.stableKeys
  const selected = new Set(keys)
  const entries = option?.entries
  const titles = useMemo(() => new Map(entries?.map(entry => [entry.stableKey, entry.title])), [entries])
  const missing = keys.some(key => !titles.has(key))
  const update = (stableKeys: string[]) => onChange({ mode: 'manual', stableKeys })
  return (
    <>
      <p className="hint">Select up to 200 published items. Reorder the selected list below. {keys.length} selected.</p>
      <div className="collection-binding-choices">
        {entries?.map(entry => {
          const checked = selected.has(entry.stableKey)
          return (
            <label className="checkbox" key={entry.stableKey}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!enabled || (!checked && keys.length >= 200)}
                onChange={event => update(toggleCollectionEntry(keys, entry.stableKey, event.target.checked))}
              />
              <span>{entry.title}</span>
            </label>
          )
        })}
      </div>
      {keys.length === 0 && <p className="hint">No items selected. The section will show its empty state.</p>}
      <ol className="collection-binding-order">
        {keys.map((key, index) => (
          <li key={key}>
            <span>{titles.get(key) ?? `${key} (not published)`}</span>
            <span className="btn-row">
              <button
                type="button"
                className="secondary small"
                aria-label={`Move ${key} up`}
                disabled={!enabled || index === 0}
                onClick={() => update(moveCollectionEntry(keys, index, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="secondary small"
                aria-label={`Move ${key} down`}
                disabled={!enabled || index === keys.length - 1}
                onClick={() => update(moveCollectionEntry(keys, index, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="ghost small"
                aria-label={`Remove ${key} from selection`}
                disabled={loading}
                onClick={() => update(keys.filter(entry => entry !== key))}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ol>
      {missing && !loading && !choicesFailed && (
        <p className="warn-inline">
          Some selected items are no longer published. Restore them in Lists or remove them from this selection before
          publishing the page.
        </p>
      )}
    </>
  )
}
