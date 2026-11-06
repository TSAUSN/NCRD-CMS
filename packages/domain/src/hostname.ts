// Host normalization (SPEC §5, §6.10). Public routing compares against this
// exact shape, so anything that is not a plain lowercase hostname is rejected
// rather than coerced into something that might match a different tenant.

export type NormalizedHost = string

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Lowercase ASCII/punycode, no port, no trailing dot, no userinfo, no path.
 * Returns null for anything that cannot be one hostname — the caller turns
 * that into a neutral 404 rather than guessing.
 */
export function normalizeHost(raw: string | null | undefined): NormalizedHost | null {
  if (!raw) return null
  let host = raw.trim().toLowerCase()

  // A Host header carrying anything but a host is not a host we will resolve.
  if (host.includes('/') || host.includes('@') || host.includes(' ')) return null

  if (host.startsWith('[')) return null // IPv6 literals never map to a tenant
  const colon = host.indexOf(':')
  if (colon !== -1) {
    const port = host.slice(colon + 1)
    if (!/^\d{1,5}$/.test(port)) return null
    host = host.slice(0, colon)
  }
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host.length === 0 || host.length > 253) return null

  // Punycode is already ASCII; a non-ASCII host is refused rather than encoded
  // here, so the value stored and the value compared are always identical.
  const labels = host.split('.')
  if (labels.some(label => !LABEL.test(label))) return null
  return host
}

/** The apex form of a host, for the automatic www ⇄ apex redirect. */
export function stripWww(host: NormalizedHost): NormalizedHost {
  return host.startsWith('www.') ? host.slice(4) : host
}

/** Normalize a request path to the shape published_routes stores. */
export function normalizePath(raw: string | null | undefined): string {
  if (!raw) return '/'
  let path = raw.split('?')[0]!.split('#')[0]!
  if (!path.startsWith('/')) path = `/${path}`
  path = path.toLowerCase()
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path === '' ? '/' : path
}
