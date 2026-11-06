import { DomainError, fromSqlError } from '@cms/domain'
import { isStrictSameOriginRequest } from './request-origin.ts'
import { readBoundedRequestBody } from './request-body.ts'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type CanvasOpenInput = {
  versionId: string
  sitePreview: 'draft' | 'published'
  channel: string
  showHidden: boolean
  parentOrigin: string
}
const fail = (status: number, message: string) =>
  Response.json({ error: message }, { status, headers: { 'cache-control': 'private, no-store' } })
export function createCanvasTicketHandler(deps: {
  trustProxyHeaders?: boolean
  session: () => Promise<{ userId: string } | null>
  open: (
    user: string,
    page: string,
    input: CanvasOpenInput,
  ) => Promise<{ href: string; token: string; expiresAt: string }>
  renew: (user: string, page: string, token: string) => Promise<{ expiresAt: string }>
}) {
  return async (request: Request, page: string): Promise<Response> => {
    if (!isStrictSameOriginRequest(request, deps.trustProxyHeaders))
      return fail(403, 'Open editing previews from this CMS.')
    const session = await deps.session()
    if (!session || !UUID.test(page)) return fail(404, 'This editing preview is unavailable.')
    let body: Record<string, unknown>
    try {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw Error('type')
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedRequestBody(request, 4096)),
      )
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('shape')
      body = value as Record<string, unknown>
    } catch {
      return fail(400, 'The editing preview request is incomplete.')
    }
    try {
      let result: { expiresAt: string }
      if (
        body['action'] === 'renew' &&
        Object.keys(body).length === 2 &&
        typeof body['token'] === 'string' &&
        /^[a-f0-9]{64}$/.test(body['token'])
      ) {
        result = await deps.renew(session.userId, page, body['token'])
      } else if (
        body['action'] === 'open' &&
        Object.keys(body).length === 5 &&
        typeof body['versionId'] === 'string' &&
        UUID.test(body['versionId']) &&
        (body['sitePreview'] === 'draft' || body['sitePreview'] === 'published') &&
        typeof body['channel'] === 'string' &&
        /^[A-Za-z0-9_-]{16,128}$/.test(body['channel']) &&
        typeof body['showHidden'] === 'boolean'
      ) {
        result = await deps.open(session.userId, page, {
          versionId: body['versionId'],
          sitePreview: body['sitePreview'],
          channel: body['channel'],
          showHidden: body['showHidden'],
          parentOrigin: new URL(request.headers.get('origin')!).origin,
        })
      } else return fail(400, 'The editing preview request is incomplete.')
      return Response.json(result, { headers: { 'cache-control': 'private, no-store' } })
    } catch (error) {
      const kind = (error instanceof DomainError ? error : fromSqlError(error))?.kind
      return kind === 'stale_revision'
        ? fail(409, 'The saved page or list changed. Save your work and refresh the preview.')
        : kind === 'not_authorized' || kind === 'not_found'
          ? fail(404, 'This editing preview is unavailable.')
          : fail(503, 'The editing preview is temporarily unavailable. Try again.')
    }
  }
}
