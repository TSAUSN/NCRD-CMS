import { configuredDomainProvisioner, type DomainProvisioner } from '@cms/platform'
import type { Pool } from 'pg'
import { withWorkerSession, type EventHandler, type OutboxEvent } from './handlers.ts'

type Job = {
  id: string
  site_id: string
  hostname: string
  status: string
  revision: number
  verification_token: string
  staging_hostname: string
  provider_ref: string | null
}
export function createDomainHandler(
  pool: Pool,
  workerId: string,
  provider: DomainProvisioner = configuredDomainProvisioner(),
): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event: OutboxEvent) {
      // A session lock serializes attach/check/detach across different events
      // and workers. A provider operation is never inside a DB transaction.
      const connection = await pool.connect()
      let locked = false
      const domainId = event.payload['domain_id']
      if (typeof domainId !== 'string') {
        connection.release()
        throw new Error('Domain event has no hostname reference')
      }
      try {
        locked = (
          await connection.query<{ locked: boolean }>(
            'SELECT pg_try_advisory_lock(hashtextextended($1,630)) AS locked',
            [domainId],
          )
        ).rows[0]!.locked
        if (!locked) throw new Error('Another worker is connecting this domain; retry after its operation completes')
        const job = await withWorkerSession(
          pool,
          workerId,
          async client =>
            (
              await client.query<{ job: Job | null }>('SELECT app.domain_job($1,$2) AS job', [
                event.id,
                event.lease_token,
              ])
            ).rows[0]!.job,
        )
        if (!job) return
        const site = { siteId: job.site_id, stagingHostname: job.staging_hostname, providerRef: job.provider_ref }
        if (job.status === 'removing') {
          await provider.detach(job.hostname, site)
          await record('removed', null, [], null, null)
          return
        }
        const { providerRef } = await provider.attach(job.hostname, job.site_id, site)
        const records = await provider.requiredRecords(job.hostname, site)
        const verification = { name: `_cms-verify.${job.hostname}`, value: job.verification_token }
        records.push({ type: 'TXT', ...verification })
        const result = await provider.check(job.hostname, verification, site)
        await record(result.state, providerRef, records, result.errorCode ?? null, result.errorDetail ?? null)
        async function record(
          state: string,
          ref: string | null,
          records: unknown,
          code: string | null,
          detail: string | null,
        ) {
          await withWorkerSession(pool, workerId, client =>
            client.query('SELECT app.record_domain_result($1,$2,$3,$4,$5,$6,$7,$8)', [
              event.id,
              event.lease_token,
              job!.revision,
              state,
              ref,
              JSON.stringify(records),
              code,
              detail,
            ]),
          )
        }
      } finally {
        let discard = false
        if (locked)
          await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,630))', [domainId]).catch(() => {
            discard = true
          })
        connection.release(discard)
      }
    },
  }
}
export async function requestDueDomainChecks(pool: Pool, workerId: string): Promise<void> {
  await withWorkerSession(pool, workerId, client => client.query('SELECT app.request_due_domain_checks()'))
}
