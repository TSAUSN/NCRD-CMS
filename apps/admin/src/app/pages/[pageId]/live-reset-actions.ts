'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../lib/session.ts'
import { listPageSectionVersions } from '../../../lib/queries.ts'
import { resetFromLive, type LiveResetRequest } from '../../../lib/live-reset.ts'
export async function resetPageFromLive(input: LiveResetRequest) {
  const session = await currentSession()
  if (!session) return { ok: false as const, kind: 'error' as const, message: 'Sign in before restoring this page.' }
  try {
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      resetFromLive(client, input),
    )
    const definitions = await listPageSectionVersions(session.principal.userId, input.pageId)
    revalidatePath(`/pages/${input.pageId}`)
    return {
      ok: true as const,
      ...result,
      definitions,
      message: result.wholePage
        ? 'The live page is now a new draft. Earlier changes remain in page history.'
        : 'The section was reset to live in a new draft. Undo restores your previous work.',
    }
  } catch (error) {
    return error instanceof DomainError && error.kind === 'stale_revision'
      ? {
          ok: false as const,
          kind: 'conflict' as const,
          currentRevision: error.currentRevision,
          message: error.message,
        }
      : {
          ok: false as const,
          kind: 'error' as const,
          message:
            error instanceof DomainError
              ? error.message
              : 'The reset could not be confirmed. Reload before trying again.',
        }
  }
}
