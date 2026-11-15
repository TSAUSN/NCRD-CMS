'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { type DomainRow } from '../../../../lib/domains.ts'
import { Button } from '../../../../components/ui/button.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { Field } from '../../../../components/ui/field.tsx'
import { Disclosure } from '../../../../components/ui/disclosure.tsx'
import { DomainCard } from './domain-card.tsx'
import styles from './domain-styles.module.css'
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
    if (!rows.some(row => !row.removed_at && !['live', 'error'].includes(row.status))) return
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
  function feedback(message: string, failed = false) {
    setError(failed ? message : '')
    setNotice(failed ? '' : message)
  }
  return (
    <div className={styles.workspace}>
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
      <div className={styles.heading}>
        <div>
          <h2>Connected addresses</h2>
          <p className={styles.muted}>Follow each address from setup to a secure, live website.</p>
        </div>
        <Button variant="secondary" onClick={() => router.refresh()} disabled={pending}>
          Refresh domain status
        </Button>
      </div>
      {rows.length === 0 && (
        <Card density="summary">
          <p>No custom domains yet. Connect an address below to get its exact DNS instructions.</p>
        </Card>
      )}
      {rows.map(row => (
        <DomainCard row={row} key={row.id} feedback={feedback}>
          {canManage && !row.removed_at && row.kind !== 'staging' && (
            <div className={styles.actions}>
              {canConnect && (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => run({ action: 'check', siteId, id: row.id, revision: row.revision })}
                >
                  {row.status === 'removing' ? 'Retry cleanup' : 'Verify now'}
                </Button>
              )}
              {row.status === 'live' && row.kind !== 'primary' && (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => run({ action: 'primary', siteId, id: row.id, revision: row.revision })}
                >
                  Make primary
                </Button>
              )}
              {row.status !== 'removing' && (
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    setError('')
                    setConfirmation('')
                    setRemoving(row)
                  }}
                >
                  Remove domain
                </Button>
              )}
            </div>
          )}
        </DomainCard>
      ))}
      {canManage && canConnect && !archived && (
        <Card
          title="Connect an address"
          description="Use a domain or subdomain you control. We’ll generate the records for its DNS provider."
          density="settings"
        >
          <form
            className={styles.workspace}
            onSubmit={event => {
              event.preventDefault()
              run({ action: 'add', siteId, hostname, withWww })
            }}
          >
            <div className={styles.connect}>
              <Field id="domain-hostname" label="Hostname" help="Full website address, without https:// or a path.">
                <input
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="test-one.example.org"
                  value={hostname}
                  onChange={event => setHostname(event.target.value)}
                  disabled={pending}
                />
              </Field>
              <Button type="submit" loading={pending}>
                Connect domain
              </Button>
            </div>
            <label className={styles.choice}>
              <input
                type="checkbox"
                checked={withWww}
                disabled={pending}
                onChange={event => setWithWww(event.target.checked)}
              />
              Also connect the matching www or non-www address
            </label>
            <p className={styles.muted}>
              For a test subdomain, leave this unchecked unless you also need its www address. The first custom address
              becomes primary; additional addresses redirect to it until you choose Make primary.
            </p>
          </form>
        </Card>
      )}
      <section aria-label="Connection checklist">
        <Disclosure title="Before you change DNS">
          <ol>
            <li>
              <strong>Your domain owner:</strong> confirm the full website address and the DNS provider where its
              records are managed.
            </li>
            <li>
              <strong>Your hosting operator:</strong> make the CMS publicly reachable with domain verification and
              HTTPS. A local preview cannot receive public visitors.
            </li>
            <li>
              <strong>Use the exact records here:</strong> connect the address, wait for its instructions, add those
              records at your provider, then choose Verify now.
            </li>
          </ol>
          <p>
            Keep the existing nameservers and unrelated records, especially email records. Nameservers are not website
            addresses and do not belong in the Hostname field. Do not guess an IP address.
          </p>
          <Link href="/help?topic=domains">Read domain setup help</Link>
        </Disclosure>
      </section>
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
