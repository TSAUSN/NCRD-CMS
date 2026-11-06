import { currentSession } from '../../../../../../lib/session.ts'
import { mediaUsage } from '../../../../../../lib/media-organization-repository.ts'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_request: Request, context: { params: Promise<{ mediaId: string }> }): Promise<Response> {
  const { mediaId } = await context.params
  const session = await currentSession()
  if (!session || !UUID.test(mediaId))
    return Response.json(
      { error: 'not-found' },
      {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      },
    )
  const usage = await mediaUsage(session.principal.userId, mediaId)
  if (!usage)
    return Response.json(
      { error: 'not-found' },
      {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      },
    )
  return Response.json(
    { usage },
    {
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}
