'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError, fromSqlError } from '@cms/domain'
import { currentSession } from '../../../../../lib/session.ts'
import { enableSiteStories } from '../../../../../lib/stories-enable.ts'
export async function turnOnStories(
  siteId: string,
  input: { mainLabel: string; secondaryLabel: string; publishUnreviewed: boolean },
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before turning on Stories.' }
  try {
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      enableSiteStories(client, siteId, input),
    )
    revalidatePath('/sites/' + siteId, 'layout')
    return { ok: true as const, ...result }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain?.kind === 'not_authorized'
          ? 'Only a Site admin can turn on Stories.'
          : domain instanceof DomainError
            ? domain.message
            : 'Stories could not be turned on. Check your connection, then try again.',
    }
  }
}
