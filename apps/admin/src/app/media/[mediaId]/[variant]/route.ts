import { configuredMediaStore } from '@cms/platform'
import { currentSession } from '../../../../lib/session.ts'
import { createAdminMediaGetHandler } from '../../../../lib/media-delivery-handler.ts'
import { createPostgresAdminMediaDeliveryRepository } from '../../../../lib/media-delivery-repository.ts'

export const dynamic = 'force-dynamic'

const handle = createAdminMediaGetHandler({
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  repository: createPostgresAdminMediaDeliveryRepository(),
  media: configuredMediaStore(),
})

export async function GET(
  _request: Request,
  context: { params: Promise<{ mediaId: string; variant: string }> },
): Promise<Response> {
  const { mediaId, variant } = await context.params
  return handle(mediaId, variant)
}
