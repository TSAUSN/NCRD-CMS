'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { authProvider, currentSession } from '../../lib/session.ts'
import { recentlyAuthenticated, type SiteAssignment } from '../../lib/people.ts'

export type PeopleResult = { ok: boolean; message: string; reauthenticate?: boolean }

async function manage(command: (userId: string) => Promise<void>, message: string): Promise<PeopleResult> {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin) return { ok: false, message: 'Only a super admin can manage people.' }
  if (authProvider().name !== 'local' && !recentlyAuthenticated(session.authenticatedAt)) {
    return {
      ok: false,
      reauthenticate: true,
      message: 'Please confirm your sign-in in another tab, then try again. Your changes will stay here.',
    }
  }
  try {
    await command(session.principal.userId)
    revalidatePath('/people')
    return { ok: true, message }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The change could not be confirmed. Reload to check the current account before trying again.',
    }
  }
}

/** Add audited product access without promising an invitation or creating an
 * authentication identity. The person must still verify their normal sign-in. */
export async function addPerson(input: {
  email: string
  name: string
  memberships: SiteAssignment[]
}): Promise<PeopleResult> {
  return manage(async userId => {
    await asUser({ userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.add_person($1,$2,$3)', [input.email, input.name, JSON.stringify(input.memberships)]),
    )
  }, 'Person and site access added. No invitation email was sent. They can use the normal sign-in once email delivery is configured.')
}

export async function invitePerson(input: {
  email: string
  name: string
  memberships: SiteAssignment[]
}): Promise<PeopleResult> {
  return manage(async userId => {
    if (process.env['INVITATION_EMAIL_ENABLED'] === 'false')
      throw new DomainError('invalid_state', 'Team invitation emails are off for this pilot.')
    await asUser({ userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.invite_user($1,$2,$3)', [input.email, input.name, JSON.stringify(input.memberships)]),
    )
  }, 'Account and site access created. The invitation is queued for delivery.')
}

export async function updatePerson(input: {
  id: string
  revision: string
  name: string
  status: string
  memberships: SiteAssignment[]
}): Promise<PeopleResult> {
  return manage(async userId => {
    await asUser({ userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.update_person($1,$2,$3,$4,$5)', [
        input.id,
        input.revision,
        input.name,
        input.status,
        JSON.stringify(input.memberships),
      ]),
    )
  }, 'Account access saved. The updated permissions apply on the next request.')
}

export async function resendInvitation(id: string, revision: string): Promise<PeopleResult> {
  return manage(async userId => {
    if (process.env['INVITATION_EMAIL_ENABLED'] === 'false')
      throw new DomainError('invalid_state', 'Team invitation emails are off for this pilot.')
    await asUser({ userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.resend_invitation($1,$2)', [id, revision]),
    )
  }, 'A new invitation is queued for delivery.')
}
