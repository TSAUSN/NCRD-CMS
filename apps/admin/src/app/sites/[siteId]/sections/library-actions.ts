'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../../lib/session.ts'

export async function setSectionFavourite(
  siteId: string,
  definitionId: string,
  favourite: boolean,
): Promise<{ ok: boolean; message: string }> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before changing your favourites.' }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(siteId) || !uuid.test(definitionId) || typeof favourite !== 'boolean') {
    return { ok: false, message: 'Choose a section from this site’s library.' }
  }
  try {
    await asUser({ userId: session.principal.userId }, client =>
      client.query('SELECT app.set_section_favourite($1,$2,$3)', [siteId, definitionId, favourite]),
    )
    revalidatePath(`/sites/${siteId}/sections`)
    return { ok: true, message: favourite ? 'Saved to your favourites.' : 'Removed from your favourites.' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DomainError ? error.message : 'Your change could not be saved. Try again.',
    }
  }
}

/** ADR 0010: only a super admin moves an unused definition between page content and the site frame. */
export async function setSectionPlacement(
  siteId: string,
  definitionId: string,
  placement: string,
): Promise<{ ok: boolean; message: string }> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before changing where a section is used.' }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(siteId) || !uuid.test(definitionId) || !['page', 'header', 'footer'].includes(placement)) {
    return { ok: false, message: 'Choose page section, site header or site footer.' }
  }
  try {
    await asUser({ userId: session.principal.userId }, client =>
      client.query('SELECT app.set_section_def_placement($1,$2)', [definitionId, placement]),
    )
    revalidatePath(`/sites/${siteId}/sections`)
    revalidatePath(`/sites/${siteId}/global-elements`)
    return {
      ok: true,
      message:
        placement === 'page'
          ? 'This definition is a page section again.'
          : `This definition can now be chosen as the site ${placement} in Header & footer.`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DomainError ? error.message : 'The placement could not be changed. Try again.',
    }
  }
}
