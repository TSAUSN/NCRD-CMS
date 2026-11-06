'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@cms/domain'
import { asUser } from '@cms/platform'
import { currentSession, authProvider } from '../../../../lib/session.ts'
import { recentlyAuthenticated } from '../../../../lib/people.ts'

export async function changeSiteSettings(input: { siteId: string; revision: string; name: string; archive: boolean }) {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before changing site settings.', reauthenticate: true }
  if (input.archive && authProvider().name !== 'local' && !recentlyAuthenticated(session.authenticatedAt)) {
    return {
      ok: false,
      message: 'Confirm your sign-in in another tab before archiving this site.',
      reauthenticate: true,
    }
  }
  try {
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      input.archive
        ? client.query('SELECT app.archive_site($1,$2)', [input.siteId, input.revision])
        : client.query('SELECT app.update_site_name($1,$2,$3)', [input.siteId, input.revision, input.name]),
    )
    revalidatePath('/', 'layout')
    return {
      ok: true,
      message: input.archive ? 'Site archived. Its public addresses no longer serve the site.' : 'Site name saved.',
      reauthenticate: false,
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError ? error.message : 'The change could not be confirmed. Reload before trying again.',
      reauthenticate: false,
    }
  }
}
