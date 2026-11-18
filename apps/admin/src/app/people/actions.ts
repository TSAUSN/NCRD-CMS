'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { authProvider, currentSession } from '../../lib/session.ts'
import { recentlyAuthenticated, type SiteAssignment } from '../../lib/people.ts'
import { DISASTER_MANAGER_TOOL } from '../../lib/people-access.ts'

type Client = { query: <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }> }

/** Grants or removes Disaster Manager inside the same transaction as the rest of the save. */
async function setDisasterManager(client: Client, personId: string, enabled: boolean): Promise<void> {
  const { rows } = await client.query<{ revision: string; granted: boolean }>(
    `SELECT u.revision,EXISTS(SELECT 1 FROM tool_grants g WHERE g.user_id=u.id AND g.tool=$2) AS granted
       FROM app_users u WHERE u.id=$1`,
    [personId, DISASTER_MANAGER_TOOL],
  )
  const current = rows[0]
  if (!current || current.granted === enabled) return
  await client.query('SELECT app.set_tool_grant($1,$2,$3,$4)', [
    personId,
    current.revision,
    DISASTER_MANAGER_TOOL,
    enabled,
  ])
}

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
  disasterManager?: boolean
}): Promise<PeopleResult> {
  if (!input.memberships.length && input.disasterManager) return addDisasterManager(input)
  return manage(async userId => {
    await asUser({ userId, requestId: randomUUID() }, async client => {
      const id = (
        await client.query<{ id: string }>('SELECT app.add_person($1,$2,$3) AS id', [
          input.email,
          input.name,
          JSON.stringify(input.memberships),
        ])
      ).rows[0]!.id
      if (input.disasterManager) await setDisasterManager(client, id, true)
    })
  }, 'Person and site access added. No invitation email was sent. They can use the normal sign-in once email delivery is configured.')
}

/** A Disaster Manager with no site access. No invitation email is sent; they use the normal sign-in. */
function addDisasterManager(input: { email: string; name: string }): Promise<PeopleResult> {
  return manage(async userId => {
    await asUser({ userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.add_tool_person($1,$2,$3)', [input.email, input.name, DISASTER_MANAGER_TOOL]),
    )
  }, 'Disaster Manager added. No invitation email was sent. They can sign in with their email address and will see only Current Disasters.')
}

export async function invitePerson(input: {
  email: string
  name: string
  memberships: SiteAssignment[]
  disasterManager?: boolean
}): Promise<PeopleResult> {
  if (!input.memberships.length && input.disasterManager) return addDisasterManager(input)
  return manage(async userId => {
    if (process.env['INVITATION_EMAIL_ENABLED'] === 'false')
      throw new DomainError('invalid_state', 'Team invitation emails are off for this pilot.')
    await asUser({ userId, requestId: randomUUID() }, async client => {
      const id = (
        await client.query<{ id: string }>('SELECT app.invite_user($1,$2,$3) AS id', [
          input.email,
          input.name,
          JSON.stringify(input.memberships),
        ])
      ).rows[0]!.id
      if (input.disasterManager) await setDisasterManager(client, id, true)
    })
  }, 'Account and site access created. The invitation is queued for delivery.')
}

export async function updatePerson(input: {
  id: string
  revision: string
  name: string
  status: string
  memberships: SiteAssignment[]
  disasterManager?: boolean
}): Promise<PeopleResult> {
  return manage(async userId => {
    await asUser({ userId, requestId: randomUUID() }, async client => {
      await client.query('SELECT app.update_person($1,$2,$3,$4,$5)', [
        input.id,
        input.revision,
        input.name,
        input.status,
        JSON.stringify(input.memberships),
      ])
      if (input.disasterManager !== undefined) await setDisasterManager(client, input.id, input.disasterManager)
    })
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
