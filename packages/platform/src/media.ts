import { createHash } from 'node:crypto'
import type { MediaStore } from './ports.ts'

/** Stable application URLs expose only these governed names, never object keys. */
export const GOVERNED_MEDIA_VARIANTS = ['original', 'thumbnail', 'card', 'wide'] as const
export type GovernedMediaVariant = (typeof GOVERNED_MEDIA_VARIANTS)[number]

export type ResolvedMediaObject = {
  mediaId: string
  variant: GovernedMediaVariant
  objectKey: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  bytes: number
  width: number
  height: number
  contentHash: string
}

export function isGovernedMediaVariant(value: string): value is GovernedMediaVariant {
  return (GOVERNED_MEDIA_VARIANTS as readonly string[]).includes(value)
}

/** Runtime guard for database/provider corruption; TypeScript cannot vet rows. */
export function isResolvedMediaObjectSafe(object: ResolvedMediaObject): boolean {
  return (
    isGovernedMediaVariant(object.variant) &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(object.mimeType) &&
    /^[a-f0-9]{64}$/.test(object.contentHash) &&
    Number.isSafeInteger(object.bytes) &&
    object.bytes > 0 &&
    Number.isSafeInteger(object.width) &&
    object.width > 0 &&
    Number.isSafeInteger(object.height) &&
    object.height > 0
  )
}

export function mediaObjectHeaders(
  object: ResolvedMediaObject,
  visibility: 'admin' | 'public',
): Record<string, string> {
  return {
    'content-type': object.mimeType,
    'content-length': String(object.bytes),
    'cache-control':
      visibility === 'public'
        ? // Bytes are immutable; the published-reference permission is not.
          'public, max-age=0, must-revalidate'
        : // Access can be revoked even though the bytes are immutable. Re-check the
          // session/tenant on every admin preview request.
          'private, no-store',
    etag: `"sha256-${object.contentHash}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'content-disposition': 'inline',
    'cross-origin-resource-policy': 'same-origin',
  }
}

/** Resolver-authorized native bytes share the same digest check in public and
 * private delivery. A matching cache validator never skips integrity/access. */
export async function deliverMediaObject(input: {
  mediaId: string
  variant: string
  resolve: () => Promise<ResolvedMediaObject | null>
  store: MediaStore
  visibility: 'admin' | 'public'
  request?: Request
}): Promise<Response> {
  const hidden = () =>
    new Response(null, { status: 404, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.mediaId) ||
    !isGovernedMediaVariant(input.variant)
  )
    return hidden()
  const object = await input.resolve()
  if (
    !object ||
    object.mediaId !== input.mediaId ||
    object.variant !== input.variant ||
    !isResolvedMediaObjectSafe(object)
  )
    return hidden()
  const bytes = await input.store.get(object.objectKey)
  if (
    !bytes ||
    bytes.byteLength !== object.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== object.contentHash
  )
    return hidden()
  const headers = mediaObjectHeaders(object, input.visibility)
  if (input.visibility === 'public' && input.request?.headers.get('if-none-match') === headers.etag)
    return new Response(null, { status: 304, headers })
  return new Response(input.request?.method === 'HEAD' ? null : new Uint8Array(bytes), { headers })
}
