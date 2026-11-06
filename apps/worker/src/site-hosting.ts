import { configuredFirebaseHosting } from '@cms/platform'
import type { Pool } from 'pg'
import { withWorkerSession, type EventHandler } from './handlers.ts'

export function createSiteHostingHandler(
  pool: Pool,
  workerId: string,
  hosting: { ensureSite(hostname: string): Promise<void> } | null = process.env['DOMAIN_PROVIDER'] === 'firebase'
    ? configuredFirebaseHosting()
    : null,
): EventHandler {
  return {
    idempotency: 'guarded',
    async handle(event) {
      if (!hosting) throw new Error('Managed site hosting is not configured')
      const job = await withWorkerSession(
        pool,
        workerId,
        async client =>
          (
            await client.query<{ job: { staging_hostname: string } | null }>(
              'SELECT app.site_hosting_job($1,$2) AS job',
              [event.id, event.lease_token],
            )
          ).rows[0]!.job,
      )
      if (job) await hosting.ensureSite(job.staging_hostname)
    },
  }
}
