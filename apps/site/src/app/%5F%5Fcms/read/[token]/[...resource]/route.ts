import { configuredMediaStore } from '@cms/platform'
import { createCanvasResourceHandler } from '../../../../../lib/canvas-resource-handler.ts'
import { canvasResourceRepository } from '../../../../../lib/canvas-preview-repository.ts'
import { resolveRequestHost } from '../../../../../lib/routing.ts'
export const dynamic = 'force-dynamic'
const handle = createCanvasResourceHandler({
  repository: canvasResourceRepository,
  store: configuredMediaStore(),
  host: resolveRequestHost,
})
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; resource: string[] }> },
): Promise<Response> {
  const { token, resource } = await context.params
  return handle(request, token, resource)
}
