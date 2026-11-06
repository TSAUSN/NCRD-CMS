import { currentSession } from '../../../../../lib/session.ts'
import { mediaLibraryQuery, mediaLibraryResponse } from '../../../../../lib/media-organization-handler.ts'
import { listMediaLibrary } from '../../../../../lib/media-organization-repository.ts'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  const session = await currentSession()
  if (!session) return mediaLibraryResponse(404, 'This media library was not found.')
  const { siteId } = await context.params
  const query = mediaLibraryQuery(new URL(request.url).searchParams)
  if (!query) return mediaLibraryResponse(400, 'The media filters are invalid.')
  try {
    const result = await listMediaLibrary(session.principal.userId, siteId, query)
    return Response.json(result, {
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    if (['not_found', 'not_authorized'].includes(String((error as { kind?: unknown }).kind))) {
      return mediaLibraryResponse(404, 'This media library was not found.')
    }
    throw error
  }
}
