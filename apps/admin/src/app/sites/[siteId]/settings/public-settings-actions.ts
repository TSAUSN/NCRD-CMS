'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError, fromSqlError } from '@cms/domain'
import { SitePublicSettings } from '@cms/schema'
import { currentSession } from '../../../../lib/session.ts'
import { siteSettingsWorkspace } from '../../../../lib/site-settings.ts'
import { releaseCandidates, planSiteRelease } from '../../../../lib/releases.ts'
export async function savePublicSiteSettings(
  siteId: string,
  revision: string,
  block: 'social' | 'general' | 'search' | 'dataValues',
  value: unknown,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before saving site settings.' }
  try {
    if (!['social', 'general', 'search', 'dataValues'].includes(block))
      throw new DomainError('invalid_state', 'Choose a supported Settings tab.')
    const result = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const current = await siteSettingsWorkspace(client, siteId)
      const general =
        block === 'general'
          ? SitePublicSettings.pick({ name: true, general: true }).required({ general: true }).safeParse(value)
          : null
      if (general && !general.success) throw new DomainError('invalid_state', 'Check the General settings fields.')
      const parsed = SitePublicSettings.safeParse({
        ...current.settings,
        ...(general?.success ? general.data : { [block]: value }),
      })
      if (!parsed.success)
        throw new DomainError('invalid_state', parsed.error.issues[0]?.message ?? 'Check the settings fields.')
      const saved = (
        await client.query('SELECT app.save_site_settings_draft($1,$2,$3) AS revision', [
          siteId,
          revision,
          JSON.stringify(parsed.data),
        ])
      ).rows[0]!
      return { revision: String(saved.revision), settings: parsed.data }
    })
    revalidatePath('/sites/' + siteId + '/settings')
    revalidatePath('/sites/' + siteId + '/publishing')
    return {
      ok: true as const,
      ...result,
      message: 'Site settings draft saved. Review it in Publish before it goes live.',
    }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      conflict: domain?.kind === 'stale_revision',
      message:
        domain instanceof DomainError
          ? domain.message
          : 'The save could not be confirmed. Your fields are kept. Reload the saved settings before retrying.',
    }
  }
}
export async function prepareSiteSettingsPublication(siteId: string, revision: string, requestId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before reviewing site settings.' }
  try {
    const selection = await asUser({ userId: session.principal.userId }, async client => {
      const site = (
        await client.query(
          'SELECT initial_release_required,app.can_administer_site(id) AS allowed FROM sites WHERE id=$1 AND archived_at IS NULL',
          [siteId],
        )
      ).rows[0]
      if (!site?.allowed) throw new DomainError('not_authorized', 'Only an Admin can publish site settings.')
      if (site.initial_release_required) return null
      const choice = (await releaseCandidates(client, siteId)).find(item => item.type === 'site_settings')
      if (!choice || choice.revision !== revision)
        throw new DomainError('stale_revision', 'Site settings changed. Reload and review the saved settings again.')
      return [choice]
    })
    if (!selection)
      return {
        ok: false as const,
        firstSiteReview: true,
        message: 'This site is private. Include these settings in its first site publication.',
      }
    const release = await planSiteRelease(session.principal.userId, requestId, siteId, selection)
    return { ok: true as const, releaseId: release.id }
  } catch (error) {
    const domain = error instanceof DomainError ? error : fromSqlError(error)
    return {
      ok: false as const,
      message:
        domain instanceof DomainError
          ? domain.message
          : 'The review could not be prepared. Your saved draft is still available.',
    }
  }
}
