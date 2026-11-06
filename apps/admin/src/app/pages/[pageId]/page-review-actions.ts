'use server'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../lib/session.ts'
import { readPageSavedReview } from '../../../lib/page-release.ts'
export async function loadPageSavedReview(pageId: string, revision: string, versionId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before reviewing this page.' }
  try {
    return { ok: true as const, ...(await readPageSavedReview(session.principal.userId, pageId, revision, versionId)) }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The saved changes could not be checked. Your draft is still here. Try again before publishing.',
    }
  }
}
