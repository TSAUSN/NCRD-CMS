import { fixedRuntimeFile } from '@cms/renderer'
/** Fixed names and exact current hashes only; no path or authored source is read. */
export function serveFixedRuntime(request: Request, file: string): Response {
  const runtime = fixedRuntimeFile(file)
  if (!runtime) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  return new Response(request.method === 'HEAD' ? null : runtime.source, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=31536000, immutable',
      'referrer-policy': 'no-referrer',
    },
  })
}
