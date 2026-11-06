import {
  isGovernedMediaVariant,
  isResolvedMediaObjectSafe,
  mediaObjectHeaders,
  type GovernedMediaVariant,
  type MediaStore,
  type ResolvedMediaObject,
} from '@cms/platform'

export type AdminMediaDeliveryRepository = {
  /** Must execute under the supplied session so RLS re-checks site ownership. */
  resolve(userId: string, mediaId: string, variant: GovernedMediaVariant): Promise<ResolvedMediaObject | null>
}

type Deps = {
  currentSession(): Promise<{ userId: string } | null>
  repository: AdminMediaDeliveryRepository
  media: MediaStore
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hidden(): Response {
  return new Response(null, {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}

export function createAdminMediaGetHandler(deps: Deps) {
  return async function GET(mediaId: string, variantName: string): Promise<Response> {
    if (!UUID.test(mediaId) || !isGovernedMediaVariant(variantName)) return hidden()
    const session = await deps.currentSession()
    if (!session) return hidden()
    const object = await deps.repository.resolve(session.userId, mediaId, variantName)
    if (!object || object.mediaId !== mediaId || object.variant !== variantName || !isResolvedMediaObjectSafe(object))
      return hidden()
    const bytes = await deps.media.get(object.objectKey)
    if (!bytes || bytes.byteLength !== object.bytes) return hidden()
    return new Response(bytes as unknown as BodyInit, {
      headers: mediaObjectHeaders(object, 'admin'),
    })
  }
}
