'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import { HeaderDraftConfig, NavTree, validTrackingCode } from '@cms/schema'
import { currentSession } from '../../../../lib/session.ts'
import { getGlobalElementsWorkspace } from '../../../../lib/queries.ts'
import { saveHeaderMenuDraft } from '../../../../lib/header-menu.ts'
import { installNationalFrames } from '../../../../lib/sawso-frame.ts'
export async function prepareNationalHeader(siteId: string) {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin)
    return { ok: false as const, message: 'Only a Super admin can prepare a template update.' }
  try {
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const allowed = (
        await client.query(
          "SELECT app.can_administer_site($1) AND NOT EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id IN(h.draft_version_id,h.published_version_id) WHERE h.site_id=$1 AND v.bundle ? 'original') AS allowed",
          [siteId],
        )
      ).rows[0]?.allowed
      if (!allowed) throw new DomainError('not_authorized', 'This template update is unavailable for this site.')
      await installNationalFrames(client)
    })
    const workspace = await getGlobalElementsWorkspace(session.principal.userId, siteId)
    if (!workspace) throw Error('unavailable')
    return { ok: true as const, components: workspace.components }
  } catch {
    return {
      ok: false as const,
      message: 'The header update could not be prepared. Your saved choices are safe. Try again.',
    }
  }
}
export async function saveHeaderMenu(input: {
  siteId: string
  headerRevision: number
  footerRevision: number
  menuRevision: number
  header: unknown
  menu: unknown
  mode: 'auto' | 'manual'
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving.' }
  const header = HeaderDraftConfig.safeParse(input.header)
  const menu = NavTree.safeParse(input.menu)
  if (!header.success || !menu.success || !['auto', 'manual'].includes(input.mode))
    return { ok: false as const, message: 'Check the menu names and destinations before saving.' }
  if (header.data.schemaVersion === 2) {
    for (const value of Object.values(header.data.component.values))
      if (
        value &&
        typeof value === 'object' &&
        'trackingCode' in value &&
        (typeof value.trackingCode !== 'string' || !validTrackingCode(value.trackingCode))
      )
        return {
          ok: false as const,
          message: 'Use tracking parameters such as utm_source=site, or leave the tracking code empty.',
        }
  }
  try {
    const result = await mapErrors(() =>
      asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
        saveHeaderMenuDraft(client, { ...input, header: header.data, menu: menu.data }),
      ),
    )
    revalidatePath(`/sites/${input.siteId}/header`)
    revalidatePath(`/sites/${input.siteId}/publishing`)
    return {
      ok: true as const,
      ...result,
      message: 'Header & menu draft saved. Visitors still see the published version.',
    }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The save could not be confirmed. Your changes are still here. Reload to compare before trying again.',
    }
  }
}
