'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../../../lib/session.ts'

export async function setFrameLibraryStatus(siteId: string, definitionId: string, status: 'active' | 'retired') {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before changing the frame library.' }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(siteId) || !uuid.test(definitionId) || !['active', 'retired'].includes(status)) {
    return { ok: false, message: 'Choose a frame component and its library status.' }
  }
  try {
    await asUser({ userId: session.principal.userId }, async client => {
      const available = (
        await client.query(
          `SELECT d.id FROM section_defs d JOIN sites s ON s.id=$1
        WHERE d.id=$2 AND (d.scope='global' OR d.site_id=s.id)`,
          [siteId, definitionId],
        )
      ).rowCount
      if (!available) throw new Error('Frame unavailable')
      await client.query('SELECT app.set_frame_definition_status($1,$2)', [definitionId, status])
    })
    revalidatePath(`/sites/${siteId}/sections`)
    revalidatePath(`/sites/${siteId}/sections/frames`)
    revalidatePath(`/sites/${siteId}/global-elements`)
    return {
      ok: true,
      message:
        status === 'retired'
          ? 'Component retired. Existing site frames keep their pinned version and remain editable.'
          : 'Component restored to the frame picker.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DomainError ? error.message : 'The component could not be changed. Try again.',
    }
  }
}
