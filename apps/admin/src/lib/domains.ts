import type { DnsRecord } from '@cms/platform'
export type DomainRow = {
  id: string
  hostname_normalized: string
  kind: string
  status: string
  revision: string
  dns_records: DnsRecord[] | null
  last_checked_at: string | null
  error_detail: string | null
  removed_at: string | null
  redirect_hostname: string | null
  events: { status: string; detail: string | null; at: string }[]
}
export const DOMAIN_ROWS_SQL = `SELECT d.id,d.hostname_normalized,d.kind,d.status,d.revision::text,d.dns_records,
  d.last_checked_at::text,d.error_detail,d.removed_at::text,target.hostname_normalized AS redirect_hostname,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('status',e.status,'detail',e.detail,'at',e.created_at) ORDER BY e.created_at DESC)
    FROM(SELECT * FROM domain_events WHERE domain_id=d.id ORDER BY created_at DESC LIMIT 15)e),'[]') AS events
  FROM domains d LEFT JOIN domains target ON target.id=d.redirect_to_domain_id WHERE d.site_id=$1 ORDER BY d.created_at,d.hostname_normalized`
export const domainStatusLabel = (status: string) =>
  ({
    pending_dns: 'Waiting for DNS',
    verifying: 'Verifying ownership',
    issuing_cert: 'Issuing certificate',
    live: 'Live',
    error: 'Needs attention',
    removing: 'Removing',
    removed: 'Removed',
  })[status] ?? status
export function recordsText(records: DnsRecord[]): string {
  return records.map(r => `${r.action === 'REMOVE' ? 'Remove' : 'Add'}\t${r.type}\t${r.name}\t${r.value}`).join('\n')
}

/** Native hosted test addresses are distinct from loopback-only previews. */
export function stagingAddressStatusLabel(hostname: string, status: string): string {
  if (/(^|\.)localhost$/.test(hostname)) return 'Local preview'
  return { ready: 'Ready', preparing: 'Preparing', error: 'Needs attention' }[status] ?? 'Not prepared'
}
