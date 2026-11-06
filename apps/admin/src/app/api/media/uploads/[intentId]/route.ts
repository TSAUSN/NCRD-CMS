import { configuredMediaStore } from '@cms/platform'
import { createReceiveMediaUploadHandler } from '../../../../../lib/media-upload-handler.ts'
import { createPostgresAdminMediaUploadRepository } from '../../../../../lib/media-upload-repository.ts'

export const dynamic = 'force-dynamic'

const handle = createReceiveMediaUploadHandler({
  repository: createPostgresAdminMediaUploadRepository(),
  media: configuredMediaStore(),
})

export async function PUT(request: Request, context: { params: Promise<{ intentId: string }> }): Promise<Response> {
  return handle(request, (await context.params).intentId)
}
