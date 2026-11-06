'use client'

import { GuardedLink as Link } from './guarded-link.tsx'
import type { RecipeBindings, RecipeTarget } from '../lib/recipe-reuse-model.ts'

export function RecipeBindingFields({
  prefix,
  requirements,
  target,
  required,
  bindings,
  onChange,
}: {
  prefix: string
  requirements: string[]
  target: RecipeTarget
  required: boolean
  bindings: RecipeBindings
  onChange: (bindings: RecipeBindings) => void
}) {
  if (requirements.length === 0) return null
  return (
    <div>
      <h3>Connect the collections</h3>
      <p className="hint">
        Each conference needs its own collection for independent speakers and agenda records. Reusing a collection keeps
        its records linked wherever they appear.{' '}
        <Link href={`/sites/${target.id}/content`}>Manage collections on {target.name}</Link>.
      </p>
      {requirements.map((sourceKey, index) => {
        const selected = bindings[sourceKey]
        const collection = target.collections.find(item => item.readerKey === selected?.readerKey)
        const id = `${prefix}-binding-${index}`
        return (
          <fieldset
            key={sourceKey}
            style={{ border: '1px solid var(--line, #dbe1ea)', padding: '1rem', margin: '1rem 0' }}
          >
            <legend>{sourceKey.replaceAll('_', ' ')}</legend>
            <div className="field">
              <label htmlFor={id}>Use collection for {sourceKey}</label>
              <select
                id={id}
                required={required}
                value={selected?.readerKey ?? ''}
                onChange={event => {
                  const next = { ...bindings }
                  if (event.target.value)
                    next[sourceKey] = { readerKey: event.target.value, selection: { mode: 'automatic', limit: 10 } }
                  else delete next[sourceKey]
                  onChange(next)
                }}
              >
                <option value="">
                  {required ? 'Choose a target collection' : 'Keep the template’s current binding'}
                </option>
                {target.collections.map(item => (
                  <option key={item.readerKey} value={item.readerKey}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            {selected && collection && (
              <>
                <div className="field">
                  <label htmlFor={`${id}-mode`}>Records for {sourceKey}</label>
                  <select
                    id={`${id}-mode`}
                    value={selected.selection.mode}
                    onChange={event =>
                      onChange({
                        ...bindings,
                        [sourceKey]: {
                          readerKey: selected.readerKey,
                          selection:
                            event.target.value === 'manual'
                              ? { mode: 'manual', stableKeys: [] }
                              : { mode: 'automatic', limit: 10 },
                        },
                      })
                    }
                  >
                    <option value="automatic">Current and future records</option>
                    <option value="manual">Choose specific records</option>
                  </select>
                </div>
                {selected.selection.mode === 'automatic' ? (
                  <div className="field">
                    <label htmlFor={`${id}-limit`}>Maximum records for {sourceKey}</label>
                    <input
                      type="number"
                      id={`${id}-limit`}
                      min={1}
                      max={100}
                      required
                      value={selected.selection.limit}
                      onChange={event =>
                        onChange({
                          ...bindings,
                          [sourceKey]: {
                            readerKey: selected.readerKey,
                            selection: { mode: 'automatic', limit: Number(event.target.value) },
                          },
                        })
                      }
                    />
                  </div>
                ) : (
                  <div role="group" aria-label={`Selected records for ${sourceKey}`}>
                    {collection.entries.length === 0 && (
                      <p className="hint">
                        No saved records yet. Add records in Collections, or choose current and future records.
                      </p>
                    )}
                    {collection.entries.map(entry => (
                      <label key={entry.stableKey} style={{ display: 'block', marginBlock: '.4rem' }}>
                        <input
                          type="checkbox"
                          checked={
                            selected.selection.mode === 'manual' &&
                            selected.selection.stableKeys.includes(entry.stableKey)
                          }
                          onChange={event => {
                            if (selected.selection.mode !== 'manual') return
                            const keys = selected.selection.stableKeys.filter(key => key !== entry.stableKey)
                            if (event.target.checked) keys.push(entry.stableKey)
                            onChange({
                              ...bindings,
                              [sourceKey]: {
                                readerKey: selected.readerKey,
                                selection: { mode: 'manual', stableKeys: keys },
                              },
                            })
                          }}
                        />{' '}
                        {entry.label}
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </fieldset>
        )
      })}
    </div>
  )
}
