// The session boundary (SPEC §4, §6.1).
//
// Two separate questions, deliberately not collapsed into one:
//
//   1. Who does the auth provider say this is?  -> AuthProvider.verify()
//   2. Is that person a user of this product?   -> resolvePrincipal()
//
// A verified sign-in with no active product record is authenticated and not
// authorized. Because the product check happens on every request, deactivating
// someone takes effect on their next request whatever the token's lifetime
// says — and the database enforces the same rule independently, so this is the
// convenient check rather than the only one.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Principal, SiteRole } from '@cms/domain'
import { asUser } from './database.ts'
import { countPerfAuth } from './perf-trace.ts'

export type AuthSubject = { subject: string; email: string; authenticatedAt?: number }
export type VerifiedAuthSession = { token: string; refreshToken: string; expiresIn: number; subject: AuthSubject }

/** Provider-specific code lives behind this and nowhere else. */
export type AuthProvider = {
  readonly name: string
  /** Verify whatever the browser presented. Returns null when unauthenticated. */
  verify(token: string | null | undefined): Promise<AuthSubject | null>
  /** Mint the value the local adapter stores in a cookie. Hosted providers do not implement this. */
  issue?(subject: AuthSubject): Promise<string>
  requestSignIn?(email: string, options?: { invited: boolean; codeChallenge?: string }): Promise<void>
  completeSignIn?(tokenHash: string): Promise<VerifiedAuthSession | null>
  completeCodeSignIn?(code: string, verifier: string): Promise<VerifiedAuthSession | null>
  /** Where to send the browser to sign in with the organization's Microsoft account, when enabled. */
  microsoftSignInUrl?(codeChallenge: string): string
  /** Sign in without sending an email. Null for a wrong email or password. */
  signInWithPassword?(email: string, password: string): Promise<VerifiedAuthSession | null>
  /** Set or replace the signed-in person's own password, using their current session. */
  setPassword?(token: string, password: string): Promise<PasswordChange>
  refresh?(refreshToken: string): Promise<VerifiedAuthSession | null>
  revoke?(token: string): Promise<void>
}

/** `signed-out` means the session can no longer change the password; sign in again first. */
export type PasswordChange = 'saved' | 'weak' | 'unchanged' | 'signed-out'

/** bcrypt, which the hosted provider uses, reads at most 72 bytes of a password. */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_BYTES = 72

export const SESSION_COOKIE = 'cms_session'
export const HOSTED_SESSION_COOKIE = '__Host-cms_session'
export const REFRESH_COOKIE = '__Host-cms_refresh'
export const SIGN_IN_PROOF_COOKIE = '__Host-cms_sign_in'
export const REFRESH_COOKIE_MAX_AGE = 8 * 60 * 60

/**
 * A real HMAC-signed session for local development and tests: the same shape
 * as a hosted provider's verified subject, without needing an account to exist
 * (SPEC §12 — providers are introduced only when code requires them).
 */
export function createLocalAuthProvider(secret: string): AuthProvider & Required<Pick<AuthProvider, 'issue'>> {
  if (secret.length < 16) throw new Error('local auth secret must be at least 16 characters')
  const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

  return {
    name: 'local',
    async issue(subject) {
      const payload = Buffer.from(JSON.stringify(subject)).toString('base64url')
      return `${payload}.${sign(payload)}`
    },
    async verify(token) {
      countPerfAuth('authChecks')
      if (!token) return null
      const dot = token.lastIndexOf('.')
      if (dot <= 0) return null
      const payload = token.slice(0, dot)
      const provided = Buffer.from(token.slice(dot + 1))
      const expected = Buffer.from(sign(payload))
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null
      try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthSubject
        return typeof parsed?.subject === 'string' && typeof parsed?.email === 'string' ? parsed : null
      } catch {
        return null
      }
    },
  }
}

export type Session = { principal: Principal; email: string; displayName: string; authenticatedAt?: number }

/**
 * Look the verified subject up as a product user. Returns null for: no record,
 * a disabled record, or a subject that has never accepted an invite.
 *
 * This goes through a narrow command rather than a table read, because the
 * lookup happens before an identity exists to scope a table read by — and the
 * alternative, letting an identity-less connection read app_users, would hand
 * every session the ability to enumerate the user table (migration 0005).
 */
export async function resolvePrincipal(subject: AuthSubject): Promise<Session | null> {
  const session = await asUser({ userId: null }, async client => {
    const { rows } = await client.query<{
      user_id: string
      email: string
      display_name: string
      is_super_admin: boolean
      memberships: Record<string, SiteRole>
    }>('SELECT * FROM app.resolve_session($1,$2)', [subject.subject, subject.email])

    const found = rows[0]
    if (!found) return null

    const principal: Principal = {
      userId: found.user_id,
      status: 'active',
      isSuperAdmin: found.is_super_admin,
      memberships: new Map(Object.entries(found.memberships ?? {})),
    }
    return {
      principal,
      email: found.email,
      displayName: found.display_name,
      ...(subject.authenticatedAt === undefined ? {} : { authenticatedAt: subject.authenticatedAt }),
    }
  })
  if (!session || session.principal.isSuperAdmin) return session
  // Release the identity-lookup connection before taking the scoped one.
  const scopes = await asUser(
    { userId: session.principal.userId },
    async client =>
      (
        await client.query<{
          pages: Record<string, { siteId: string; role: 'contributor' | 'editor' }>
          divisions: Record<string, { siteId: string; name: string }>
        }>('SELECT app.current_page_scopes() AS pages, app.current_division_scopes() AS divisions')
      ).rows[0],
  )
  if (scopes?.pages && Object.keys(scopes.pages).length)
    session.principal.pageScopes = new Map(Object.entries(scopes.pages))
  if (scopes?.divisions && Object.keys(scopes.divisions).length)
    session.principal.divisionScopes = new Map(Object.entries(scopes.divisions))
  return session
}

/** Attach a verified auth subject to an invited product user. */
export async function acceptInvite(subject: AuthSubject): Promise<string | null> {
  return asUser({ userId: null }, async client => {
    const { rows } = await client.query<{ id: string }>('SELECT app.attach_auth_subject($1,$2) AS id', [
      subject.email,
      subject.subject,
    ])
    return rows[0]?.id ?? null
  })
}
