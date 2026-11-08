import { measurePerfRender } from '@cms/platform/perf-trace'
import { SiteFileProjection } from '@cms/schema'
import {
  renderedFeatures,
  adobeFontsEnabled,
  renderPage,
  renderSiteFiles,
  governedEmbedFrameSources,
} from '@cms/renderer'
import { CANVAS_TOKEN, canvasDocument } from './canvas-resources.ts'
import { canvasNotFound } from './canvas-resource-handler.ts'
import type { CanvasSnapshot } from './canvas-preview-repository.ts'
import { publicSecurityHeaders } from './public-security.ts'
import type { CanvasRuntimeMode } from './canvas-runtime-files.ts'
export function createCanvasPageHandler(deps: {
  host: (headers: Headers) => string | null
  snapshot: (host: string, token: string) => Promise<{ snapshot: CanvasSnapshot; expiresAt: string } | null>
  runtime: (mode: CanvasRuntimeMode) => Promise<{ head: string; body: string; hashes: string[]; styles?: boolean }>
}) {
  return async (request: Request, token: string): Promise<Response> => {
    const host = deps.host(request.headers)
    if (!host || !CANVAS_TOKEN.test(token)) return canvasNotFound()
    const data = await deps.snapshot(host, token)
    if (!data) return canvasNotFound()
    const { snapshot, expiresAt } = data
    let parent: URL
    try {
      parent = new URL(snapshot.parentOrigin)
    } catch {
      return canvasNotFound()
    }
    if (
      !['http:', 'https:'].includes(parent.protocol) ||
      parent.origin !== snapshot.parentOrigin ||
      parent.origin === new URL(request.url).origin ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(snapshot.channel)
    )
      return canvasNotFound()
    const params = new URL(request.url).searchParams
    const visitor = params.get('visit') === '1'
    const mode = visitor ? (params.get('frame') === '1' ? 'frame' : 'visitor') : 'editing'
    let runtime: Awaited<ReturnType<typeof deps.runtime>>
    try {
      runtime = await deps.runtime(mode)
    } catch {
      return new Response('The editing preview is temporarily unavailable.', {
        status: 503,
        headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    const { html } = measurePerfRender(() =>
      renderPage({
        manifest: snapshot.manifest,
        shell: snapshot.shell,
        navigationPaths: snapshot.navigationPaths,
        isStaging: true,
        options: {
          servingHost: host,
          preview: !visitor,
          visitorPreview: visitor,
          previewRuntime: false,
          externalRuntimes: true,
          siteFiles: true,
          showHiddenSections: snapshot.showHiddenSections,
        },
      }),
    )
    const files = renderSiteFiles(snapshot.shell.site_files, snapshot.manifest.page.id)
    const features = renderedFeatures(html)
    const headers = publicSecurityHeaders({
      providerFullscreen: features.providerFullscreen,
      embedSources: governedEmbedFrameSources(html),
      faqFilter: features.faqFilter,
      scheduleFilter: features.scheduleFilter,
      heroSlides: features.heroSlides,
      storyWidgets: features.storyWidgets,
      chapterDirectory: features.chapterDirectory,
      nationalNavigation: features.nationalNavigation,
      siteScriptHashes: [...files.scriptHashes, ...runtime.hashes],
      siteStyles: files.hasStyles || runtime.styles === true,
      adobeFonts: features.adobeKit && adobeFontsEnabled(snapshot.shell.theme, host),
    })
    headers['content-security-policy'] = headers['content-security-policy']!.replace(
      "frame-ancestors 'self'",
      `frame-ancestors ${parent.origin}`,
    ).replace("form-action 'self'", "form-action 'none'")
    const projection = SiteFileProjection.safeParse(snapshot.shell.site_files),
      paths = projection.success ? (projection.data.bundle.paths?.map(path => path.path) ?? []) : []
    return new Response(
      request.method === 'HEAD'
        ? null
        : canvasDocument(
            html,
            token,
            {
              parentOrigin: parent.origin,
              channel: snapshot.channel,
              expiresAt,
              paths,
              path: snapshot.manifest.page.path,
            },
            runtime,
          ),
      {
        headers: {
          ...headers,
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'private, no-store',
          'referrer-policy': 'no-referrer',
          'x-robots-tag': 'noindex, nofollow',
        },
      },
    )
  }
}
