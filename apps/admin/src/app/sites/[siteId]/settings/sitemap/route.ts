import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { sitemapXml } from '@cms/renderer'
import { getSite } from '../../../../../lib/queries.ts'
import { currentSession } from '../../../../../lib/session.ts'
import { publicSiteOrigin } from '../../../../../lib/public-site-url.ts'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (
    !site ||
    site.status === 'archived' ||
    site.original_design ||
    (!session.principal.isSuperAdmin && session.principal.memberships.get(siteId) !== 'site_admin')
  )
    notFound()
  const origin = site.primary_hostname ? 'https://' + site.primary_hostname : publicSiteOrigin(site.staging_hostname)
  if (!origin)
    return new Response('Add a site address before viewing its sitemap.', {
      status: 409,
      headers: { 'cache-control': 'no-store, private', 'x-robots-tag': 'noindex, nofollow' },
    })
  const routes = await asUser(
    { userId: session.principal.userId },
    async client =>
      (
        await client.query<{ path: string; updatedAt: Date }>(
          `SELECT path,updated_at AS "updatedAt" FROM published_routes
           WHERE site_id=$1 AND page_id IN (SELECT page_id FROM app.release_readiness_pages($1))
           ORDER BY path`,
          [siteId],
        )
      ).rows,
  )
  return new Response(sitemapXml(origin, routes), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
    },
  })
}
