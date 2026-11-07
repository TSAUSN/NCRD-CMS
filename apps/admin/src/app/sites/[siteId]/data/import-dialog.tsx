'use client'
import { useEffect, useState } from 'react'
import { DataValues, type DataValue } from '@cms/schema'
import { previewNumberFile, mergeNumberFile } from '../../../../lib/data-value-import.ts'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { readPublicNumberFile } from './import-actions.ts'
import { Dialog } from '../../../../components/ui/dialog.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
export function NumberImportDialog({
  siteId,
  current,
  onClose,
  onApply,
}: {
  siteId: string
  current: DataValue[]
  onClose: () => void
  onApply: (next: DataValue[]) => Promise<{ ok: boolean; message?: string }>
}) {
  const [address, setAddress] = useState(''),
    [rows, setRows] = useState<DataValue[]>([]),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    changes = rows.filter(row => JSON.stringify(row) !== JSON.stringify(current.find(old => old.id === row.id))),
    valid = rows.length > 0 && DataValues.safeParse(mergeNumberFile(current, rows)).success
  async function save() {
    if (pending || !valid) return { ok: false, message: 'Add a source for every number before saving.' }
    setPending(true)
    try {
      const result = await onApply(mergeNumberFile(current, rows))
      if (!result.ok) setError(result.message ?? 'The draft could not be saved. Your file preview is kept.')
      return result
    } finally {
      setPending(false)
    }
  }
  const leave = () => ({
    dirty: rows.length > 0,
    pending,
    draft: { label: 'Numbers from a file', saveDraft: save, discard: () => setRows([]) },
  })
  useNavigationGuard(leave)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (rows.length || pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [rows.length, pending])
  function close() {
    if (requestLocalDraftNavigation(leave, onClose)) onClose()
  }
  function preview(text: string) {
    try {
      setRows(previewNumberFile(text, current))
      setError('')
    } catch (error) {
      setRows([])
      setError(error instanceof Error ? error.message : 'The file could not be read.')
    }
  }
  async function fetchFile() {
    setPending(true)
    setError('')
    try {
      const result = await readPublicNumberFile(siteId, address)
      if (result.ok) preview(result.text)
      else setError(result.message)
    } catch {
      setError('The file could not be opened. Choose a downloaded file instead.')
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog
      density="compact"
      title="Fill numbers from a file"
      pending={pending}
      onClose={close}
      size={rows.length ? 'large' : 'medium'}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Cancel
          </Button>
          {rows.length > 0 ? (
            <>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  if (requestLocalDraftNavigation(leave, () => setRows([]))) setRows([])
                }}
              >
                Back
              </Button>
              <Button
                disabled={pending || !valid || changes.length === 0}
                loading={pending}
                onClick={() => void save()}
              >
                Save {changes.length} {changes.length === 1 ? 'change' : 'changes'} as a draft
              </Button>
            </>
          ) : (
            <Button disabled={pending || !address.trim()} loading={pending} onClick={() => void fetchFile()}>
              Review file
            </Button>
          )}
        </>
      }
    >
      <div className={listInspectorStyles.formStack}>
        <p>Point to a JSON file or a published sheet exported as CSV. Nothing changes until you review it.</p>
        {rows.length === 0 ? (
          <>
            <Field density="compact" id="number-file-address" label="Address">
              <input
                type="url"
                value={address}
                onChange={event => setAddress(event.target.value)}
                placeholder="https://example.org/sawso-numbers.json"
                disabled={pending}
              />
            </Field>
            <Field density="compact" id="number-file-upload" label="Or choose a JSON or CSV file">
              <input
                type="file"
                accept="application/json,text/csv,.json,.csv"
                disabled={pending}
                onChange={async event => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  if (file.size > 1048576) {
                    setError('Choose a file smaller than 1 MB.')
                    return
                  }
                  preview(await file.text())
                }}
              />
            </Field>
          </>
        ) : (
          <div className={recordTableStyles.tableWrap}>
            <table data-density="content" className={recordTableStyles.table + ' ' + recordTableStyles.compactTable}>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Now</th>
                  <th>In the file</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{current.find(old => old.id === row.id)?.value ?? 'New number'}</td>
                    <td>
                      {row.status === 'does-not-change'
                        ? "Doesn't change"
                        : current.find(old => old.id === row.id)?.value === row.value
                          ? 'Same'
                          : row.value}
                    </td>
                    <td>
                      <input
                        aria-label={'Source for ' + row.label}
                        required
                        value={row.source}
                        maxLength={500}
                        onChange={event =>
                          setRows(
                            rows.map(item => (item.id === row.id ? { ...item, source: event.target.value } : item)),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Changed imported numbers are marked Needs checking. Fixed numbers are kept unchanged. Saving this review
              keeps changes private until Publish.
            </p>
            {!valid && <p className="notice notice-warn">Add a source for every changed number before saving.</p>}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {pending && (
          <p role="status">
            {rows.length ? 'Saving the reviewed number draft…' : 'Reading the file once for your review…'}
          </p>
        )}
      </div>
    </Dialog>
  )
}
