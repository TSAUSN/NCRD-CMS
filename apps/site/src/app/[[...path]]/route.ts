import { storyWidgetQuery } from '@cms/renderer'
import { serveReviewedPath } from '../../lib/reviewed-path.ts'
import { publicPageResponse } from '../../lib/public-page.ts'
// Every public page. A route handler rather than a React page on purpose: the
// renderer already produces a complete document, and returning it verbatim
// means the public output contains exactly what packages/renderer emits — no
// framework wrapper, no hydration bundle, nothing required for the content to
// be there (SPEC §6.8, D10).
import { observePublicResponse } from '../../lib/observability.ts'
import {
  htmlAddressTarget,
  neutralNotFound,
  resolveRequestHost,
  resolveRoute,
  resolveRedirect,
} from '../../lib/routing.ts'
import { REVALIDATE_PUBLIC } from '../../lib/http-cache.ts'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return observePublicResponse(() => serve(request))
}

async function serve(request: Request): Promise<Response> {
  const host = resolveRequestHost(request.headers)
  if (!host) return neutralNotFound()

  const url = new URL(request.url)
  const file = await serveReviewedPath(request, host, url.pathname)
  if (file) return file
  const route = await resolveRoute(host, url.pathname)
  if (!route) {
    const redirect = await resolveRedirect(host, url.pathname)
    if (redirect)
      return new Response(null, {
        status: 308,
        headers: { location: redirect + url.search, 'cache-control': 'no-store' },
      })
    // V1 addressed its pages as files (`/explore-data.html`, `/index.html`).
    // Bookmarks and search results keep those addresses after cutover, so a
    // `.html` address whose clean address is a live page moves there for good.
    const clean = htmlAddressTarget(url.pathname)
    if (clean && (await resolveRoute(host, clean))) {
      return new Response(null, {
        status: 308,
        headers: { location: `${clean}${url.search}`, 'cache-control': REVALIDATE_PUBLIC },
      })
    }
    return neutralNotFound()
  }

  // www ⇄ apex: a redirect domain says where it points, and we send the reader
  // there rather than serving the same content on two hostnames (SPEC §6.10).
  if (route.redirectTo && route.redirectTo !== host) {
    return new Response(null, {
      status: 308,
      // Keep the resolved host/path authoritative and carry the framework's
      // query through without dropping repeated keys or their values.
      headers: {
        location: `https://${route.redirectTo}${route.path}${url.search}`,
        'cache-control': REVALIDATE_PUBLIC,
      },
    })
  }

  return publicPageResponse(request, route, {
    storyWidgets: { path: url.pathname, query: storyWidgetQuery(url.searchParams) },
    newsroom: {
      view: url.searchParams.get('view') ?? undefined,
      q: url.searchParams.get('q')?.slice(0, 120),
      sector: url.searchParams.get('sector')?.slice(0, 80),
      region: url.searchParams.get('region')?.slice(0, 80),
      page: url.searchParams.get('page')?.slice(0, 10),
    },
    query: url.searchParams.get('q')?.slice(0, 120),
    contactSent: url.searchParams.get('contact') === 'sent',
  })
}

export async function HEAD(request: Request): Promise<Response> {
  const response = await GET(request)
  return new Response(null, { status: response.status, headers: response.headers })
}
