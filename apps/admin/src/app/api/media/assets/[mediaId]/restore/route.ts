import { currentSession } from '../../../../../../lib/session.ts'
import { createRestoreMediaHandler } from '../../../../../../lib/media-mutation-handler.ts'
import { createPostgresMediaMutationRepository } from '../../../../../../lib/media-mutation-repository.ts'

export const dynamic = 'force-dynamic'

const handle = createRestoreMediaHandler({
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  repository: createPostgresMediaMutationRepository(),
})

export async function POST(request: Request, context: { params: Promise<{ mediaId: string }> }): Promise<Response> {
  return handle(request, (await context.params).mediaId)
}
