'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../lib/session.ts'

export type RequestResult = { ok: boolean; message: string }
export async function requestSection(id: string, siteId: string, title: string, body: string): Promise<RequestResult> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before sending a request.' }
  try {
    await asUser({ userId: session.principal.userId, requestId: id }, client =>
      client.query('SELECT app.request_custom_section($1,$2,$3,$4)', [id, siteId, title, body]),
    )
    revalidatePath('/inbox')
    revalidatePath('/activity')
    return { ok: true, message: 'Request added to the inbox. Your site is unchanged; no external email was sent.' }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The request could not be confirmed. Check the inbox before retrying.',
    }
  }
}
export async function respondToRequest(
  id: string,
  revision: string,
  status: string,
  response: string,
): Promise<RequestResult> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before responding.' }
  try {
    await asUser({ userId: session.principal.userId }, client =>
      client.query('SELECT app.respond_section_request($1,$2,$3,$4)', [id, revision, status, response]),
    )
    revalidatePath('/inbox')
    revalidatePath('/activity')
    return { ok: true, message: 'Request updated. The reply is visible to this site’s team.' }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The response could not be confirmed. Reload the request before retrying.',
    }
  }
}
