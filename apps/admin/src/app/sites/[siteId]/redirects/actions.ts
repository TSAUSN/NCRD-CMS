'use server'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { currentSession } from '../../../../lib/session.ts'
import { importRedirectsInTransaction } from '../../../../lib/redirects.ts'
import { type RedirectImportRow } from '../../../../lib/redirect-import.ts'
const failure = (error: unknown) => ({
  ok: false as const,
  message:
    error instanceof DomainError
      ? error.message
      : 'The redirects could not be saved. Check the addresses and try again.',
})
export async function changeRedirect(input: {
  siteId: string
  id: string | null
  revision: string
  oldPath: string
  pageId: string
  remove?: boolean
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before changing redirects.' }
  try {
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      input.remove
        ? client.query('SELECT app.remove_site_redirect($1,$2,$3)', [input.siteId, input.id, input.revision])
        : client.query('SELECT app.save_site_redirect($1,$2,$3,$4,$5)', [
            input.siteId,
            input.id,
            input.revision,
            input.oldPath,
            input.pageId,
          ]),
    )
    revalidatePath('/sites/' + input.siteId + '/redirects')
    return {
      ok: true as const,
      message: input.remove ? 'Redirect removed.' : 'Redirect saved. It works when its destination page is published.',
    }
  } catch (error) {
    return failure(error)
  }
}
export async function importRedirects(input: {
  siteId: string
  source: string
  expected: Pick<RedirectImportRow, 'oldPath' | 'id' | 'revision'>[]
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before importing redirects.' }
  try {
    const count = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      return importRedirectsInTransaction(client, input.siteId, input.source, input.expected)
    })
    revalidatePath('/sites/' + input.siteId + '/redirects')
    return {
      ok: true as const,
      message:
        count + ' ' + (count === 1 ? 'redirect' : 'redirects') + ' imported. Existing matching redirects were kept.',
    }
  } catch (error) {
    return failure(error)
  }
}
