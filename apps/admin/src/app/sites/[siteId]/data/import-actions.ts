'use server'
import { currentSession } from '../../../../lib/session.ts'
import { getSite } from '../../../../lib/queries.ts'
import { readNumberFile } from '../../../../lib/number-file-fetch.ts'
export async function readPublicNumberFile(siteId: string, address: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before reading a number file.' }
  const site = await getSite(session.principal.userId, siteId)
  if (
    !site ||
    site.original_design ||
    site.status === 'archived' ||
    (!session.principal.isSuperAdmin && session.principal.memberships.get(siteId) !== 'site_admin')
  )
    return { ok: false as const, message: 'Only an Admin can read a number file for this site.' }
  try {
    return { ok: true as const, text: await readNumberFile(address) }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error ? error.message : 'The file could not be opened. Choose a downloaded file instead.',
    }
  }
}
