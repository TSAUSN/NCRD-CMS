import { countPerfAuth } from './perf-trace.ts'
import { createLocalAuthProvider, type AuthProvider, type AuthSubject, type VerifiedAuthSession } from './session.ts'
import { createHash, randomBytes } from 'node:crypto'

type Environment = Record<string, string | undefined>
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** The verifier stays in an HttpOnly cookie; only its SHA-256 challenge goes
 * to Auth. Default Supabase email templates can then use the standard PKCE
 * redirect without returning access/refresh tokens through browser JavaScript. */
export function createSignInProof() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** Explicit configuration: a production build never silently becomes an
 * email-only test login. Built-app browser tests must opt in and use loopback. */
export function configuredAuthProvider(env: Environment = process.env): AuthProvider {
  const provider = env['AUTH_PROVIDER'] ?? (env['NODE_ENV'] === 'production' ? 'supabase' : 'local')
  if (provider === 'local') {
    if (env['NODE_ENV'] === 'production') {
      if (
        env['CMS_LOCAL_TEST_MODE'] !== 'true' ||
        !isLoopbackUrl(env['DATABASE_URL_AUTHENTICATED']) ||
        !isLoopbackUrl(env['ADMIN_ORIGIN'])
      ) {
        throw new Error('Local auth is disabled in production. Configure Supabase authentication.')
      }
    }
    const secret = env['AUTH_SECRET']
    if (!secret) throw new Error('AUTH_SECRET is required for local authentication')
    return createLocalAuthProvider(secret)
  }
  if (provider !== 'supabase') throw new Error('AUTH_PROVIDER must be local or supabase')
  return createSupabaseAuthProvider({
    url: env['SUPABASE_URL'] ?? '',
    publishableKey: env['SUPABASE_PUBLISHABLE_KEY'] ?? '',
    adminOrigin: env['ADMIN_ORIGIN'] ?? '',
    microsoftSignIn: env['AUTH_MICROSOFT_ENABLED'] === 'true',
  })
}

function isLoopbackUrl(value: string | undefined): boolean {
  try {
    return LOOPBACK.has(new URL(value ?? '').hostname)
  } catch {
    return false
  }
}

/** Only the explicitly enabled, loopback-only local provider may use an HTTP
 * cookie in a built demo. Hosted sessions always keep their Secure cookie. */
export function localSessionCookieSecure(env: Environment = process.env): boolean {
  if (env['NODE_ENV'] !== 'production') return false
  return !(
    env['AUTH_PROVIDER'] === 'local' &&
    env['CMS_LOCAL_TEST_MODE'] === 'true' &&
    isLoopbackUrl(env['DATABASE_URL_AUTHENTICATED']) &&
    isLoopbackUrl(env['ADMIN_ORIGIN']) &&
    new URL(env['ADMIN_ORIGIN']!).protocol === 'http:'
  )
}

