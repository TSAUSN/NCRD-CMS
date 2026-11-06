'use server'

import { revalidatePath } from 'next/cache'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../../lib/session.ts'
import {
  getReleaseRecoveryReview,
  getPreparedReleaseRecovery,
  prepareReleaseRecovery,
  type RecoveryReview,
  type PreparedRecovery,
} from '../../../../lib/release-recovery.ts'

type Failure = { ok: false; message: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export async function reviewRecovery(
  releaseId: string,
): Promise<Failure | { ok: true; review: RecoveryReview; prepared: PreparedRecovery | null }> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before reviewing recovery.' }
  if (!UUID.test(releaseId)) return { ok: false, message: 'Choose an applied release from this site’s history.' }
  try {
    const [review, prepared] = await Promise.all([
      getReleaseRecoveryReview(session.principal.userId, releaseId),
      getPreparedReleaseRecovery(session.principal.userId, releaseId),
    ])
    return { ok: true, review, prepared }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DomainError ? error.message : 'The recovery review could not be loaded. Try again.',
    }
  }
}
export async function prepareRecovery(
  requestId: string,
  releaseId: string,
  expectedState: unknown,
): Promise<Failure | { ok: true; recovery: PreparedRecovery }> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before preparing recovery drafts.' }
  if (!UUID.test(requestId) || !UUID.test(releaseId))
    return { ok: false, message: 'Refresh the recovery review before trying again.' }
  try {
    if (new TextEncoder().encode(JSON.stringify(expectedState) ?? '').length > 1_000_000)
      return { ok: false, message: 'The recovery review is too large. Refresh it before trying again.' }
    const recovery = await prepareReleaseRecovery(session.principal.userId, requestId, releaseId, expectedState)
    revalidatePath(`/sites/${recovery.siteId}/publishing`)
    return { ok: true, recovery }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'Recovery preparation could not be confirmed. Retry this same preparation to retrieve its result.',
    }
  }
}
