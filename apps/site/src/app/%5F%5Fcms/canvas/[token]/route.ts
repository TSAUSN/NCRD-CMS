import { createCanvasPageHandler } from '../../../../lib/canvas-page-handler.ts'
import { canvasSnapshot } from '../../../../lib/canvas-preview-repository.ts'
import { canvasRuntimeFiles } from '../../../../lib/canvas-runtime-files.ts'
import { resolveRequestHost } from '../../../../lib/routing.ts'
export const dynamic = 'force-dynamic'
const handle = createCanvasPageHandler({
  snapshot: canvasSnapshot,
  runtime: canvasRuntimeFiles,
  host: resolveRequestHost,
})
export async function GET(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  return handle(request, (await context.params).token)
}
export const HEAD = GET
