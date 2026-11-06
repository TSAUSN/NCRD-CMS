/** A log metric for each public render attempt. The host aggregates error rate
 * across instances; it must not log tenant paths, query strings or raw errors. */
export async function observePublicResponse(
  operation: () => Promise<Response>,
  log: (line: string) => void = console.log,
): Promise<Response> {
  const started = performance.now()
  let response: Response
  try {
    response = await operation()
  } catch {
    response = new Response('This page is temporarily unavailable. Please try again shortly.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' },
    })
  }
  log(
    JSON.stringify({
      event: 'cms.public.request',
      role: 'site',
      status: response.status,
      error: response.status >= 500,
      durationMs: Math.round(performance.now() - started),
    }),
  )
  return response
}
