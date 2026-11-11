'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { domainStatusLabel, recordsText, type DomainRow } from '../../../../lib/domains.ts'
import { reviewTime } from '../../../../lib/review-time.ts'
import workspace from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import { changeDomain } from './actions.ts'

export function DomainWorkspace({
  siteId,
  rows,
  canManage,
  canConnect,
  archived,
}: {
  siteId: string
  rows: DomainRow[]
  canManage: boolean
  canConnect: boolean
  archived: boolean
}) {
  const router = useRouter()
  const [hostname, setHostname] = useState('')
  const [withWww, setWithWww] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<DomainRow | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [pending, startTransition] = useTransition()
  useEffect(() => {
    if (!rows.some(row => !row.removed_at && row.status !== 'live')) return
    const timer = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(timer)
  }, [rows, router])
  function run(input: Parameters<typeof changeDomain>[0]) {
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await changeDomain(input)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setNotice(result.message)
      setRemoving(null)
      setConfirmation('')
      if (input.action === 'add') setHostname('')
      router.refresh()
    })
  }
  return (
    <div className={workspaceFormsStyles.compactForm + ' ' + workspace.denseStack}>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && !removing && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {canManage && canConnect && !archived && (
        <form
          className={'card stack ' + workspaceFormsStyles.formPanel}
          onSubmit={e => {
            e.preventDefault()
            run({ action: 'add', siteId, hostname, withWww })
          }}
        >
          <h2>Connect an address</h2>
          <label>
            Hostname
            <input
              required
              autoComplete="off"
              placeholder="test-one.example.org"
              aria-describedby="domain-hostname-help"
              value={hostname}
              onChange={e => setHostname(e.target.value)}
            />
          </label>
          <p className="hint" id="domain-hostname-help">
            Use the full website address, without https:// or a path. Your DNS provider’s nameservers do not go in this
            field.
          </p>
          <label>
            <input type="checkbox" checked={withWww} onChange={e => setWithWww(e.target.checked)} /> Also connect the
            matching www or non-www address
          </label>
          <p className="hint">
            Connecting a test subdomain? Leave this unchecked unless you also control and need its www address.
          </p>
          <p className="hint">
            You must control this domain. The first custom address becomes primary; later addresses redirect to it until
            you choose Make primary. Add the displayed DNS records at your provider. Checks run every 10 minutes.
          </p>
          <button className="btn btn-primary" disabled={pending}>
            Connect domain
          </button>
        </form>
      )}
      <div className="schema-section-head domains-head">
        <h2>Connected addresses</h2>
        <button type="button" className="btn secondary small" onClick={() => router.refresh()} disabled={pending}>
          Refresh domain status
        </button>
      </div>
      {rows.length === 0 && <p className="card">No custom domains are connected yet.</p>}
      {rows.map(row => (
        <section
          className={'card stack ' + workspaceFormsStyles.formPanel}
          key={row.id}
          aria-label={`Domain ${row.hostname_normalized}`}
        >
          <h2>{row.hostname_normalized}</h2>
          <p>
            <strong>
              {!row.removed_at && row.status === 'pending_dns' && !row.dns_records?.length
                ? 'Preparing DNS instructions'
                : domainStatusLabel(row.removed_at ? 'removed' : row.status)}
            </strong>{' '}
            ·{' '}
            {row.kind === 'primary'
              ? 'Primary address'
              : row.kind === 'staging'
                ? 'Staging address'
                : `Redirects to ${row.redirect_hostname}`}
          </p>
          {!row.removed_at && row.status === 'pending_dns' && !row.dns_records?.length && (
            <p className="notice" role="note">
              The hosting service has not returned DNS records yet. A hosting administrator should check failed
              background work before you change DNS. Refreshing this page does not retry a failed task.{' '}
              <Link href="/help?topic=domains">Domain setup help</Link>
            </p>
          )}
          {row.last_checked_at && <p className="hint">Last checked: {reviewTime(row.last_checked_at)}</p>}
          {row.error_detail && !row.removed_at && <p className="notice">{row.error_detail}</p>}
          {!!row.dns_records?.length && !row.removed_at && (
            <>
              <h3>DNS records</h3>
              <p className="hint">
                Use the full name shown. Providers that append your domain automatically may ask for @ or only the first
                label. Apex CNAME records require DNS flattening; use only the allocated A records when supplied.
              </p>
              <p className="hint">
                Follow the action on each row. Remove only the exact conflicting record listed; keep unrelated email and
                verification records.
              </p>
              <div className="domain-records-scroll">
                <table className={'domain-records ' + recordTableStyles.table + ' ' + recordTableStyles.compactTable}>
                  <caption>Records for {row.hostname_normalized}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Type</th>
                      <th scope="col">Name</th>
                      <th scope="col">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.dns_records.map((record, i) => (
                      <tr key={i}>
                        <td>
                          <span className={record.action === 'REMOVE' ? 'domain-record-remove' : 'domain-record-add'}>
                            {record.action === 'REMOVE' ? 'Remove' : 'Add'}
                          </span>
                        </td>
                        <td>{record.type}</td>
                        <td>
                          <code>{record.name}</code>
                        </td>
                        <td>
                          <code>{record.value}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="btn"
                onClick={() =>
                  void navigator.clipboard.writeText(recordsText(row.dns_records ?? [])).then(
                    () => setNotice('DNS records copied.'),
                    () => setError('Copy was unavailable. Select the records in the table.'),
                  )
                }
              >
                Copy DNS records
              </button>
            </>
          )}
          {canManage && !row.removed_at && row.kind !== 'staging' && (
            <div className="actions">
              {canConnect && (
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => run({ action: 'check', siteId, id: row.id, revision: row.revision })}
                >
                  {row.status === 'removing' ? 'Retry cleanup' : 'Verify now'}
                </button>
              )}
              {row.status === 'live' && row.kind !== 'primary' && (
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => run({ action: 'primary', siteId, id: row.id, revision: row.revision })}
                >
                  Make primary
                </button>
              )}
              {row.status !== 'removing' && (
                <button
                  className="btn btn-danger"
                  disabled={pending}
                  onClick={() => {
                    setError('')
                    setConfirmation('')
                    setRemoving(row)
                  }}
                >
                  Remove domain
                </button>
              )}
            </div>
          )}
          {row.events.length > 0 && (
            <details>
              <summary>Status history</summary>
              <ol>
                {row.events.map((event, i) => (
                  <li key={i}>
                    {domainStatusLabel(event.status)} · {reviewTime(event.at)}
                    {event.detail ? ` — ${event.detail}` : ''}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      ))}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.hostname_normalized}?`}
          what={
            <>
              <p>
                This address immediately stops serving the site. Addresses redirecting to it are also removed. The
                worker then removes the provider connection and certificate.
              </p>
              <label>
                Type {removing.hostname_normalized} to confirm
                <input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} />
              </label>
            </>
          }
          reassurance="Published content remains saved. You can reconnect an address after cleanup completes."
          confirmLabel="Remove domain"
          pending={pending}
          error={error || undefined}
          onCancel={() => {
            if (!pending) setRemoving(null)
          }}
          onConfirm={() =>
            run({ action: 'remove', siteId, id: removing.id, revision: removing.revision, confirmation })
          }
        />
      )}
    </div>
  )
}
