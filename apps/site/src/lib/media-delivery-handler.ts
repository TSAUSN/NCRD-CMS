import { SiteNativeTarget } from '@cms/schema'
import {
  deliverMediaObject,
  isGovernedMediaVariant,
  type GovernedMediaVariant,
  type MediaStore,
  type ResolvedMediaObject,
} from '@cms/platform'

export type PublicMediaDeliveryRepository = {
  native?(host: string, path: string): Promise<unknown>
  /** The database resolver binds this normalized host to the media's site. */
  resolve(host: string, mediaId: string, variant: GovernedMediaVariant): Promise<ResolvedMediaObject | null>
}

type Deps = {
  resolveSite(headers: Headers): Promise<{ host: string; siteId: string } | null>
  repository: PublicMediaDeliveryRepository
  media: MediaStore
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hidden(): Response {
  return new Response(null, {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}

export function createPublicMediaGetHandler(deps: Deps) {
  return async function GET(request: Request, mediaId: string, variantName: string): Promise<Response> {
    // Path parameters never become storage keys. The closed variant vocabulary
    // is the only caller-controlled selector that reaches the resolver.
    if (!UUID.test(mediaId) || !isGovernedMediaVariant(variantName)) return hidden()
    const site = await deps.resolveSite(request.headers)
    if (!site) return hidden()
    const raw = await deps.repository.native?.(site.host, `/media/${mediaId}/${variantName}`),
      mapping = SiteNativeTarget.safeParse(raw)
    if (raw != null && !mapping.success) return hidden()
    if (mapping.success && (mapping.data.kind !== 'media' || mapping.data.variant !== variantName)) return hidden()
    const target = mapping.success && mapping.data.kind === 'media' ? mapping.data.mediaId : mediaId
    return deliverMediaObject({
      mediaId: target,
      variant: variantName,
      store: deps.media,
      visibility: 'public',
      request,
      resolve: () => deps.repository.resolve(site.host, target, variantName),
    })
  }
}
