import { SCRIPTLESS_PREVIEW_CSP } from '../../../../../lib/scriptless-preview.ts'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../../../lib/session.ts'
import { previewSiteReleasePage } from '../../../../../lib/releases.ts'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'content-security-policy': SCRIPTLESS_PREVIEW_CSP,
}
export async function GET(_request: Request, { params }: { params: Promise<{ releaseId: string; pageId: string }> }) {
  const session = await currentSession()
  if (!session) return new Response('Sign in to preview this release.', { status: 401, headers })
  const { releaseId, pageId } = await params
  if (!UUID.test(releaseId) || !UUID.test(pageId))
    return new Response('Release preview not found.', { status: 404, headers })
  try {
    const html = await previewSiteReleasePage(session.principal.userId, releaseId, pageId)
    return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
  } catch (error) {
    if (error instanceof DomainError)
      return new Response(error.message, {
        status: error.kind === 'not_found' ? 404 : error.kind === 'not_authorized' ? 403 : 409,
        headers,
      })
    return new Response('The release preview could not be generated. No publication was committed.', {
      status: 500,
      headers,
    })
  }
}
