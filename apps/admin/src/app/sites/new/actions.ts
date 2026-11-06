'use server'

import { revalidatePath } from 'next/cache'
import { DomainError } from '@cms/domain'
import { SiteSetup } from '@cms/schema'
import { authProvider, currentSession } from '../../../lib/session.ts'
import { recentlyAuthenticated } from '../../../lib/people.ts'
import { createSiteFromSetup } from '../../../lib/site-creation.ts'

export type SiteCreationResult =
  | { ok: true; siteId: string; hostname: string }
  | { ok: false; message: string; reauthenticate?: boolean }

export async function createSite(requestId: string, input: unknown): Promise<SiteCreationResult> {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin) return { ok: false, message: 'Only a super admin can create sites.' }
  if (authProvider().name !== 'local' && !recentlyAuthenticated(session.authenticatedAt)) {
    return {
      ok: false,
      reauthenticate: true,
      message: 'Confirm your sign-in in another tab, then create the site. Your setup will stay here.',
    }
  }
  const parsed = SiteSetup.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the site setup.' }
  try {
    const result = await createSiteFromSetup(session.principal.userId, requestId, parsed.data)
    revalidatePath('/', 'layout')
    return { ok: true, ...result }
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message }
    if ((error as { code?: string }).code === '23505')
      return { ok: false, message: 'That short address is already in use. Choose another address.' }
    return {
      ok: false,
      message:
        'Site creation could not be confirmed. Try again with this setup; the same request will not create a duplicate site.',
    }
  }
}
