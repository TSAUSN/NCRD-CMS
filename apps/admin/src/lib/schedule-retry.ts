import { DomainError, READINESS_POLICY_VERSION, type ReadinessReport } from '@cms/domain'
import { evaluateVersionReadiness, type Queryable } from '@cms/platform'
import { scheduleFindingsReviewed } from './scheduling.ts'

export type ScheduleRetryInput = {
  id: string
  revision: string
  runAt: string
  override: string
  requestId: string
  reviewedFindings?: ReadinessReport['findings']
}
export type ScheduleRetryResult = { ok: boolean; message: string; report?: ReadinessReport }

/** Runs inside the authenticated transaction. The browser supplies an intention,
 * never the version/action being retried or the original actor's authority. */
export async function retryScheduledPage(client: Queryable, input: ScheduleRetryInput): Promise<ScheduleRetryResult> {
  const original = (
    await client.query<{ item_id: string; version_id: string; action: 'publish' | 'unpublish'; status: string }>(
      `
    SELECT item_id,version_id,action,status FROM scheduled_actions WHERE id=$1 AND app.can_publish(site_id)`,
      [input.id],
    )
  ).rows[0]
  if (!original) throw new DomainError('not_authorized', 'This schedule is not available for you to retry.')
  if (original.status !== 'failed') throw new DomainError('invalid_state', 'Only a failed schedule can be retried.')
  // An acknowledgement lost after COMMIT must return the saved receipt even
  // if readiness changed later. SQL still checks actor, source, time and reason.
  const receipt = (await client.query('SELECT id FROM scheduled_actions WHERE request_id=$1', [input.requestId]))
    .rows[0]
  let report: ReadinessReport | null = null
  if (!receipt && original.action === 'publish') {
    report = await evaluateVersionReadiness(client, original.version_id, 'member')
    if (!report.ok && !input.override.trim())
      return {
        ok: false,
        message: 'This saved version still needs attention. Review the findings before scheduling another attempt.',
        report,
      }
    if (input.override.trim() && !scheduleFindingsReviewed(report.findings, input.reviewedFindings))
      return {
        ok: false,
        message: 'The findings changed. Review this list before confirming a new exception.',
        report,
      }
  }
  await client.query('SELECT app.retry_page_schedule($1,$2,$3,$4,$5,$6,$7)', [
    input.id,
    input.revision,
    input.runAt,
    READINESS_POLICY_VERSION,
    report ? JSON.stringify(report.findings) : null,
    input.override.trim() || null,
    input.requestId,
  ])
  return {
    ok: true,
    message: 'A new attempt is scheduled for the same saved version. The failed attempt remains in history.',
  }
}
