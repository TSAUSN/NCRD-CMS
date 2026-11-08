import { inspectReviewedSiteFile } from '@cms/platform'
import { SiteFileKind as FileKind, SiteFileName, type SiteFileKind, type SiteFileView } from '@cms/schema'
import { isStrictSameOriginRequest } from './request-origin.ts'
import { readBoundedRequestBody } from './request-body.ts'
type Dependencies = {
  trustProxyHeaders?: boolean
  currentSession: () => Promise<{ userId: string; isSuperAdmin: boolean } | null>
  upload: (
    userId: string,
    siteId: string,
    kind: SiteFileKind,
    name: string,
    source: string,
    bytes: Uint8Array,
  ) => Promise<SiteFileView>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const limit = 25 * 1024 * 1024
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const fail = (status: number, message: string) => Response.json({ error: message }, { status, headers })
export function createSiteFileUploadHandler(deps: Dependencies) {
  return async (request: Request, siteId: string): Promise<Response> => {
    if (!isStrictSameOriginRequest(request, deps.trustProxyHeaders))
      return fail(403, 'File uploads must come from this CMS.')
    const session = await deps.currentSession()
    if (!session?.isSuperAdmin || !uuid.test(siteId)) return fail(404, 'This file destination is unavailable.')
    if (request.headers.get('content-type') !== 'application/octet-stream')
      return fail(415, 'Choose a local file to upload.')
    let name = ''
    let source = ''
    try {
      name = decodeURIComponent(request.headers.get('x-site-file-name') ?? '')
      source = decodeURIComponent(request.headers.get('x-site-file-source') ?? '')
    } catch {
      return fail(400, 'The file name or source is invalid.')
    }
    const kind = FileKind.safeParse(request.headers.get('x-site-file-kind'))
    if (
      !kind.success ||
      !SiteFileName.safeParse(name).success ||
      !source.trim() ||
      source.length > 2000 ||
      /[\u0000-\u001f\u007f]|:\/\/[^/]*@/.test(source)
    )
      return fail(400, 'Add a supported file name and its original public source or local path, without credentials.')
    const declared = request.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))))
      return fail(400, 'The file size is invalid.')
    if (declared !== null && Number(declared) > limit) return fail(413, 'Site files must be 25 MB or smaller.')
    let bytes: Uint8Array
    try {
      bytes = await readBoundedRequestBody(request, limit)
      if (declared !== null && bytes.length !== Number(declared)) throw new Error('incomplete')
      inspectReviewedSiteFile(bytes, kind.data, name)
    } catch (error) {
      return fail(
        (error as Error).message === 'too-large' ? 413 : 400,
        'Choose a complete supported site file. Scripts, stylesheets and data must be 5 MB or smaller; other files 25 MB or smaller.',
      )
    }
    try {
      return Response.json(
        { file: await deps.upload(session.userId, siteId, kind.data, name, source, bytes) },
        { status: 201, headers },
      )
    } catch {
      return fail(400, 'This file could not be added. Check the site and try again; nothing was approved or published.')
    }
  }
}
