'use client'
import type { ReactNode } from 'react'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { Badge } from '../../../../components/ui/status-pill.tsx'
import { Disclosure } from '../../../../components/ui/disclosure.tsx'
import { IconCheck } from '../../../../components/icons.tsx'
import { domainStatusLabel, type DomainRow } from '../../../../lib/domains.ts'
import { reviewTime } from '../../../../lib/review-time.ts'
import { DomainRecords } from './domain-records.tsx'
import styles from './domain-styles.module.css'

export function DomainCard({
  row,
  children,
  feedback,
}: {
  row: DomainRow
  children: ReactNode
  feedback: (message: string, error?: boolean) => void
}) {
  const removed = Boolean(row.removed_at)
  const preparing = row.status === 'pending_dns' && !row.dns_records?.length
  const live = !removed && row.status === 'live'
  const stage =
    preparing || (row.status === 'error' && !row.dns_records?.length)
      ? 0
      : row.status === 'issuing_cert'
        ? 2
        : live
          ? 3
          : 1
  const next = preparing
    ? 'We’re preparing the exact DNS instructions for this address. Keep your existing DNS records until they appear here.'
    : row.status === 'issuing_cert'
      ? 'Your address is connected. HTTPS is being prepared; this can take up to 24 hours. You can leave this page and return later.'
      : live
        ? 'Your address is live and HTTPS is ready. Keep the working routing and verification records in place.'
        : row.status === 'error'
          ? 'Setup needs attention. Check the message below and domain setup help before changing DNS or reconnecting this address.'
          : 'Add the exact records below at your DNS provider, then choose Verify now. Automatic checks also run every 10 minutes.'
  return (
    <Card aria-label={`Domain ${row.hostname_normalized}`} density="settings">
      <div className={styles.heading}>
        <div>
          <h2 className={styles.hostname}>{row.hostname_normalized}</h2>
          <p className={styles.muted}>
            {row.kind === 'primary'
              ? 'Primary address'
              : row.kind === 'staging'
                ? 'Staging address'
                : `Redirects to ${row.redirect_hostname}`}
          </p>
        </div>
        <Badge tone={live ? 'live' : row.status === 'error' ? 'error' : removed ? 'neutral' : 'pending'}>
          {preparing && !removed ? 'Preparing DNS instructions' : domainStatusLabel(removed ? 'removed' : row.status)}
        </Badge>
      </div>
      {!removed && row.status !== 'removing' && (
        <>
          <ol className={styles.steps} aria-label={`Connection progress for ${row.hostname_normalized}`}>
            {['Prepare address', 'Verify DNS', 'Secure with HTTPS'].map((label, index) => (
              <li key={label} data-complete={index < stage} aria-current={index === stage ? 'step' : undefined}>
                {index < stage ? <IconCheck size={16} /> : <span aria-hidden="true">{index + 1}</span>}
                {label}
              </li>
            ))}
          </ol>
          <div className={styles.next}>
            <p>{next}</p>
          </div>
          {row.error_detail && (
            <p className="notice" role="note">
              {row.error_detail}
            </p>
          )}
          {(preparing || row.status === 'error') && (
            <p className={styles.muted}>
              Refreshing shows the latest status; it does not retry failed background work.{' '}
              <Link href="/help?topic=domains">Domain setup help</Link>
            </p>
          )}
        </>
      )}
      {row.status === 'removing' && !removed && (
        <p>This address has stopped serving the site. Hosting cleanup is in progress.</p>
      )}
      {row.last_checked_at && <p className={styles.muted}>Last checked: {reviewTime(row.last_checked_at)}</p>}
      {!!row.dns_records?.length && !removed && (
        <Disclosure title={live ? 'DNS instructions and verification' : 'DNS records'} open={!live}>
          <DomainRecords hostname={row.hostname_normalized} records={row.dns_records} feedback={feedback} />
          <p className={styles.muted}>
            Use the full name shown. If your provider appends your domain automatically, enter only the part before it.
            Remove only the exact conflicting records listed here. Keep unrelated email and verification records.
          </p>
        </Disclosure>
      )}
      {live && (
        <a href={`https://${row.hostname_normalized}`} target="_blank" rel="noopener noreferrer">
          Open website <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
      {children}
      {row.events.length > 0 && (
        <Disclosure title="Status history">
          <ol className={styles.history}>
            {row.events.map((event, index) => (
              <li key={index}>
                {domainStatusLabel(event.status)} · {reviewTime(event.at)}
                {event.detail ? ` — ${event.detail}` : ''}
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
    </Card>
  )
}
