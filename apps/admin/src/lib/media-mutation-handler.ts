import type { MediaAsset, MediaMetadataInput } from './media-library.ts'
import { isSameOriginRequest } from './request-origin.ts'

export type DeleteMediaInput = {
  expectedRevision: number
  breakReferences: boolean
  reason: string | null
}

export type MediaMutationRepository = {
  softDelete(userId: string, mediaId: string, input: DeleteMediaInput): Promise<MediaAsset | null>
  restore(userId: string, mediaId: string, expectedRevision: number): Promise<MediaAsset | null>
  updateMetadata(
    userId: string,
    mediaId: string,
    expectedRevision: number,
    input: MediaMetadataInput,
  ): Promise<MediaAsset | null>
  bulkOrganize(userId: string, input: BulkOrganizationInput): Promise<MediaAsset[]>
  bulkDelete(userId: string, input: BulkDeleteInput): Promise<MediaAsset[]>
}

export type BulkOrganizationInput = {
  items: Array<{ id: string; revision: number }>
  folder: string | null
  addTags: string[]
  removeTags: string[]
}
export type BulkDeleteInput = {
  items: Array<{ id: string; revision: number }>
  breakReferences: boolean
  reason: string | null
}

type Deps = {
  currentSession(): Promise<{ userId: string } | null>
  repository: MediaMutationRepository
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_MUTATION_JSON_BYTES = 8 * 1024

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    },
  )
}

async function boundedJson(request: Request): Promise<Record<string, unknown> | null> {
  const rawLength = request.headers.get('content-length')
  if (!rawLength || !/^\d+$/.test(rawLength) || Number(rawLength) > MAX_MUTATION_JSON_BYTES) return null
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_MUTATION_JSON_BYTES || bytes.byteLength !== Number(rawLength)) return null
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function expectedRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null
}

function mutationError(error: unknown): Response | null {
  const kind = (error as { kind?: unknown })?.kind
  if (kind === 'not_found' || kind === 'not_authorized') {
    return jsonError(404, 'not-found', 'This media item was not found.')
  }
  if (kind === 'stale_revision') {
    return jsonError(409, 'stale-revision', 'This media item changed since you opened it. Refresh and try again.')
  }
  if (kind === 'invalid_state') {
    return jsonError(409, 'media-state-conflict', (error as Error).message)
  }
  return null
}

async function authorize(
  request: Request,
  mediaId: string,
  deps: Deps,
): Promise<
  | {
      session: { userId: string }
      body: Record<string, unknown>
    }
  | Response
> {
  if (!isSameOriginRequest(request))
    return jsonError(403, 'cross-origin-request', 'This request must come from the admin site.')
  if (!UUID.test(mediaId)) return jsonError(404, 'not-found', 'This media item was not found.')
  const session = await deps.currentSession()
  if (!session) return jsonError(404, 'not-found', 'This media item was not found.')
  const body = await boundedJson(request)
  if (!body) return jsonError(400, 'invalid-request', 'The media request is invalid.')
  return { session, body }
}

export function createDeleteMediaHandler(deps: Deps) {
  return async function DELETE(request: Request, mediaId: string): Promise<Response> {
    const authorized = await authorize(request, mediaId, deps)
    if (authorized instanceof Response) return authorized
    const revision = expectedRevision(authorized.body['expectedRevision'])
    const breakReferences = authorized.body['breakReferences']
    const rawReason = authorized.body['reason']
    const reason =
      rawReason === null || rawReason === undefined
        ? null
        : typeof rawReason === 'string'
          ? rawReason.trim()
          : undefined
    if (
      revision === null ||
      typeof breakReferences !== 'boolean' ||
      reason === undefined ||
      (reason !== null && (reason.length > 1_000 || /[\u0000-\u001f\u007f]/.test(reason)))
    ) {
      return jsonError(400, 'invalid-request', 'The delete request is invalid.')
    }
    if (breakReferences && (!reason || reason.length < 8)) {
      return jsonError(
        400,
        'deletion-reason-required',
        'Explain why it is acceptable to break existing image references.',
      )
    }
    try {
      const asset = await deps.repository.softDelete(authorized.session.userId, mediaId, {
        expectedRevision: revision,
        breakReferences,
        reason,
      })
      if (!asset) return jsonError(404, 'not-found', 'This media item was not found.')
      return Response.json(
        { asset },
        {
          headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        },
      )
    } catch (error) {
      const response = mutationError(error)
      if (response) return response
      throw error
    }
  }
}

export function createRestoreMediaHandler(deps: Deps) {
  return async function POST(request: Request, mediaId: string): Promise<Response> {
    const authorized = await authorize(request, mediaId, deps)
    if (authorized instanceof Response) return authorized
    const revision = expectedRevision(authorized.body['expectedRevision'])
    if (revision === null) return jsonError(400, 'invalid-request', 'The restore request is invalid.')
    try {
      const asset = await deps.repository.restore(authorized.session.userId, mediaId, revision)
      if (!asset) return jsonError(404, 'not-found', 'This media item was not found.')
      return Response.json(
        { asset },
        {
          headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        },
      )
    } catch (error) {
      const response = mutationError(error)
      if (response) return response
      throw error
    }
  }
}

