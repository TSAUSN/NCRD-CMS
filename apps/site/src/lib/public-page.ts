import { measurePerfRender } from '@cms/platform/perf-trace'
import {
  renderedFeatures,
  type StoryWidgetContext,
  adobeFontsEnabled,
  renderPage,
  renderSiteFiles,
  governedEmbedFrameSources,
} from '@cms/renderer'
import { publicSecurityHeaders } from './public-security.ts'
import { cacheKey, siteRoutes, resolveRequestHost, type ResolvedRoute } from './routing.ts'
import { matchesEntityTag, representationTag, REVALIDATE_PUBLIC } from './http-cache.ts'
export async function publicPageResponse(
  request: Request,
  route: ResolvedRoute,
  context: {
    storyWidgets?: StoryWidgetContext
    newsroom?: { sector?: string; region?: string; page?: string; q?: string; view?: string }
    query?: string
    contactSent?: boolean
    contactError?: string
    contactValues?: Record<string, string>
  } = {},
  status = 200,
): Promise<Response> {
  const paths = Object.fromEntries(
    (await siteRoutes(resolveRequestHost(request.headers) ?? '')).map(entry => [entry.pageId, entry.path]),
  )
  const { html, noindex, analyticsMeasurementId } = measurePerfRender(() =>
    renderPage({
      manifest: route.manifest,
      shell: route.shell,
      isStaging: route.isStaging,
      navigationPaths: paths,
      options: {
        servingHost: resolveRequestHost(request.headers) ?? undefined,
        canonicalBase: route.canonicalHost ? `https://${route.canonicalHost}` : undefined,
        storyWidgets: context.storyWidgets,
        siteWidgets: context,
        newsroom: context.newsroom,
      },
    }),
  )
  const files = renderSiteFiles(route.shell.site_files, route.pageId)
  const privateResponse = Boolean(context.contactSent || context.contactError)
  const features = renderedFeatures(html)
  const headers = {
    'cache-control': noindex || privateResponse ? 'private, no-store' : REVALIDATE_PUBLIC,
    'x-robots-tag': noindex ? 'noindex, nofollow' : 'index, follow',
    ...publicSecurityHeaders({
      analyticsMeasurementId,
      providerFullscreen: features.providerFullscreen,
      embedSources: governedEmbedFrameSources(html),
      faqFilter: features.faqFilter,
      scheduleFilter: features.scheduleFilter,
      heroSlides: features.heroSlides,
      storyWidgets: features.storyWidgets,
      chapterDirectory: features.chapterDirectory,
      nationalNavigation: features.nationalNavigation,
      siteScriptHashes: files.scriptHashes,
      siteStyles: files.hasStyles,
      adobeFonts: features.adobeKit && adobeFontsEnabled(route.shell.theme, resolveRequestHost(request.headers)),
    }),
  }
  const etag = representationTag(cacheKey(route), html, JSON.stringify(headers))
  if (status === 200 && !privateResponse && matchesEntityTag(request.headers.get('if-none-match'), etag))
    return new Response(null, { status: 304, headers: { etag, ...headers } })
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', etag, ...headers } })
}
