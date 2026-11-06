import 'server-only'
import { asUser, type Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { SitePublicSettings, FooterConfig, type SiteSocialAccount } from '@cms/schema'
export async function siteSettingsWorkspace(client: Queryable, siteId: string) {
  const row = (
    await client.query(
      'SELECT h.id,h.revision,h.draft_version_id,h.published_version_id,s.name,d.settings AS draft,l.settings AS live FROM site_settings h JOIN sites s ON s.id=h.site_id LEFT JOIN site_setting_versions d ON d.id=h.draft_version_id LEFT JOIN site_setting_versions l ON l.id=h.published_version_id WHERE h.site_id=$1',
      [siteId],
    )
  ).rows[0]
  if (!row) throw new DomainError('not_found', 'Site settings are unavailable.')
  const parsed = SitePublicSettings.safeParse(row.draft)
  if (
    row.draft &&
    !parsed.success &&
    !(typeof row.draft.name === 'string' && Object.keys(row.draft).every(key => key === 'name'))
  )
    throw new DomainError('invalid_state', 'The saved site settings need review. Open History before changing them.')
  const settings: SitePublicSettings = parsed.success
    ? parsed.data
    : { schemaVersion: 1 as const, name: typeof row.draft?.name === 'string' ? row.draft.name : row.name }
  const footer = FooterConfig.safeParse(
    (
      await client.query(
        "SELECT v.content FROM global_elements h JOIN global_element_versions v ON v.id=h.published_version_id WHERE h.site_id=$1 AND h.kind='footer'",
        [siteId],
      )
    ).rows[0]?.content,
  )
  const existing: SiteSocialAccount[] =
      settings.social ??
      (footer.success && footer.data.schemaVersion === 1
        ? footer.data.social.map(account => ({ ...account, handle: '', inFooter: true }))
        : []),
    services = [
      'facebook',
      'instagram',
      'x',
      'linkedin',
      'youtube',
      ...(existing.some(row => row.service === 'tiktok') ? ['tiktok'] : []),
    ] as SiteSocialAccount['service'][]
  const social = services.map(
    service => existing.find(row => row.service === service) ?? { service, url: '', handle: '', inFooter: false },
  )
  return {
    id: String(row.id),
    revision: String(row.revision),
    changed: row.draft_version_id !== row.published_version_id,
    settings,
    social,
  }
}
export function getSiteSettingsWorkspace(userId: string, siteId: string) {
  return asUser({ userId }, client => siteSettingsWorkspace(client, siteId))
}
export type SiteSettingsWorkspace = Awaited<ReturnType<typeof siteSettingsWorkspace>>