function metadataInput(body: Record<string, unknown>): { revision: number; metadata: MediaMetadataInput } | null {
  const revision = expectedRevision(body['expectedRevision'])
  const decorative = body['decorative']
  const altText = typeof body['altText'] === 'string' ? body['altText'].trim() : null
  const folder = typeof body['folder'] === 'string' ? body['folder'].trim() : null
  const attribution = typeof body['attribution'] === 'string' ? body['attribution'].trim() : null
  const source = typeof body['source'] === 'string' ? body['source'].trim() : null
  const rawTags = body['tags']
  let focal: MediaMetadataInput['focal'] = null
  if (body['focal'] !== null) {
    const value = body['focal'] as { x?: unknown; y?: unknown } | undefined
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.x !== 'number' ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      value.x < 0 ||
      value.x > 1 ||
      value.y < 0 ||
      value.y > 1
    )
      return null
    focal = { x: value.x, y: value.y }
  }
  if (
    revision === null ||
    typeof decorative !== 'boolean' ||
    altText === null ||
    folder === null ||
    attribution === null ||
    source === null ||
    !Array.isArray(rawTags) ||
    altText.length > 1_000 ||
    attribution.length > 500 ||
    source.length > 1_000 ||
    folder.length > 200 ||
    (folder !== '' && !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}(\/[A-Za-z0-9][A-Za-z0-9 _-]{0,63})*$/.test(folder)) ||
    rawTags.length > 24 ||
    rawTags.some(tag => typeof tag !== 'string')
  )
    return null
  const tags = [...new Set((rawTags as string[]).map(tag => tag.trim().toLocaleLowerCase()))].sort()
  if (
    tags.length !== rawTags.length ||
    tags.some(tag => !/^[a-z0-9][a-z0-9 -]{0,47}$/.test(tag)) ||
    (decorative ? altText !== '' : altText === '')
  )
    return null
  return { revision, metadata: { altText, decorative, focal, folder, attribution, source, tags } }
}

export function createUpdateMediaMetadataHandler(deps: Deps) {
  return async function PATCH(request: Request, mediaId: string): Promise<Response> {
    const authorized = await authorize(request, mediaId, deps)
    if (authorized instanceof Response) return authorized
    const parsed = metadataInput(authorized.body)
    if (!parsed) return jsonError(400, 'invalid-request', 'The media metadata is invalid.')
    try {
      const asset = await deps.repository.updateMetadata(
        authorized.session.userId,
        mediaId,
        parsed.revision,
        parsed.metadata,
      )
      if (!asset) return jsonError(404, 'not-found', 'This media item was not found.')
      return Response.json(
        { asset },
        {
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        },
      )
    } catch (error) {
      const response = mutationError(error)
      if (response) return response
      throw error
    }
  }
}

function bulkItems(value: unknown, max: number): Array<{ id: string; revision: number }> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) return null
  const items: Array<{ id: string; revision: number }> = []
  for (const raw of value) {
    const item = raw as { id?: unknown; revision?: unknown }
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !UUID.test(item.id)) return null
    const revision = expectedRevision(item.revision)
    if (revision === null) return null
    items.push({ id: item.id, revision })
  }
  return new Set(items.map(item => item.id)).size === items.length ? items : null
}

export function createBulkMediaHandler(deps: Deps) {
  return async function POST(request: Request, siteId: string): Promise<Response> {
    const authorized = await authorize(request, siteId, deps)
    if (authorized instanceof Response) return authorized
    const operation = authorized.body['operation']
    try {
      let assets: MediaAsset[]
      if (operation === 'organize') {
        const items = bulkItems(authorized.body['items'], 100)
        const folder = authorized.body['folder']
        const addTags = authorized.body['addTags']
        const removeTags = authorized.body['removeTags']
        if (
          !items ||
          (folder !== null && typeof folder !== 'string') ||
          !Array.isArray(addTags) ||
          !Array.isArray(removeTags) ||
          [...addTags, ...removeTags].some(tag => typeof tag !== 'string')
        ) {
          return jsonError(400, 'invalid-request', 'The bulk organization request is invalid.')
        }
        const normalized = (values: unknown[]) =>
          [...new Set(values.map(tag => (tag as string).trim().toLocaleLowerCase()))].sort()
        assets = await deps.repository.bulkOrganize(authorized.session.userId, {
          items,
          folder: folder === null ? null : folder.trim(),
          addTags: normalized(addTags),
          removeTags: normalized(removeTags),
        })
      } else if (operation === 'delete') {
        const items = bulkItems(authorized.body['items'], 50)
        const breakReferences = authorized.body['breakReferences']
        const reason = authorized.body['reason']
        if (!items || typeof breakReferences !== 'boolean' || (reason !== null && typeof reason !== 'string')) {
          return jsonError(400, 'invalid-request', 'The bulk delete request is invalid.')
        }
        assets = await deps.repository.bulkDelete(authorized.session.userId, {
          items,
          breakReferences,
          reason: reason === null ? null : reason.trim(),
        })
      } else return jsonError(400, 'invalid-request', 'The bulk operation is unknown.')
      return Response.json(
        { assets },
        {
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        },
      )
    } catch (error) {
      const response = mutationError(error)
      if (response) return response
      throw error
    }
  }
}
