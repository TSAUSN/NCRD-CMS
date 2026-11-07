/** Call only with headers derived from a receipt the resolver has authorized. */
export function storedObjectNotModified(
  request: Request | undefined,
  headers: Record<string, string>,
): Response | null {
  if (
    !request ||
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    request.headers.get('if-none-match') !== headers.etag
  )
    return null
  return new Response(null, { status: 304, headers })
}
