import { DomainError, fromSqlError } from '@cms/domain'
import { isStrictSameOriginRequest } from './request-origin.ts'
import { readBoundedRequestBody } from './request-body.ts'
import type { StorySourceCheck } from './story-source-check.ts'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
const fail = (status: number, error: string) => Response.json({ error }, { status, headers })
export function createStorySourceCheckHandler(deps: {
  trustProxyHeaders?: boolean
  currentUser: () => Promise<string | null>
  check: (userId: string, siteId: string, collectionId: string, requestId: string) => Promise<StorySourceCheck>
}) {
  return async (request: Request, siteId: string) => {
    if (!isStrictSameOriginRequest(request, deps.trustProxyHeaders)) return fail(403, 'Check stories from this CMS.')
    const user = await deps.currentUser()
    if (!user || !uuid.test(siteId)) return fail(404, 'Stories is unavailable. Sign in and reopen the site.')
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
      return fail(415, 'The story check could not be started. Reload Stories.')
    let input: { collectionId: string; requestId: string }
    try {
      const value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedRequestBody(request, 512)),
      )
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'collectionId,requestId' ||
        typeof value.collectionId !== 'string' ||
        typeof value.requestId !== 'string' ||
        !uuid.test(value.collectionId) ||
        !uuid.test(value.requestId)
      )
        throw new Error('invalid')
      input = value
    } catch {
      return fail(400, 'The story check could not be started. Reload Stories.')
    }
    try {
      const check = await deps.check(user, siteId, input.collectionId, input.requestId)
      return Response.json(
        {
          check: {
            id: check.id,
            status: check.status,
            started_at: check.started_at,
            finished_at: check.finished_at,
            result: check.result,
          },
        },
        { headers },
      )
    } catch (error) {
      const domain = error instanceof DomainError ? error : fromSqlError(error)
      return fail(
        domain?.kind === 'not_authorized' || domain?.kind === 'not_found'
          ? 404
          : domain?.kind === 'stale_revision'
            ? 409
            : 503,
        domain?.kind === 'not_authorized'
          ? 'A Site admin must check this source.'
          : domain?.kind === 'stale_revision'
            ? 'The check expired or the source changed. Reload Stories before checking again.'
            : 'Stories could not be checked. Saved stories are unchanged. Retry this check.',
      )
    }
  }
}
