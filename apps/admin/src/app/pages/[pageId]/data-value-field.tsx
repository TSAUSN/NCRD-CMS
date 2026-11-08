'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { dataValueText, type DataBinding, type DataValue } from '@cms/schema'
import { readPageNumbers } from './data-values-actions.ts'
import { Button } from '../../../components/ui/button.tsx'
import { Field } from '../../../components/ui/field.tsx'
import { Disclosure } from '../../../components/ui/disclosure.tsx'
export function DataValueField({
  id,
  pageId,
  binding,
  onChange,
  children,
}: {
  id: string
  pageId: string
  binding?: DataBinding
  onChange: (binding: DataBinding | null, value?: string, suggestedLabel?: string) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(Boolean(binding))
  const [numbers, setNumbers] = useState<DataValue[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  function load() {
    setLoading(true)
    setError('')
    readPageNumbers(pageId)
      .then(result => {
        if (result.ok) setNumbers(result.numbers)
        else setError(result.message)
      })
      .catch(() => setError('Saved numbers could not be loaded. Try again.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (open && numbers === null && !loading) load()
  }, [open])
  const numberIds = [...new Set(binding?.parts.flatMap(part => ('valueId' in part ? [part.valueId] : [])) ?? [])]
  const number = numbers?.find(row => row.id === numberIds[0])
  const prefix = binding?.parts[0] && 'text' in binding.parts[0] ? binding.parts[0].text : ''
  const last = binding?.parts.at(-1)
  const suffix = last && 'text' in last ? last.text : ''
  const [wordsOpen, setWordsOpen] = useState(Boolean(prefix || suffix))
  useEffect(() => {
    if (prefix || suffix) setWordsOpen(true)
  }, [prefix, suffix])
  function choose(valueId: string, before = prefix, after = suffix) {
    if (!valueId) {
      onChange(null, binding && numbers ? (dataValueText(binding, numbers) ?? undefined) : undefined)
      return
    }
    const next: DataBinding =
      binding?.format === 'richtext'
        ? {
            ...binding,
            parts: binding.parts.map(part => ('valueId' in part && part.valueId === numberIds[0] ? { valueId } : part)),
          }
        : { parts: [{ text: before }, { valueId }, { text: after }] }
    onChange(
      next,
      numbers ? (dataValueText(next, numbers) ?? undefined) : undefined,
      numbers?.find(row => row.id === valueId)?.unit || numbers?.find(row => row.id === valueId)?.label,
    )
  }
  if (!open)
    return (
      <>
        {children}
        <Button variant="tertiary" onClick={() => setOpen(true)}>
          Use a saved number
        </Button>
      </>
    )
  return (
    <div className="field-stack">
      {!binding && children}
      {(numberIds.length > 1 ? numberIds : [numberIds[0] ?? '']).map((valueId, index) => (
        <Field
          key={index}
          id={id + '-saved-number-' + index}
          label={numberIds.length > 1 ? 'Saved number ' + (index + 1) : 'Use a saved number'}
        >
          <select
            id={id + '-saved-number-' + index}
            value={valueId}
            disabled={loading || numbers === null}
            onChange={event => {
              if (numberIds.length < 2) {
                choose(event.target.value)
                return
              }
              const next: DataBinding = {
                ...binding!,
                parts: binding!.parts.map(part =>
                  'valueId' in part && part.valueId === valueId ? { valueId: event.target.value } : part,
                ),
              }
              onChange(next, numbers ? (dataValueText(next, numbers) ?? undefined) : undefined)
            }}
          >
            {numberIds.length < 2 && <option value="">Type a number here</option>}
            {numbers?.map(row => (
              <option value={row.id} key={row.id}>
                {row.label} · {row.value}
                {row.status === 'needs-checking'
                  ? ' · Needs checking'
                  : row.status === 'does-not-change'
                    ? " · Doesn't change"
                    : ''}
              </option>
            ))}
          </select>
        </Field>
      ))}
      {loading && <p role="status">Loading saved numbers…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <Button variant="tertiary" onClick={load}>
            Try again
          </Button>
        </p>
      )}
      {numbers?.length === 0 && <p className="hint">No saved numbers yet. An Admin can add them in Data values.</p>}
      {binding && binding.format !== 'richtext' && numberIds.length === 1 && (
        <Disclosure
          title="Words around this number"
          open={wordsOpen}
          onToggle={event => setWordsOpen(event.currentTarget.open)}
        >
          <Field id={id + '-prefix'} label="Words before the number">
            <input value={prefix} onChange={event => choose(numberIds[0]!, event.target.value, suffix)} />
          </Field>
          <Field id={id + '-suffix'} label="Words after the number">
            <input value={suffix} onChange={event => choose(numberIds[0]!, prefix, event.target.value)} />
          </Field>
        </Disclosure>
      )}
      {binding && numberIds.length > 1 && (
        <p className="hint">
          This text uses {numberIds.length} saved numbers. Its wording and formatting stay with the page.
        </p>
      )}
      {binding?.format === 'richtext' && (
        <p className="hint">Formatting stays with this text. To edit its wording, use a number just on this page.</p>
      )}
      {number && (
        <p className="hint">
          {number.source}
          {number.asOf ? ' · ' + number.asOf : ''}. An Admin manages this number.
          {binding?.format !== 'richtext' && <> You can change this stat’s label here.</>}
        </p>
      )}
      {binding && (
        <Button
          variant="tertiary"
          disabled={numbers === null}
          onClick={() => {
            onChange(null, binding && numbers ? (dataValueText(binding, numbers) ?? undefined) : undefined)
            setOpen(false)
          }}
        >
          Use a number just on this page
        </Button>
      )}
      {!binding && (
        <Button variant="tertiary" onClick={() => setOpen(false)}>
          Done
        </Button>
      )}
    </div>
  )
}
