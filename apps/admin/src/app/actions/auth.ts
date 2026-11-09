'use server'
import { queueLocalChapterSignIn } from '../../lib/local-chapter-mail.ts'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import {
  acceptInvite,
  AuthServiceError,
  asUser,
  createSignInProof,
  resolvePrincipal,
  localSessionCookieSecure,
  HOSTED_SESSION_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE,
  SIGN_IN_PROOF_COOKIE,
} from '@cms/platform'
import { authProvider } from '../../lib/session.ts'

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) redirect('/sign-in?error=missing-email')

  let destination = '/sign-in?sent=1'
  try {
    const provider = authProvider()
    if (provider.name === 'local' && provider.issue) {
      const scoped = await asUser(
        { userId: null },
        async client =>
          (await client.query<{ scoped: boolean }>('SELECT app.is_scoped_chapter_email($1) AS scoped', [email])).rows[0]
            ?.scoped === true,
      )
      if (scoped) {
        await asUser({ userId: null }, client => queueLocalChapterSignIn(client, email))
      } else {
        const token = await provider.issue({ subject: `local|${email}`, email })
        ;(await cookies()).set(SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: localSessionCookieSecure(),
          path: '/',
          maxAge: 3600,
        })
        destination = '/'
      }
    } else if (provider.requestSignIn) {
      const invited = await asUser(
        { userId: null },
        async client =>
          (await client.query<{ invited: boolean }>('SELECT app.is_invited_email($1) AS invited', [email])).rows[0]
            ?.invited === true,
      )
      const proof = provider.completeCodeSignIn ? createSignInProof() : null
      if (proof)
        (await cookies()).set(SIGN_IN_PROOF_COOKIE, proof.verifier, {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: '/',
          maxAge: 3600,
        })
      await provider.requestSignIn(email, { invited, ...(proof ? { codeChallenge: proof.challenge } : {}) })
    } else {
      destination = '/sign-in?error=unavailable'
    }
  } catch (error) {
    destination =
      error instanceof AuthServiceError && error.kind === 'rate_limit'
        ? '/sign-in?error=rate-limit'
        : '/sign-in?error=unavailable'
  }
  redirect(destination)
}

/** Starts Microsoft sign-in. The browser proof cookie ties the returned code to this browser. */
export async function signInWithMicrosoft(): Promise<void> {
  let destination = '/sign-in?error=unavailable'
  try {
    const provider = authProvider()
    if (provider.microsoftSignInUrl) {
      const proof = createSignInProof()
      ;(await cookies()).set(SIGN_IN_PROOF_COOKIE, proof.verifier, {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 600,
      })
      destination = provider.microsoftSignInUrl(proof.challenge)
    }
  } catch {
    destination = '/sign-in?error=unavailable'
  }
  redirect(destination)
}

export async function completeSignIn(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get('tokenHash') ?? '')
  const code = String(formData.get('authCode') ?? '')
  let destination = '/sign-in?error=expired-link'
  try {
    const provider = authProvider()
    const jar = await cookies()
    const verifier = jar.get(SIGN_IN_PROOF_COOKIE)?.value
    // The browser proof is single-use, including on a refused exchange.
    jar.set(SIGN_IN_PROOF_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
    const verified = code
      ? verifier
        ? await provider.completeCodeSignIn?.(code, verifier)
        : null
      : await provider.completeSignIn?.(tokenHash)
    if (verified) {
      const session = await resolvePrincipal(verified.subject)
      if (session) {
        await acceptInvite(verified.subject)
        ;(await cookies()).set(HOSTED_SESSION_COOKIE, verified.token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: '/',
          maxAge: verified.expiresIn,
        })
        ;(await cookies()).set(REFRESH_COOKIE, verified.refreshToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: '/',
          maxAge: REFRESH_COOKIE_MAX_AGE,
        })
        destination = '/'
      } else {
        await provider.revoke?.(verified.token).catch(() => {})
        destination = '/sign-in?error=no-access'
      }
    }
  } catch {
    destination = '/sign-in?error=unavailable'
  }
  redirect(destination)
}

export async function signOut(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(HOSTED_SESSION_COOKIE)?.value ?? jar.get(SESSION_COOKIE)?.value
  try {
    if (token) await authProvider().revoke?.(token)
  } catch {
    // A provider outage must not stop this browser from ending its CMS session.
  }
  jar.delete(SESSION_COOKIE)
  jar.set(SIGN_IN_PROOF_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
  jar.set(HOSTED_SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
  jar.set(REFRESH_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
  redirect('/sign-in')
}
