import type { DocumentLibraryQuery, DocumentLibraryResult, ManagedDocument } from './document-library.ts'
import { isSameOriginRequest } from './request-origin.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
type Input = Pick<ManagedDocument, 'id' | 'revision' | 'category' | 'archived'>
type Dependencies = {
  currentSession(): Promise<{ userId: string } | null>
  list(userId: string, siteId: string, query: DocumentLibraryQuery): Promise<DocumentLibraryResult>
  organize(userId: string, siteId: string, input: Input): Promise<number>
}
const failure = (status: number, message: string) => Response.json({ error: { message } }, { status, headers })
function errorResponse(error: unknown): Response {
  const kind = (error as { kind?: string }).kind
  if (kind === 'not_found' || kind === 'not_authorized') return failure(404, 'This document library was not found.')
  if (kind === 'stale_revision')
    return failure(409, 'This document changed in another session. Refresh the library before trying again.')
  if (kind === 'invalid_state') return failure(400, 'The document change is invalid.')
  throw error
}

export function createDocumentManagementHandlers(deps: Dependencies) {
  return {
    async GET(request: Request, siteId: string): Promise<Response> {
      const session = await deps.currentSession()
      if (!session || !UUID.test(siteId)) return failure(404, 'This document library was not found.')
      const params = new URL(request.url).searchParams
      const search = (params.get('search') ?? '').trim(),
        category = (params.get('category') ?? '').trim()
      const archived = params.get('archived') ?? 'false',
        page = params.get('page') ?? '1'
      if (
        search.length > 200 ||
        category.length > 80 ||
        !['true', 'false'].includes(archived) ||
        !/^[1-9]\d{0,4}$/.test(page)
      )
        return failure(400, 'The document filters are invalid.')
      try {
        return Response.json(
          await deps.list(session.userId, siteId, {
            search,
            category,
            archived: archived === 'true',
            page: Number(page),
          }),
          { headers },
        )
      } catch (error) {
        return errorResponse(error)
      }
    },
    async PATCH(request: Request, siteId: string): Promise<Response> {
      if (!isSameOriginRequest(request)) return failure(403, 'This request must come from the admin site.')
      const session = await deps.currentSession()
      if (!session || !UUID.test(siteId)) return failure(404, 'This document library was not found.')
      if (!request.body || request.headers.get('content-type')?.split(';')[0] !== 'application/json')
        return failure(400, 'The document change is invalid.')
      const reader = request.body.getReader(),
        chunks: Uint8Array[] = []
      let size = 0,
        raw: unknown
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 2048) {
            await reader.cancel()
            return failure(413, 'The document change is too large.')
          }
          chunks.push(value)
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        raw = JSON.parse(new TextDecoder().decode(bytes))
      } catch {
        return failure(400, 'The document change is invalid.')
      } finally {
        reader.releaseLock()
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failure(400, 'The document change is invalid.')
      const input = raw as Input
      if (
        typeof input.id !== 'string' ||
        !UUID.test(input.id) ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 0 ||
        typeof input.category !== 'string' ||
        input.category.length > 80 ||
        input.category !== input.category.trim() ||
        /[\u0000-\u001f\u007f]/.test(input.category) ||
        typeof input.archived !== 'boolean'
      )
        return failure(400, 'The document change is invalid.')
      try {
        return Response.json({ revision: await deps.organize(session.userId, siteId, input) }, { headers })
      } catch (error) {
        return errorResponse(error)
      }
    },
  }
}
