import { DomainError } from '@cms/domain'
import { MAX_SITE_ARCHIVE_BYTES, SiteArchiveDestination } from '@cms/schema'
import type { MediaStore } from '@cms/platform'
import { isSameOriginRequest } from './request-origin.ts'
import { exportSiteArchive, importSiteArchive } from './site-portability.ts'

type Session = { userId: string; isSuperAdmin: boolean; recentlyAuthenticated: boolean } | null
export type PortabilityDeps = {
  session(): Promise<Session>
  media(): MediaStore
  export?: typeof exportSiteArchive
  import?: typeof importSiteArchive
}
const headers = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
}
function error(status: number, message: string) {
  return Response.json({ message }, { status, headers })
}
async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('empty-body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_SITE_ARCHIVE_BYTES + 4096) {
        await reader.cancel()
        throw new Error('archive-too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function handledError(cause: unknown): Response {
  if (cause instanceof DomainError) {
    if (cause.kind === 'not_authorized' || cause.kind === 'not_found')
      return error(404, 'The site or import destination was not found.')
    return error(400, cause.message)
  }
  const code = (cause as { code?: string }).code
  if (code === 'CMS02' || code === 'CMS03') return error(404, 'The site or import destination was not found.')
  if (code === '23505') return error(409, 'That short address is already in use. Choose another address.')
  if (code === 'CMS04' || (cause as { name?: string }).name === 'ZodError')
    return error(
      400,
      'The content archive does not pass validation. Check the file and its linked content; no site content was saved.',
    )
  if (cause instanceof Error && cause.message.startsWith('The archive ')) return error(400, cause.message)
  return error(
    503,
    'The content transfer could not be confirmed. Retry with the same file and destination; the same request will not create a duplicate site.',
  )
}
function exportError(cause: unknown): Response {
  const code = (cause as { code?: string }).code
  if (
    (cause instanceof DomainError && (cause.kind === 'not_authorized' || cause.kind === 'not_found')) ||
    code === 'CMS02' ||
    code === 'CMS03'
  ) {
    return error(
      404,
      'The site is no longer available to this account. Sign in again or ask your site administrator for access.',
    )
  }
  if (cause instanceof DomainError && cause.kind === 'invalid_state') {
    return Response.json(
      { message: cause.message, ...(/image|media/i.test(cause.message) ? { recovery: 'media' } : {}) },
      { status: 400, headers },
    )
  }
  if (code === 'CMS04')
    return Response.json(
      {
        message: 'Some images are still processing or unavailable. Resolve them before downloading the archive.',
        recovery: 'media',
      },
      { status: 400, headers },
    )
  if (
    (cause as { name?: string }).name === 'ZodError' ||
    (cause instanceof Error && cause.message.startsWith('The archive '))
  ) {
    return error(
      422,
      'This site contains saved content or media that does not pass archive validation. Ask your site administrator to repair it before exporting.',
    )
  }
  return error(
    503,
    'The archive could not be prepared. Try again; if this continues, ask your site administrator to check media storage.',
  )
}
export function createSiteExportHandler(deps: PortabilityDeps) {
  return async (_request: Request, siteId: string) => {
    const session = await deps.session()
    if (!session || !/^[0-9a-f-]{36}$/i.test(siteId)) return error(404, 'The site was not found.')
    try {
      const archive = await (deps.export ?? exportSiteArchive)(session.userId, siteId, deps.media())
      return new Response(JSON.stringify(archive), {
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-disposition': `attachment; filename="cms-site-${siteId}.json"`,
        },
      })
    } catch (cause) {
      return exportError(cause)
    }
  }
}
export function createSiteImportHandler(deps: PortabilityDeps) {
  return async (request: Request) => {
    if (!isSameOriginRequest(request)) return error(403, 'Import requests must come from this application.')
    const session = await deps.session()
    if (!session?.isSuperAdmin) return error(404, 'The import destination was not found.')
    if (!session.recentlyAuthenticated)
      return error(
        403,
        'Confirm your sign-in in another tab, then retry the import. Your selected file will stay here.',
      )
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return error(415, 'Choose a JSON content archive.')
    const length = Number(request.headers.get('content-length'))
    if (Number.isFinite(length) && length > MAX_SITE_ARCHIVE_BYTES + 4096)
      return error(413, 'Content archives must be 64 MB or smaller.')
    let input: { requestId: string; destination: SiteArchiveDestination; archive: unknown; reviewedSiteFiles?: boolean }
    try {
      input = (await boundedJson(request)) as typeof input
    } catch (cause) {
      return error(
        cause instanceof Error && cause.message === 'archive-too-large' ? 413 : 400,
        'Choose a valid content archive of 64 MB or smaller.',
      )
    }
    try {
      if (!input || typeof input !== 'object' || typeof input.requestId !== 'string')
        return error(400, 'The import request is invalid. Reload the form.')
      if (input.reviewedSiteFiles !== undefined && typeof input.reviewedSiteFiles !== 'boolean')
        return error(400, 'Confirm the site file review before importing.')
      const destination = SiteArchiveDestination.parse(input.destination)
      const siteId = await (deps.import ?? importSiteArchive)(
        session.userId,
        input.requestId,
        destination,
        input.archive,
        deps.media(),
        ...(input.reviewedSiteFiles === true ? ([true] as const) : []),
      )
      return Response.json({ siteId, status: 'draft' }, { status: 201, headers })
    } catch (cause) {
      return handledError(cause)
    }
  }
}
