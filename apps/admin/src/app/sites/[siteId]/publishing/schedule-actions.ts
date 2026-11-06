'use server'

import { revalidatePath } from 'next/cache'
import { DomainError, READINESS_POLICY_VERSION, type ReadinessReport } from '@cms/domain'
import { asUser, evaluateVersionReadiness } from '@cms/platform'
import { currentSession } from '../../../../lib/session.ts'
import { scheduleFindingsReviewed, schedulingConfigured } from '../../../../lib/scheduling.ts'

export type ScheduleResult = { ok: boolean; message: string; report?: ReadinessReport }
export async function schedulePage(input: {
  pageId: string
  revision: string
  versionId: string
  action: 'publish' | 'unpublish'
  runAt: string
  override: string
  requestId: string
  reviewedFindings?: ReadinessReport['findings']
}): Promise<ScheduleResult> {
  const session = await currentSession()
  if (!session || !schedulingConfigured())
    return { ok: false, message: 'Scheduling has not been activated for this installation.' }
  if (!Number.isFinite(Date.parse(input.runAt))) return { ok: false, message: 'Choose a valid date and time.' }
  try {
    const outcome = await asUser({ userId: session.principal.userId, requestId: input.requestId }, async client => {
      const report =
        input.action === 'publish' ? await evaluateVersionReadiness(client, input.versionId, 'member') : null
      if (report && !report.ok && !input.override.trim())
        return { ok: false, message: 'Fix these checks or record a reason for the exception.', report }
      if (report && input.override.trim() && !scheduleFindingsReviewed(report.findings, input.reviewedFindings)) {
        return {
          ok: false,
          message: 'The findings changed. Review this updated list before confirming an exception.',
          report,
        }
      }
      await client.query('SELECT app.schedule_page_action($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        input.pageId,
        input.revision,
        input.versionId,
        input.action,
        input.runAt,
        READINESS_POLICY_VERSION,
        report ? JSON.stringify(report.findings) : null,
        input.override || null,
        input.requestId,
      ])
      return { ok: true, message: 'Schedule saved for this exact version. Changes made afterward are not included.' }
    })
    if (outcome.ok) revalidatePath('/', 'layout')
    return outcome
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The schedule could not be confirmed. Check the queue before retrying.',
    }
  }
}
export async function cancelSchedule(id: string): Promise<ScheduleResult> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before cancelling a schedule.' }
  try {
    await asUser({ userId: session.principal.userId }, client =>
      client.query('SELECT app.cancel_page_schedule($1)', [id]),
    )
    revalidatePath('/', 'layout')
    return { ok: true, message: 'Schedule cancelled.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DomainError ? error.message : 'Cancellation could not be confirmed. Refresh the queue.',
    }
  }
}

export async function retrySchedule(
  input: import('../../../../lib/schedule-retry.ts').ScheduleRetryInput,
): Promise<ScheduleResult> {
  const session = await currentSession()
  if (!session || !schedulingConfigured())
    return { ok: false, message: 'Scheduling has not been activated for this installation.' }
  if (!Number.isFinite(Date.parse(input.runAt)))
    return { ok: false, message: 'Choose a valid date and time for the new attempt.' }
  try {
    const { retryScheduledPage } = await import('../../../../lib/schedule-retry.ts')
    const outcome = await asUser({ userId: session.principal.userId, requestId: input.requestId }, client =>
      retryScheduledPage(client, input),
    )
    if (outcome.ok) revalidatePath('/', 'layout')
    return outcome
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The retry could not be confirmed. Refresh the schedule history before trying again.',
    }
  }
}
