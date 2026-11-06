import { asUser } from '@cms/platform'
import { DomainError, READINESS_POLICY_VERSION } from '@cms/domain'
import { executeSiteReleaseInTransaction } from './releases.ts'

/** The opaque lease resolves one stored actor and intention. Neither the HTTP
 * caller nor its cookies can choose an actor, site or release to execute. */
export async function executeLeasedRelease(id: string, lease: string): Promise<void> {
  const capability = await asUser(
    { userId: null },
    async client =>
      (
        await client.query<{ actor_id: string; release_id: string }>(
          'SELECT * FROM app.release_schedule_capability($1,$2)',
          [id, lease],
        )
      ).rows[0],
  )
  if (!capability) throw new DomainError('not_authorized', 'The scheduled release lease is unavailable.')
  await asUser({ userId: capability.actor_id, requestId: id }, async client => {
    const job = (
      await client.query<{
        job: {
          release_id: string
          override_reason: string | null
          samples_confirmed: boolean
          readiness_policy_version: number
        }
      }>('SELECT app.lock_release_schedule($1,$2) AS job', [id, lease])
    ).rows[0]!.job
    if (job.release_id !== capability.release_id)
      throw new DomainError('not_authorized', 'The scheduled release changed.')
    if (job.readiness_policy_version !== READINESS_POLICY_VERSION)
      throw new DomainError('invalid_state', 'The publishing checks changed. Review these changes again.')
    await executeSiteReleaseInTransaction(client, job.release_id, job.override_reason ?? '', job.samples_confirmed)
    await client.query('SELECT app.finish_release_schedule($1,$2)', [id, lease])
  })
}
