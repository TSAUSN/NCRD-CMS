'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError, fromSqlError } from '@cms/domain'
import { currentSession } from '../../../../../lib/session.ts'
import { storyTagAssignments } from '../../../../../lib/stories-catalog.ts'
import { changeStoriesTags, type StoriesTagOperation } from '../../../../../lib/stories-tags.ts'
export async function changeTags(
  siteId: string,
  collectionId: string,
  revision: string,
  entryRevision: string,
  operation: StoriesTagOperation,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before saving tags.' }
  try {
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      changeStoriesTags(client, siteId, collectionId, revision, entryRevision, operation),
    )
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    revalidatePath('/sites/' + siteId + '/content')
    revalidatePath('/sites/' + siteId + '/publishing')
    return {
      ok: true as const,
      ...result,
      entries: result.entries.map(e => ({ id: e.id, values: storyTagAssignments(e.values) })),
    }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain?.kind === 'stale_revision'
          ? 'Stories changed. Reload Manage tags before saving.'
          : domain?.kind === 'not_authorized'
            ? 'Only a Site admin can manage tags.'
            : domain?.kind === 'not_found'
              ? 'Stories is unavailable.'
              : domain?.kind === 'invalid_state' && error instanceof DomainError
                ? error.message
                : 'Tags could not be saved. Check the name and keywords, then try again.',
    }
  }
}
