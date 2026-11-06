import { configuredMediaStore } from '@cms/platform'
import { currentSession } from '../../../../../../lib/session.ts'
import { createBeginMediaUploadHandler } from '../../../../../../lib/media-upload-handler.ts'
import { createPostgresAdminMediaUploadRepository } from '../../../../../../lib/media-upload-repository.ts'

export const dynamic = 'force-dynamic'

const handle = createBeginMediaUploadHandler({
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  repository: createPostgresAdminMediaUploadRepository(),
  media: configuredMediaStore(),
})

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  return handle(request, (await context.params).siteId)
}
