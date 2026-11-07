import { resolveHost, resolveRequestHost } from '../../lib/routing.ts'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const host = resolveRequestHost(request.headers)
  const site = host ? await resolveHost(host) : null

  // An unknown host gets a blanket disallow rather than a 404: there is
  // nothing here to crawl and nothing to reveal.
  const body = !site
    ? 'User-agent: *\nDisallow: /\n'
    : site.isStaging
      ? // Staging hosts serve immediately and stay out of the index.
        'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\nSitemap: https://${host}/sitemap.xml\n`

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
  })
}
