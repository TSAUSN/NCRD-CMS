/**
 * Browser mutation routes require the Origin authority to match the authority
 * the browser addressed.
 *
 * `request.url` may name an internal Next.js listener after a reverse proxy
 * (and does even in `next start` when Chromium uses 127.0.0.1 while the server
 * identifies itself as localhost). The HTTP Host header is the browser-facing
 * authority; falling back to the URL keeps direct unit invocations useful.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const authority = request.headers.get('host')?.trim() || new URL(request.url).host
    return parsed.host.toLocaleLowerCase() === authority.toLocaleLowerCase()
  } catch {
    return false
  }
}

/** Include the browser-facing scheme and Fetch Metadata in mutation checks. */
export function isStrictSameOriginRequest(request: Request, trustProxyHeaders = false): boolean {
  if (!isSameOriginRequest(request)) return false
  const origin = new URL(request.headers.get('origin')!)
  const scheme =
    (trustProxyHeaders ? request.headers.get('x-forwarded-proto') : null) ?? new URL(request.url).protocol.slice(0, -1)
  return (
    origin.protocol === `${scheme}:` &&
    origin.username === '' &&
    origin.password === '' &&
    origin.pathname === '/' &&
    !origin.search &&
    !origin.hash &&
    !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '')
  )
}
