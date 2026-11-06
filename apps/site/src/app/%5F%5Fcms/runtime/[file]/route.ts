import { serveFixedRuntime } from '../../../../lib/fixed-runtime-handler.ts'
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveFixedRuntime(request, (await params).file)
}
export const HEAD = GET
