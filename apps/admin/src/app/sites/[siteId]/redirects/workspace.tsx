'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '../../../../components/ui/button.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { Drawer } from '../../../../components/ui/dialog.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { EmptyState } from '../../../../components/ui/feedback.tsx'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import {
  previewRedirectCsv,
  type RedirectRow,
  type RedirectPage,
  type RedirectImportRow,
} from '../../../../lib/redirect-import.ts'
import { changeRedirect, importRedirects } from './actions.ts'
import styles from './redirects.module.css'
import { useBrowserSetup } from '../../../../components/use-browser-setup.ts'
import { requestLocalDraftNavigation, useNavigationGuard } from '../../../../components/navigation-guard.ts'
export function RedirectWorkspace({
  siteId,
  rows,
  pages,
  native = false,
  actorId,
}: {
  actorId: string
  siteId: string
  rows: RedirectRow[]
  pages: RedirectPage[]
  native?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<RedirectRow | null | undefined>()
  const [removing, setRemoving] = useState<RedirectRow | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()
  const removingBusy = useRef(false)
  useNavigationGuard(() => ({ dirty: false, pending: pending || removingBusy.current }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pending || removingBusy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])
  const saved = (outcome: { ok: boolean; message: string }) => {
    setResult(outcome)
    if (outcome.ok) router.refresh()
  }
  const actions = (
    <div className={styles.actions}>
      <Button disabled={!pages.length} onClick={() => setEditing(null)}>
        Add redirect
      </Button>
      <Button variant="secondary" disabled={!pages.length} onClick={() => setImporting(true)}>
        Import from a spreadsheet
      </Button>
    </div>
  )
  const content = !rows.length ? (
    <EmptyState title="No redirects yet">
      Add an old address and choose its new page.{!pages.length ? ' Create a page first.' : ''}
    </EmptyState>
  ) : (
    <div className={styles.table}>
      <table aria-label="Site redirects">
        <thead>
          <tr>
            <th>Old address</th>
            <th>Goes to</th>
            <th>Availability</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{row.oldPath}</td>
              <td>
                {row.title}
                {row.publishedPath && <div>{row.publishedPath}</div>}
              </td>
              <td>{row.publishedPath ? 'Ready' : 'Waiting for page publication'}</td>
              <td>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={() => setEditing(row)}>
                    Edit<span className={styles.sr}> {row.oldPath}</span>
                  </Button>
                  <Button variant="tertiary" onClick={() => setRemoving(row)}>
                    Remove<span className={styles.sr}> {row.oldPath}</span>
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <>
      {!native && actions}
      {result && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
      {!native && (
        <p>
          Changes take effect immediately for published destinations. A draft destination starts working after it is
          published.
        </p>
      )}
      <Card
        title={native ? 'Redirects' : undefined}
        density={native ? 'settings' : undefined}
        description={
          native
            ? 'Keep old links working. Visitors and search engines go straight to the new page on this site.'
            : undefined
        }
      >
        {content}
        {native && (
          <>
            <p>
              Changes take effect immediately for published destinations. A draft destination starts working after it is
              published.
            </p>
            {actions}
          </>
        )}
      </Card>
      {editing !== undefined && (
        <RedirectForm
          actorId={actorId}
          siteId={siteId}
          row={editing}
          pages={pages}
          onClose={() => setEditing(undefined)}
          onSaved={outcome => {
            saved(outcome)
            setEditing(undefined)
          }}
        />
      )}
      {importing && (
        <RedirectImport
          actorId={actorId}
          siteId={siteId}
          rows={rows}
          pages={pages}
          onClose={() => setImporting(false)}
          onSaved={outcome => {
            saved(outcome)
            setImporting(false)
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove redirect?"
          what={'Visitors using ' + removing.oldPath + ' will no longer be sent to ' + removing.title + '.'}
          confirmLabel="Remove redirect"
          pending={pending}
          error={result?.ok === false ? result.message : undefined}
          onCancel={() => {
            setRemoving(null)
            setResult(null)
          }}
          onConfirm={() => {
            if (removingBusy.current) return
            removingBusy.current = true
            start(async () => {
              try {
                const outcome = await changeRedirect({
                  siteId,
                  id: removing.id,
                  revision: removing.revision,
                  oldPath: removing.oldPath,
                  pageId: removing.pageId,
                  remove: true,
                })
                saved(outcome)
                if (outcome.ok) setRemoving(null)
              } catch {
                setResult({ ok: false, message: 'The removal could not be confirmed. Reload before retrying.' })
              } finally {
                removingBusy.current = false
              }
            })
          }}
        />
      )}
    </>
  )
}
function RedirectForm({
  siteId,
  row,
  pages,
  onClose,
  onSaved,
  actorId,
}: {
  actorId: string
  siteId: string
  row: RedirectRow | null
  pages: RedirectPage[]
  onClose: () => void
  onSaved: (result: { ok: boolean; message: string }) => void
}) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const inFlight = useRef(false)
  const initial = { oldPath: row?.oldPath ?? '', pageId: row?.pageId ?? '', revision: row?.revision ?? '0' }
  const setup = useBrowserSetup({
    storageKey: 'cms.redirect-setup.' + actorId + '.' + siteId + '.' + (row?.id ?? 'new'),
    initial,
    label: 'Redirect setup',
    pending: () => pending || inFlight.current,
    read: value => {
      const data = value as typeof initial
      return data &&
        typeof data.oldPath === 'string' &&
        data.oldPath.length <= 2048 &&
        typeof data.pageId === 'string' &&
        data.pageId.length <= 36 &&
        typeof data.revision === 'string' &&
        data.revision.length <= 30
        ? { oldPath: data.oldPath, pageId: data.pageId, revision: data.revision }
        : null
    },
  })
  const { oldPath, pageId, revision } = setup.value
  const busy = pending || setup.loading
  const close = () => {
    if (requestLocalDraftNavigation(setup.leaveState, onClose)) onClose()
  }
  function save() {
    if (inFlight.current || setup.loading) return
    inFlight.current = true
    setError('')
    start(async () => {
      try {
        const outcome = await changeRedirect({ siteId, id: row?.id ?? null, revision, oldPath, pageId })
        if (outcome.ok) {
          setup.finish()
          onSaved(outcome)
        } else {
          setError(outcome.message)
          router.refresh()
        }
      } catch {
        setError('The save could not be confirmed. Your entries are still here. Check Redirects before retrying.')
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <Drawer
      title={row ? 'Edit redirect' : 'Add redirect'}
      onClose={close}
      pending={busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button loading={pending} disabled={busy || !oldPath.trim() || !pageId} onClick={save}>
            Save redirect
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <p>Choose a page on this site. Redirects cannot point to another redirect or an outside website.</p>
        <p>Save draft and leave keeps these choices only in this browser. It does not activate a redirect.</p>
        {setup.saved && (
          <>
            <p>
              Choices restored or saved in this browser. Check the old address and destination before saving the
              redirect.
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (setup.clear()) setError('')
              }}
            >
              Clear saved redirect setup
            </Button>
          </>
        )}
        {setup.error && <p role="alert">{setup.error}</p>}
        {error && <p role="alert">{error}</p>}
        <Field
          id="redirect-old-address"
          label="Old address"
          help="For example, /chapter/peoria. Leave out the website name."
          required
        >
          <input
            value={oldPath}
            maxLength={2048}
            disabled={busy}
            onChange={event => {
              setError('')
              setup.setValue(value => ({ ...value, oldPath: event.target.value }))
            }}
          />
        </Field>
        <Field id="redirect-new-page" label="New page" required>
          <select
            value={pageId}
            disabled={busy}
            onChange={event => {
              setError('')
              setup.setValue(value => ({ ...value, pageId: event.target.value }))
            }}
          >
            <option value="">Choose a page</option>
            {pageId && !pages.some(page => page.id === pageId) && (
              <option value={pageId} disabled>
                Saved page is unavailable — choose a replacement
              </option>
            )}
            {pages.map(page => (
              <option key={page.id} value={page.id}>
                {page.title} · {page.path}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Drawer>
  )
}
function RedirectImport({
  siteId,
  rows,
  pages,
  onClose,
  onSaved,
  actorId,
}: {
  actorId: string
  siteId: string
  rows: RedirectRow[]
  pages: RedirectPage[]
  onClose: () => void
  onSaved: (result: { ok: boolean; message: string }) => void
}) {
  const router = useRouter()
  const [plan, setPlan] = useState<RedirectImportRow[] | null>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const inFlight = useRef(false)
  const importCount = plan?.filter(row => !row.unchanged).length ?? 0
  const initial = { source: '', fileName: '' }
  const setup = useBrowserSetup({
    storageKey: 'cms.redirect-csv.' + actorId + '.' + siteId,
    initial,
    label: 'Redirect spreadsheet source',
    pending: () => pending || inFlight.current,
    read: value => {
      const data = value as typeof initial
      return data &&
        typeof data.source === 'string' &&
        new Blob([data.source]).size <= 262144 &&
        typeof data.fileName === 'string' &&
        data.fileName.length <= 255
        ? { source: data.source, fileName: data.fileName }
        : null
    },
  })
  const { source, fileName } = setup.value
  const busy = pending || setup.loading
  const close = () => {
    if (requestLocalDraftNavigation(setup.leaveState, onClose)) onClose()
  }
  function choose(file: File | undefined) {
    if (!file || busy || inFlight.current) return
    const load = () => {
      if (file.size > 262144) {
        setError('Choose a CSV file smaller than 256 KB.')
        return
      }
      inFlight.current = true
      setError('')
      start(async () => {
        try {
          const source = await file.text()
          setup.setValue({ source, fileName: file.name })
          setPlan(null)
        } catch {
          setError('The file could not be read. Choose it again.')
        } finally {
          inFlight.current = false
        }
      })
    }
    if (requestLocalDraftNavigation(setup.leaveState, load)) load()
  }
  function apply() {
    if (inFlight.current || !plan || setup.loading) return
    inFlight.current = true
    setError('')
    start(async () => {
      try {
        const outcome = await importRedirects({ siteId, source, expected: plan })
        if (outcome.ok) {
          setup.finish()
          onSaved(outcome)
        } else {
          setError(outcome.message)
          setPlan(null)
          router.refresh()
        }
      } catch {
        setError('The import could not be confirmed. Check the redirects before retrying.')
        setPlan(null)
        router.refresh()
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <Drawer
      title="Import redirects from a spreadsheet"
      onClose={close}
      pending={busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Button>
          {plan ? (
            <Button loading={pending} disabled={busy || plan.some(row => row.issue !== null)} onClick={apply}>
              Import {importCount} {importCount === 1 ? 'redirect' : 'redirects'}
            </Button>
          ) : (
            <Button
              disabled={!source || busy}
              onClick={() => {
                try {
                  setError('')
                  setPlan(previewRedirectCsv(source, pages, rows))
                } catch (error) {
                  setError((error as Error).message)
                }
              }}
            >
              Preview redirects
            </Button>
          )}
        </>
      }
    >
      <div className={styles.stack}>
        <p>
          Use two columns named <strong>Old address</strong> and <strong>New address</strong>. Put a path such as
          /chapters/peoria in New address. Save as CSV from your spreadsheet, then choose the file. Up to 200 rows.
        </p>
        <p>
          Save draft and leave keeps the source only in this browser. It does not import or activate redirects. Preview
          the rows again after restoring.
        </p>
        {setup.saved && (
          <>
            <p>Spreadsheet source restored or saved in this browser.</p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (setup.clear()) {
                  setPlan(null)
                  setError('')
                }
              }}
            >
              Clear saved spreadsheet source
            </Button>
          </>
        )}
        {setup.error && <p role="alert">{setup.error}</p>}
        <Field id="redirect-spreadsheet" label="Spreadsheet saved as CSV">
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              choose(file)
            }}
          />
        </Field>
        {fileName && <p>Loaded CSV: {fileName}</p>}
        {error && <p role="alert">{error}</p>}
        {plan && (
          <>
            <p>
              Review every row. Rows marked Keep already match. Fix any errors in the spreadsheet and choose it again;
              no rows are imported until every row is valid.
            </p>
            <div className={styles.table + ' ' + styles.preview}>
              <table aria-label="Redirect import preview">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Old address</th>
                    <th>New address</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map(row => (
                    <tr key={row.line}>
                      <td>{row.line}</td>
                      <td>{row.oldPath}</td>
                      <td>{row.newPath}</td>
                      <td>{row.issue ?? (row.unchanged ? 'Keep' : row.id ? 'Update' : 'Add')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
