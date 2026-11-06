import { sitemapXml } from '@cms/renderer'
import { resolveHost, resolveRequestHost, siteRoutes } from '../../lib/routing.ts'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const host = resolveRequestHost(request.headers)
  const site = host ? await resolveHost(host) : null
  if (!host || !site || site.isStaging) {
    // No sitemap for an unknown or noindex host.
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  }

  const routes = await siteRoutes(host)
  return new Response(sitemapXml('https://' + host, routes), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
  })
}
