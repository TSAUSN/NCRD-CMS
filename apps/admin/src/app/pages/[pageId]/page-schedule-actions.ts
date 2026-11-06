'use server'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../lib/session.ts'
import { preparePageRelease } from '../../../lib/page-release.ts'
export async function preparePageSchedule(pageId: string, revision: string, versionId: string, requestId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before scheduling.' }
  try {
    const result = await preparePageRelease(session.principal.userId, pageId, revision, versionId, requestId)
    if (result.firstSiteReview)
      return {
        ok: false as const,
        firstSiteReview: true,
        message:
          'Review the first site publication before scheduling this page. Its header, menu and design need a review together.',
      }
    return { ok: true as const, siteId: result.siteId, releaseId: result.release.id }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The review could not be confirmed. Your saved draft is private. Check Publish before retrying.',
    }
  }
}
