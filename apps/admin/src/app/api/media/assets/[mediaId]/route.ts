import { currentSession } from '../../../../../lib/session.ts'
import {
  createDeleteMediaHandler,
  createUpdateMediaMetadataHandler,
} from '../../../../../lib/media-mutation-handler.ts'
import { createPostgresMediaMutationRepository } from '../../../../../lib/media-mutation-repository.ts'

export const dynamic = 'force-dynamic'

const handle = createDeleteMediaHandler({
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  repository: createPostgresMediaMutationRepository(),
})

const update = createUpdateMediaMetadataHandler({
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  repository: createPostgresMediaMutationRepository(),
})

export async function DELETE(request: Request, context: { params: Promise<{ mediaId: string }> }): Promise<Response> {
  return handle(request, (await context.params).mediaId)
}

export async function PATCH(request: Request, context: { params: Promise<{ mediaId: string }> }): Promise<Response> {
  return update(request, (await context.params).mediaId)
}
