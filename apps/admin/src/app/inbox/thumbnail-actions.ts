'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../lib/session.ts'

export async function retryThumbnail(failedId: string): Promise<{ ok: boolean; message: string; retryId?: string }> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before retrying a section preview.' }
  if (!/^[1-9][0-9]{0,18}$/.test(failedId))
    return { ok: false, message: 'The failed delivery reference is invalid. Reload the Inbox.' }
  try {
    const result = await asUser(
      { userId: session.principal.userId },
      async client =>
        (
          await client.query<{ retry_id: string; retry_status: string }>(
            'SELECT * FROM app.retry_thumbnail_delivery($1)',
            [failedId],
          )
        ).rows[0]!,
    )
    revalidatePath('/inbox')
    revalidatePath('/')
    revalidatePath('/activity')
    return {
      ok: true,
      retryId: result.retry_id,
      message:
        result.retry_status === 'delivered'
          ? 'The section preview has already recovered. Its earlier failure stays in the history.'
          : 'Section preview retry queued. Refresh after the worker finishes to see the result. The earlier failure is preserved.',
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The retry could not be confirmed. Try again; the same failed delivery will not create duplicate work.',
    }
  }
}
