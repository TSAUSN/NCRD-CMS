'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import {
  NationalTemplateSelection as selection,
  NationalSiteStart as startInput,
  NationalStartRequestId,
} from '@cms/schema'
import { asUser, configuredMediaStore } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { currentSession, authProvider } from '../../../../lib/session.ts'
import { recentlyAuthenticated } from '../../../../lib/people.ts'
import {
  previewNationalTemplate,
  applyNationalTemplate,
  nationalTemplateSites,
  reviewNationalSite,
  type NationalSiteReview,
} from '../../../../lib/national-template.ts'
import { startNationalSite } from '../../../../lib/national-copy.ts'
function message(error: unknown) {
  if (error instanceof DomainError) {
    if (/schema|section definition|stale revision/i.test(error.message))
      return 'The source page changed or its layout is unavailable. Review the source page, then try again.'
    return error.message
  }
  return (error as { code?: string }).code === '23505'
    ? 'That test address is already in use. Choose another.'
    : 'This could not be confirmed. Reload and try again; your saved drafts are safe.'
}
export async function reviewTemplateUpdate(): Promise<
  { ok: true; sites: NationalSiteReview[] } | { ok: false; message: string }
> {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin) return { ok: false, message: 'Only a super admin can review template updates.' }
  try {
    return await asUser({ userId: session.principal.userId }, async client => {
      const sites = []
      for (const site of await nationalTemplateSites(client))
        sites.push((await reviewNationalSite(client, site.id)).review)
      return { ok: true, sites }
    })
  } catch (error) {
    return { ok: false, message: message(error) }
  }
}
export async function createTemplateDrafts(input: unknown) {
  const session = await currentSession()
  const parsed = selection.safeParse(input)
  if (!session?.principal.isSuperAdmin)
    return { ok: false as const, message: 'Only a super admin can apply a template update.' }
  if (!parsed.success) return { ok: false as const, message: 'Review the update and choose the sites again.' }
  try {
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      applyNationalTemplate(client, parsed.data),
    )
    revalidatePath('/', 'layout')
    return { ok: true as const, ...result }
  } catch (error) {
    return { ok: false as const, message: message(error) }
  }
}
export async function createNationalSite(requestId: string, input: unknown) {
  const session = await currentSession()
  const parsed = startInput.safeParse(input)
  if (!session?.principal.isSuperAdmin) return { ok: false as const, message: 'Only a super admin can start a site.' }
  if (authProvider().name !== 'local' && !recentlyAuthenticated(session.authenticatedAt))
    return { ok: false as const, message: 'Confirm your sign-in in another tab, then return. Your setup stays here.' }
  if (!NationalStartRequestId.safeParse(requestId).success || !parsed.success)
    return { ok: false as const, message: 'Enter a name, a valid test address and a starting point.' }
  try {
    const result = await asUser({ userId: session.principal.userId, requestId }, client =>
      startNationalSite(client, requestId, parsed.data, configuredMediaStore()),
    )
    revalidatePath('/', 'layout')
    return { ok: true as const, ...result }
  } catch (error) {
    return { ok: false as const, message: message(error) }
  }
}

export async function previewTemplateSite(siteId: string) {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin)
    return { ok: false as const, message: 'Only a super admin can review the template.' }
  try {
    return {
      ok: true as const,
      ...(await asUser({ userId: session.principal.userId }, client => previewNationalTemplate(client, siteId))),
    }
  } catch (error) {
    return { ok: false as const, message: message(error) }
  }
}
