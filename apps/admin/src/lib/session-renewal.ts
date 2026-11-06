import { NextResponse, type NextRequest } from 'next/server'
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE, HOSTED_SESSION_COOKIE, type AuthProvider } from '@cms/platform'

/** Only decides when to ask the provider for a new token. Decoding this claim
 * NEVER authorizes anything; currentSession and every DB command still verify. */
export function needsSessionRenewal(token: string | undefined, now = Date.now()): boolean {
  if (!token || token.length > 3800) return true
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return true
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as { exp?: unknown }
    return typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp * 1000 <= now + 60_000
  } catch {
    return true
  }
}

/** Cookie transport before rendering/actions. No product authorization or
 * account lookup lives here; the request always reaches the existing gates. */
export async function renewSession(request: NextRequest, provider: AuthProvider): Promise<NextResponse> {
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value
  // Request headers always travel upstream, so the proxy's policy nonce reaches the page.
  if (!refresh || !provider.refresh || !needsSessionRenewal(request.cookies.get(HOSTED_SESSION_COOKIE)?.value)) {
    return NextResponse.next({ request: { headers: request.headers } })
  }
  let renewed
  try {
    renewed = await provider.refresh(refresh)
  } catch {
    // Keep credentials during a transient outage. The route's verified-session
    // check still fails closed, and an editor keeps the draft in their tab.
    return NextResponse.next({ request: { headers: request.headers } })
  }
  if (renewed) {
    request.cookies.set(HOSTED_SESSION_COOKIE, renewed.token)
    request.cookies.set(REFRESH_COOKIE, renewed.refreshToken)
  } else {
    request.cookies.delete(HOSTED_SESSION_COOKIE)
    request.cookies.delete(REFRESH_COOKIE)
  }
  // These headers go upstream to this app, not into the browser response.
  const response = NextResponse.next({ request: { headers: request.headers } })
  const options = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' }
  response.cookies.set(HOSTED_SESSION_COOKIE, renewed?.token ?? '', { ...options, maxAge: renewed?.expiresIn ?? 0 })
  response.cookies.set(REFRESH_COOKIE, renewed?.refreshToken ?? '', {
    ...options,
    maxAge: renewed ? REFRESH_COOKIE_MAX_AGE : 0,
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
