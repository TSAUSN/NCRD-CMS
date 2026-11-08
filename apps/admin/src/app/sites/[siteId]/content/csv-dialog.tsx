'use client'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  collectionEntriesToCsv,
  previewCollectionCsv,
  type CollectionEntryDraft,
  type CollectionModel as CollectionModelValue,
} from '@cms/schema'
import { IconEye } from '../../../../components/icons.tsx'
import { entriesFromCsv } from './collection-workspace-model.ts'
import { EntryState, activeDrafts } from './collection-entries.ts'
import { Dialog } from './collection-dialog.tsx'

export function CsvDialog({
  actorId,
  siteId,
  collectionId,
  name,
  model,
  entries,
  canImport,
  onClose,
  onImport,
}: {
  actorId: string
  siteId: string
  collectionId: string
  name: string
  model: CollectionModelValue
  entries: EntryState[]
  canImport: boolean
  onClose: () => void
  onImport: (entries: CollectionEntryDraft[]) => void
}) {
  const [source, setSource] = useState('')
  const [baseline, setBaseline] = useState('')
  const [restored, setRestored] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const key = actorId ? 'cms.csv-draft.' + actorId + '.' + siteId + '.' + collectionId : ''
  const alive = useRef(true)
  const readInFlight = useRef(false)
  const dirty = source !== baseline
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let saved = ''
    if (key)
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (value && typeof value.source === 'string') saved = value.source
      } catch {
        /* Browser recovery is optional until explicitly saved. */
      }
    setSource(saved)
    setBaseline(saved)
    setRestored(Boolean(saved))
    setError('')
  }, [key])
  const saveDraft = async () => {
    if (!key)
      return {
        ok: false,
        message: 'The CSV source cannot be saved for this account. Keep editing or copy your source.',
      }
    try {
      if (source) localStorage.setItem(key, JSON.stringify({ source }))
      else localStorage.removeItem(key)
      setBaseline(source)
      setRestored(Boolean(source))
      setError('')
      return { ok: true }
    } catch {
      return {
        ok: false,
        message:
          'This browser could not save the CSV source. Keep editing, copy your source, or discard these changes.',
      }
    }
  }
  const discard = () => {
    setSource(baseline)
    setRestored(Boolean(baseline))
    setError('')
  }
  const leaveState = () => ({
    dirty,
    pending: reading || readInFlight.current,
    draft: { label: 'CSV source (saved only in this browser)', saveDraft, discard },
  })
  useNavigationGuard(leaveState)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || reading || readInFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, reading])
  const dismiss = () => {
    if (requestLocalDraftNavigation(leaveState, onClose)) onClose()
  }
  const clearSaved = () => {
    try {
      if (key) localStorage.removeItem(key)
      setSource('')
      setBaseline('')
      setRestored(false)
      setError('')
      return true
    } catch {
      setError('The saved CSV source could not be cleared. Keep your source here and try again.')
      return false
    }
  }
  async function readFile(file: File | undefined) {
    if (!file || readInFlight.current) return
    readInFlight.current = true
    setReading(true)
    setError('')
    try {
      const text = await file.text()
      if (alive.current) setSource(text)
    } catch {
      if (alive.current) setError('The CSV file could not be read. Choose it again or paste its source.')
    } finally {
      readInFlight.current = false
      if (alive.current) setReading(false)
    }
  }
  const preview = useMemo(() => (source ? previewCollectionCsv(model.fields, source) : null), [model.fields, source])
  function download() {
    const csv = collectionEntriesToCsv(
      model.fields,
      entries.filter(entry => !entry.archived).map(entry => entry.values),
    )
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Dialog
      title="CSV import & export"
      lede="Preview every row before it changes the draft. Exported formula-like values are neutralized so spreadsheet software cannot execute them."
      onClose={dismiss}
      wide
    >
      <div className="csv-tools">
        <section>
          <p className="eyebrow">Export</p>
          <h3>Download the current draft</h3>
          <p>
            Column headers use the list's field keys. Imported rows are added as new draft items; existing items are
            kept.
          </p>
          <button type="button" className="secondary" onClick={download}>
            Download CSV
          </button>
        </section>
        <section>
          <p className="eyebrow">Dry-run import</p>
          <h3>Inspect a CSV</h3>
          {canImport ? (
            <>
              <label className="csv-file">
                Choose a CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={reading}
                  onChange={event => {
                    void readFile(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
              </label>
              <p>
                Save draft and leave keeps this source only in this browser for your account and this list. It adds no
                items. Use Add to draft when the rows are ready.
              </p>
              <textarea
                disabled={reading}
                rows={7}
                value={source}
                placeholder={model.fields.map(field => field.key).join(',')}
                onChange={event => setSource(event.target.value)}
                aria-label="CSV source"
              />
            </>
          ) : (
            <p className="notice">
              <IconEye size={16} />
              <span className="notice-body">You can export this list. A contributor or editor can import rows.</span>
            </p>
          )}
        </section>
      </div>
      {reading && <p role="status">Reading the CSV file…</p>}
      {restored && (
        <p role="status">
          CSV source restored from this browser. Check the preview against the current list fields before adding rows.
        </p>
      )}
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      {preview && (
        <section className={`csv-preview ${preview.problems.length ? 'has-problems' : ''}`}>
          <div>
            <p className="eyebrow">Preview result</p>
            <h3>
              {preview.problems.length
                ? `${preview.problems.length} ${preview.problems.length === 1 ? 'row needs' : 'rows need'} attention`
                : `${preview.rows.length} ${preview.rows.length === 1 ? 'row' : 'rows'} ready to add`}
            </h3>
          </div>
          {preview.problems.length > 0 ? (
            <ol>
              {preview.problems.slice(0, 20).map(problem => (
                <li key={`${problem.row}-${problem.messages.join()}`}>
                  <strong>Row {problem.row}</strong> {problem.messages.join(' ')}
                </li>
              ))}
            </ol>
          ) : (
            <div className="csv-preview-table">
              <table>
                <thead>
                  <tr>
                    {model.fields.map(field => (
                      <th key={field.key}>{field.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 5).map((row, index) => (
                    <tr key={index}>
                      {model.fields.map(field => (
                        <td key={field.key}>
                          {typeof row[field.key] === 'object' ? 'Photo' : String(row[field.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 5 && <p>And {preview.rows.length - 5} more rows.</p>}
            </div>
          )}
        </section>
      )}
      <footer>
        <button type="button" className="secondary" onClick={dismiss}>
          Close
        </button>
        {baseline && (
          <button type="button" className="secondary" disabled={reading} onClick={clearSaved}>
            Clear saved CSV source
          </button>
        )}
        {canImport && preview && preview.problems.length === 0 && preview.rows.length > 0 && (
          <button
            type="button"
            disabled={reading}
            onClick={() => {
              const imported = entriesFromCsv(preview.rows, model.presentation.titleField, activeDrafts(entries))
              if (clearSaved()) onImport(imported)
            }}
          >
            Add {preview.rows.length} to draft
          </button>
        )}
      </footer>
    </Dialog>
  )
}
