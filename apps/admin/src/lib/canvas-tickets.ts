import type { ThemeTokens, HeaderConfig, FooterConfig, NavTree } from '@cms/schema'
import { DomainError } from '@cms/domain'
import 'server-only'
import { asUser } from '@cms/platform'
import { buildPreview } from './queries.ts'
import { publicSiteOrigin } from './public-site-url.ts'
import type { CanvasOpenInput } from './canvas-ticket-handler.ts'
const unavailable = () => new DomainError('not_found', 'This editing preview is unavailable.')
export async function openCanvasTicket(
  user: string,
  page: string,
  input: CanvasOpenInput,
  look?: { tokens: ThemeTokens; header: HeaderConfig; footer: FooterConfig; menu: NavTree },
) {
  const site = await asUser(
    { userId: user },
    async client =>
      (
        await client.query<{ site_id: string; staging_hostname: string }>(
          "SELECT v.site_id,s.staging_hostname FROM page_versions v JOIN pages p ON p.id=v.page_id AND p.site_id=v.site_id JOIN sites s ON s.id=v.site_id WHERE v.id=$1 AND p.id=$2 AND p.archived_at IS NULL AND s.status<>'archived'",
          [input.versionId, page],
        )
      ).rows[0],
  )
  if (!site) throw unavailable()
  const origin = publicSiteOrigin(site.staging_hostname)
  if (!origin || origin === input.parentOrigin) throw unavailable()
  const preview = await buildPreview(user, input.versionId, site.site_id, input.sitePreview === 'draft', true)
  if (!preview) throw unavailable()
  const lists = preview.manifest.sections.flatMap((section, index) =>
    (section.def.slots ?? []).flatMap(slot => {
      const value = section.instance.values?.[slot.id]
      return slot.kind === 'repeat' &&
        value &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'collection'
        ? [{ section: index, slot: slot.id, value }]
        : []
    }),
  )
  const ticket = await asUser(
    { userId: user },
    async client =>
      (
        await client.query<{ token: string; expires_at: Date }>(
          look
            ? 'SELECT * FROM app.create_site_look_canvas_ticket($1,$2,$3,$4,$5)'
            : 'SELECT * FROM app.create_canvas_ticket($1,$2,$3,$4,$5,$6)',
          look
            ? [input.versionId, input.parentOrigin, input.channel, JSON.stringify(lists), JSON.stringify(look)]
            : [
                input.versionId,
                input.sitePreview === 'draft',
                input.parentOrigin,
                input.channel,
                input.showHidden,
                JSON.stringify(lists),
              ],
        )
      ).rows[0],
  )
  if (!ticket) throw unavailable()
  return {
    href: `${origin}/__cms/canvas/${ticket.token}`,
    token: ticket.token,
    expiresAt: new Date(ticket.expires_at).toISOString(),
  }
}
export async function renewCanvasTicket(user: string, page: string, token: string) {
  const expiry = await asUser(
    { userId: user },
    async client =>
      (await client.query<{ value: Date }>('SELECT app.renew_canvas_ticket($1,$2) AS value', [page, token])).rows[0]
        ?.value,
  )
  if (!expiry) throw unavailable()
  return { expiresAt: new Date(expiry).toISOString() }
}
