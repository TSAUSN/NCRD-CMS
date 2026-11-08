import {
  deliverReviewedSiteFile,
  deliverReviewedSiteFileAtPath,
  deliverSiteAsset,
  deliverMediaObject,
  isGovernedMediaVariant,
  type MediaStore,
  type ResolvedSiteFile,
  type ResolvedSiteAsset,
  type ResolvedMediaObject,
} from '@cms/platform'
import { SiteFilePath, SiteNativeTarget } from '@cms/schema'
import { CANVAS_TOKEN, canvasStylesheet } from './canvas-resources.ts'

export type CanvasResourceRepository = {
  native?(host: string, token: string, path: string): Promise<unknown>
  path?(host: string, token: string, path: string): Promise<{ file: ResolvedSiteFile; paths: string[] } | null>
  paths?(host: string, token: string): Promise<string[]>
  file(host: string, token: string, id: string): Promise<ResolvedSiteFile | null>
  asset(host: string, token: string, id: string): Promise<ResolvedSiteAsset | null>
  media(host: string, token: string, id: string, variant: string): Promise<ResolvedMediaObject | null>
}
export const canvasNotFound = () =>
  new Response(null, {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function createCanvasResourceHandler(deps: {
  repository: CanvasResourceRepository
  store: MediaStore
  host: (headers: Headers) => string | null
}) {
  return async (request: Request, token: string, path: string[]): Promise<Response> => {
    const host = deps.host(request.headers)
    if (!host || !CANVAS_TOKEN.test(token)) return canvasNotFound()
    const prefix = `/__cms/read/${token}/`
    const pathname = new URL(request.url).pathname
    const original = pathname.startsWith(prefix) ? pathname.slice(prefix.length - 1) : null
    if (original && SiteFilePath.safeParse(original).success && deps.repository.path) {
      const mapped = await deps.repository.path(host, token, original)
      if (mapped) {
        const response = await deliverReviewedSiteFileAtPath({
          path: original,
          store: deps.store,
          visibility: 'admin',
          resolve: async () => mapped.file,
        })
        response.headers.set('referrer-policy', 'no-referrer')
        if (response.ok && response.headers.get('content-type') === 'text/css') {
          try {
            const css = canvasStylesheet(await response.text(), token, { paths: mapped.paths, basePath: original })
            const headers = new Headers(response.headers)
            headers.delete('etag')
            headers.delete('content-length')
            return new Response(css, { headers })
          } catch {
            return canvasNotFound()
          }
        }
        return response
      }
    }
    if (!UUID.test(path[1] ?? '')) return canvasNotFound()
    if (path[0] === 'site-files' && path.length === 4) {
      const response = await deliverReviewedSiteFile({
        fileId: path[1]!,
        sha256: path[2]!,
        name: path[3]!,
        store: deps.store,
        visibility: 'admin',
        resolve: () => deps.repository.file(host, token, path[1]!),
      })
      response.headers.set('referrer-policy', 'no-referrer')
      if (response.ok && response.headers.get('content-type') === 'text/css') {
        try {
          const css = canvasStylesheet(await response.text(), token, {
            paths: (await deps.repository.paths?.(host, token)) ?? [],
            basePath: original ?? '/' + path.join('/'),
          })
          const headers = new Headers(response.headers)
          headers.delete('etag')
          headers.delete('content-length')
          return new Response(css, { headers })
        } catch {
          return canvasNotFound()
        }
      }
      return response
    }
    if (path[0] === 'assets' && path.length === 2) {
      const raw = await deps.repository.native?.(host, token, '/' + path.join('/'))
      const mapping = SiteNativeTarget.safeParse(raw)
      if (raw != null && !mapping.success) return canvasNotFound()
      if (mapping.success && mapping.data.kind !== 'asset') return canvasNotFound()
      const target = mapping.success && mapping.data.kind === 'asset' ? mapping.data.assetId : path[1]!
      const response = await deliverSiteAsset({
        assetId: target,
        store: deps.store,
        visibility: 'admin',
        resolve: () => deps.repository.asset(host, token, target),
      })
      response.headers.set('referrer-policy', 'no-referrer')
      return response
    }
    if (path[0] === 'media' && path.length === 3 && isGovernedMediaVariant(path[2]!)) {
      const raw = await deps.repository.native?.(host, token, '/' + path.join('/'))
      const mapping = SiteNativeTarget.safeParse(raw)
      if (raw != null && !mapping.success) return canvasNotFound()
      if (mapping.success && (mapping.data.kind !== 'media' || mapping.data.variant !== path[2]))
        return canvasNotFound()
      const target = mapping.success && mapping.data.kind === 'media' ? mapping.data.mediaId : path[1]!
      const response = await deliverMediaObject({
        mediaId: target,
        variant: path[2]!,
        store: deps.store,
        visibility: 'admin',
        request,
        resolve: () => deps.repository.media(host, token, target, path[2]!),
      })
      response.headers.set('referrer-policy', 'no-referrer')
      return response
    }
    return canvasNotFound()
  }
}
