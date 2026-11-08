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
