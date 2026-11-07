import { NextResponse, type NextRequest } from 'next/server'
import { configuredAuthProvider, REFRESH_COOKIE } from '@cms/platform'
import { requestCanvasFrameOrigin } from './lib/canvas-frame-policy.ts'
import { renewSession } from './lib/session-renewal.ts'
import { adminContentSecurityPolicy, contentPolicyNonce, hasOwnContentPolicy } from './lib/content-security.ts'

// Session renewal is cookie transport only; these paths never renew.
const NO_RENEWAL = /^\/(?:health|auth\/(?:confirm|local-chapter)|sign-in)(?:\/|$)/

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  // Renew first so origin authorization and SSR see the same current cookie.
  const renewed =
    !NO_RENEWAL.test(path) && request.cookies.has(REFRESH_COOKIE)
      ? await renewSession(request, configuredAuthProvider())
      : null
  // Only a new HTML document can acquire a frame origin. The strict CSP is
  // still sent for other requests, and authorization runs in every handler.
  const isDocument = !request.headers.has('RSC') && !request.headers.has('Next-Action') && !/^\/api(?:\/|$)/.test(path)
  const origin = isDocument ? await requestCanvasFrameOrigin(request) : null
  // Root layouts persist across client navigation; their marker describes the
  // actual document policy, not the policy of a later RSC response.
  request.headers.set('x-cms-canvas-origin', origin ?? '')
  // Next.js reads the nonce from the request and puts it on its own scripts.
  const policy = hasOwnContentPolicy(path)
    ? null
    : adminContentSecurityPolicy(contentPolicyNonce(), process.env.NODE_ENV === 'development', origin)
  if (policy) request.headers.set('content-security-policy', policy)
  const response = NextResponse.next({ request: { headers: request.headers } })
  // Renewal owns these browser-facing effects; forwarding headers are rebuilt
  // above so the fresh nonce/cookies cannot be overwritten by its old snapshot.
  if (renewed) {
    for (const cookie of renewed.cookies.getAll()) response.cookies.set(cookie)
    const cache = renewed.headers.get('cache-control')
    if (cache) response.headers.set('cache-control', cache)
  }
  if (policy) response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
