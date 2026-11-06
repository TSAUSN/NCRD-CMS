import { inspectSiteAsset, isSiteDocumentName, SITE_ASSET_LIMIT, type UploadedSiteDocument } from '@cms/platform'
import { isStrictSameOriginRequest } from './request-origin.ts'
import { readBoundedRequestBody } from './request-body.ts'

type Dependencies = {
  trustProxyHeaders?: boolean
  currentSession(): Promise<{ userId: string } | null>
  upload(userId: string, siteId: string, bytes: Uint8Array, originalName: string): Promise<UploadedSiteDocument>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const failure = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers })

export function createDocumentUploadHandler(deps: Dependencies) {
  return async function POST(request: Request, siteId: string): Promise<Response> {
    if (!isStrictSameOriginRequest(request, deps.trustProxyHeaders === true))
      return failure(403, 'cross-origin-request', 'Upload requests must come from this site.')
    const session = await deps.currentSession()
    if (!session || !UUID.test(siteId)) return failure(404, 'not-found', 'The document destination was not found.')
    if (request.headers.get('content-type')?.trim().toLowerCase() !== 'application/pdf') {
      return failure(415, 'document-type-refused', 'Only PDF documents are accepted.')
    }
    let originalName: string
    try {
      originalName = decodeURIComponent(request.headers.get('x-document-name') ?? '')
    } catch {
      originalName = ''
    }
    if (!isSiteDocumentName(originalName))
      return failure(400, 'document-name-invalid', 'Choose a PDF with a usable file name.')
    const declared = request.headers.get('content-length')
    // Streaming requests can omit length; the reader always enforces the bound.
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
      return failure(400, 'document-length-invalid', 'The document size is invalid.')
    }
    if (declared !== null && Number(declared) > SITE_ASSET_LIMIT)
      return failure(413, 'document-too-large', 'PDF documents must be 25 MB or smaller.')
    let bytes: Uint8Array
    try {
      bytes = await readBoundedRequestBody(request, SITE_ASSET_LIMIT)
      if (declared !== null && bytes.length !== Number(declared)) throw new Error('incomplete')
      inspectSiteAsset(bytes, 'document', null)
    } catch (error) {
      if ((error as Error).message === 'too-large')
        return failure(413, 'document-too-large', 'PDF documents must be 25 MB or smaller.')
      return failure(400, 'document-invalid', 'Choose a complete PDF document and try again.')
    }
    try {
      const document = await deps.upload(session.userId, siteId, bytes, originalName)
      return Response.json({ document }, { status: 201, headers })
    } catch (error) {
      const kind = (error as { kind?: string }).kind
      if (kind === 'not_authorized' || kind === 'not_found')
        return failure(404, 'not-found', 'The document destination was not found.')
      if (kind === 'invalid_state')
        return failure(400, 'document-invalid', 'This document could not be registered. Try again.')
      throw error
    }
  }
}
