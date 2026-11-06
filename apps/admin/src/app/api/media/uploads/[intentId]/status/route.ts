import { currentSession } from '../../../../../../lib/session.ts'
import { createMediaUploadStatusHandler } from '../../../../../../lib/media-upload-handler.ts'
import { createPostgresMediaUploadStatusRepository } from '../../../../../../lib/media-upload-repository.ts'

export const dynamic = 'force-dynamic'

const handle = createMediaUploadStatusHandler({
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  repository: createPostgresMediaUploadStatusRepository(),
})

export async function GET(_request: Request, context: { params: Promise<{ intentId: string }> }): Promise<Response> {
  return handle((await context.params).intentId)
}