function httpsOrigin(value: string, setting: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${setting} must be an HTTPS origin`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error(`${setting} must be an HTTPS origin`)
  return url.origin
}

export class AuthServiceError extends Error {
  readonly kind: 'rate_limit' | 'unavailable'
  constructor(kind: 'rate_limit' | 'unavailable') {
    super(
      kind === 'rate_limit'
        ? 'Please wait a minute before requesting another sign-in link.'
        : 'Sign-in is temporarily unavailable. Please try again shortly.',
    )
    this.name = 'AuthServiceError'
    this.kind = kind
  }
}

/** Supabase's documented Auth HTTP API, using only a publishable API key.
 * Never decodes an unverified JWT or trusts a browser-provided email address.
 * API contract: https://github.com/supabase/auth/blob/master/openapi.yaml */
export function createSupabaseAuthProvider(
  config: {
    url: string
    publishableKey: string
    adminOrigin: string
    /** Offer "Sign in with Microsoft" through the project's Azure provider. */
    microsoftSignIn?: boolean
  },
  fetcher: typeof fetch = fetch,
): AuthProvider {
  const origin = httpsOrigin(config.url, 'SUPABASE_URL')
  const adminOrigin = httpsOrigin(config.adminOrigin, 'ADMIN_ORIGIN')
  if (!config.publishableKey || /\s/.test(config.publishableKey)) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY is required')
  }
  if (config.publishableKey.startsWith('sb_secret_'))
    throw new Error('Auth must use a publishable key, not a secret key')
  // Reject legacy service-role JWT keys too. This is key classification, never
  // authentication; the provider verifies all user credentials separately.
  const keyParts = config.publishableKey.split('.')
  if (keyParts.length === 3) {
    try {
      if (JSON.parse(Buffer.from(keyParts[1]!, 'base64url').toString())?.role === 'service_role') {
        throw new Error('service_role')
      }
    } catch {
      throw new Error('Auth must use a valid publishable or anon key')
    }
  }

  async function request(path: string, body?: Record<string, unknown>, token?: string): Promise<Response> {
    try {
      countPerfAuth('outboundAuthCalls')
      return await fetcher(`${origin}/auth/v1${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          apikey: config.publishableKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new AuthServiceError('unavailable')
    }
  }

  async function verify(token: string | null | undefined): Promise<AuthSubject | null> {
    countPerfAuth('authChecks')
    if (!token || token.length > 3800 || /[\s\r\n]/.test(token)) return null
    const response = await request('/user', undefined, token)
    if ([400, 401, 403].includes(response.status)) return null
    if (!response.ok) throw new AuthServiceError('unavailable')
    let user: { id?: unknown; email?: unknown; email_confirmed_at?: unknown; is_anonymous?: unknown }
    try {
      user = (await response.json()) as typeof user
    } catch {
      throw new AuthServiceError('unavailable')
    }
    if (
      !user ||
      typeof user.id !== 'string' ||
      !user.id ||
      typeof user.email !== 'string' ||
      !user.email ||
      typeof user.email_confirmed_at !== 'string' ||
      !user.email_confirmed_at ||
      user.is_anonymous === true
    )
      return null
    let authenticatedAt: number | undefined
    // The provider has already verified this exact access token. Refresh-time
    // iat and token_refresh AMR entries must never count as a new sign-in.
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
      const methods = new Set(['otp', 'magiclink', 'email/signup', 'invite', 'oauth', 'sso/saml', 'totp', 'password'])
      if (claims.sub === user.id && Array.isArray(claims.amr)) {
        const times = claims.amr
          .filter(
            (entry: { method?: string; timestamp?: unknown }) =>
              methods.has(entry.method ?? '') &&
              typeof entry.timestamp === 'number' &&
              Number.isFinite(entry.timestamp),
          )
          .map((entry: { timestamp: number }) => entry.timestamp)
        if (times.length) authenticatedAt = Math.max(...times)
      }
    } catch {
      /* No recent-auth claim: ordinary access still uses provider verification. */
    }
    return {
      subject: user.id,
      email: user.email.toLowerCase(),
      ...(authenticatedAt === undefined ? {} : { authenticatedAt }),
    }
  }

  async function verifiedSession(response: Response): Promise<VerifiedAuthSession | null> {
    if ([400, 401, 403, 422].includes(response.status)) return null
    if (response.status === 429) throw new AuthServiceError('rate_limit')
    if (!response.ok) throw new AuthServiceError('unavailable')
    let result: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    try {
      result = (await response.json()) as typeof result
    } catch {
      throw new AuthServiceError('unavailable')
    }
    if (
      !result ||
      typeof result.access_token !== 'string' ||
      typeof result.refresh_token !== 'string' ||
      !result.refresh_token ||
      result.refresh_token.length > 3800 ||
      /\s/.test(result.refresh_token) ||
      typeof result.expires_in !== 'number' ||
      !Number.isFinite(result.expires_in) ||
      result.expires_in < 1
    )
      return null
    const subject = await verify(result.access_token)
    return subject
      ? {
          token: result.access_token,
          refreshToken: result.refresh_token,
          subject,
          expiresIn: Math.min(3600, Math.floor(result.expires_in)),
        }
      : null
  }

  return {
    name: 'supabase',
    verify,
    async requestSignIn(email, options) {
      if (options?.codeChallenge && !/^[a-zA-Z0-9_-]{43}$/.test(options.codeChallenge))
        throw new AuthServiceError('unavailable')
      const response = await request(`/otp?redirect_to=${encodeURIComponent(`${adminOrigin}/auth/confirm`)}`, {
        email,
        create_user: options?.invited === true,
        ...(options?.codeChallenge ? { code_challenge: options.codeChallenge, code_challenge_method: 's256' } : {}),
      })
      if (response.status === 429) throw new AuthServiceError('rate_limit')
      // Unknown accounts get the same receipt as existing ones. New auth users
      // are provisioned via the administrator invitation workflow, never public signup.
      if ([400, 422].includes(response.status)) return
      if (!response.ok) throw new AuthServiceError('unavailable')
    },
    async completeSignIn(tokenHash) {
      if (!/^[a-zA-Z0-9_-]{20,512}$/.test(tokenHash)) return null
      const response = await request('/verify', { token_hash: tokenHash, type: 'email' })
      return verifiedSession(response)
    },
    async completeCodeSignIn(code, verifier) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code) ||
        !/^[a-zA-Z0-9._~-]{43,128}$/.test(verifier)
      )
        return null
      return verifiedSession(await request('/token?grant_type=pkce', { auth_code: code, code_verifier: verifier }))
    },
    // Microsoft returns the browser to the same confirmation page as an email
    // link, with a one-time code that completeCodeSignIn exchanges.
    ...(config.microsoftSignIn
      ? {
          microsoftSignInUrl(codeChallenge: string) {
            if (!/^[a-zA-Z0-9_-]{43}$/.test(codeChallenge)) throw new AuthServiceError('unavailable')
            const params = new URLSearchParams({
              provider: 'azure',
              scopes: 'email',
              redirect_to: `${adminOrigin}/auth/confirm`,
              code_challenge: codeChallenge,
              code_challenge_method: 's256',
            })
            return `${origin}/auth/v1/authorize?${params}`
          },
        }
      : {}),
    async refresh(refreshToken) {
      if (!refreshToken || refreshToken.length > 3800 || /\s/.test(refreshToken)) return null
      return verifiedSession(await request('/token?grant_type=refresh_token', { refresh_token: refreshToken }))
    },
    async revoke(token) {
      const response = await request('/logout?scope=local', {}, token)
      if (!response.ok && response.status !== 401) throw new AuthServiceError('unavailable')
    },
  }
}
