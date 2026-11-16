'use client'
import type { DnsRecord } from '@cms/platform'
import { Button } from '../../../../components/ui/button.tsx'
import { Badge } from '../../../../components/ui/status-pill.tsx'
import { recordsText } from '../../../../lib/domains.ts'
import styles from './domain-styles.module.css'

export function DomainRecords({
  hostname,
  records,
  feedback,
}: {
  hostname: string
  records: DnsRecord[]
  feedback: (message: string, error?: boolean) => void
}) {
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      feedback(`${label} copied.`)
    } catch {
      feedback('Copy was unavailable. Select and copy the displayed record instead.', true)
    }
  }
  return (
    <>
      <p className={styles.muted}>
        These are the provider’s current setup instructions, not a complete inventory of your DNS. Keep working routing
        and email records even when they are not listed here.
      </p>
      <table className={styles.records} aria-label={`DNS records for ${hostname}`} role="table">
        <caption>Records for {hostname}</caption>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Type</th>
            <th scope="col">Name</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={`${record.type}-${record.name}-${index}`}>
              <td data-label="Action">
                <Badge tone={record.action === 'REMOVE' ? 'error' : 'info'}>
                  {record.action === 'REMOVE' ? 'Remove' : 'Add'}
                </Badge>
              </td>
              <td data-label="Type">
                <strong>{record.type}</strong>
              </td>
              <td data-label="Name">
                <div className={styles.recordValue}>
                  <code>{record.name}</code>
                  <Button
                    variant="tertiary"
                    size="compact"
                    aria-label={`Copy ${record.type} name ${record.name}`}
                    onClick={() => void copy(record.name, 'Record name')}
                  >
                    Copy name
                  </Button>
                </div>
              </td>
              <td data-label="Value">
                <div className={styles.recordValue}>
                  <code>{record.value}</code>
                  <Button
                    variant="tertiary"
                    size="compact"
                    aria-label={`Copy ${record.type} value for ${record.name}`}
                    onClick={() => void copy(record.value, 'Record value')}
                  >
                    Copy value
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void copy(recordsText(records), 'DNS records')}>
          Copy DNS records
        </Button>
      </div>
    </>
  )
}
