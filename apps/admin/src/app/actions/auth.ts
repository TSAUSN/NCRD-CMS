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
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE,
  SIGN_IN_PROOF_COOKIE,
  type AuthProvider,
  type VerifiedAuthSession,
} from '@cms/platform'
import { authProvider, currentSession } from '../../lib/session.ts'

/** A verified sign-in becomes a CMS session only for somebody with CMS access. */
async function openSession(provider: AuthProvider, verified: VerifiedAuthSession): Promise<string> {
  const session = await resolvePrincipal(verified.subject)
  if (!session) {
    await provider.revoke?.(verified.token).catch(() => {})
    return '/sign-in?error=no-access'
  }
  await acceptInvite(verified.subject)
  const jar = await cookies()
  jar.set(HOSTED_SESSION_COOKIE, verified.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: verified.expiresIn,
  })
  jar.set(REFRESH_COOKIE, verified.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  })
  return '/'
}

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
    if (verified) destination = await openSession(provider, verified)
  } catch {
    destination = '/sign-in?error=unavailable'
  }
  redirect(destination)
}

/** Signs in with an email and password. One answer covers a wrong email and a wrong password. */
export async function signInWithPassword(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const password = String(formData.get('password') ?? '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) redirect('/sign-in?error=missing-email')
  if (!password) redirect('/sign-in?error=missing-password')

  let destination = '/sign-in?error=wrong-password'
  try {
    const provider = authProvider()
    if (!provider.signInWithPassword) destination = '/sign-in?error=unavailable'
    else {
      const verified = await provider.signInWithPassword(email, password)
      if (verified) destination = await openSession(provider, verified)
    }
  } catch (error) {
    destination =
      error instanceof AuthServiceError && error.kind === 'rate_limit'
        ? '/sign-in?error=too-many-tries'
        : '/sign-in?error=unavailable'
  }
  redirect(destination)
}

/** Sets or replaces the signed-in person's own password. Nobody else's can be set here. */
export async function setPassword(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '')
  const again = String(formData.get('passwordAgain') ?? '')
  if (!(await currentSession())) redirect('/sign-in')
  if (password.length < PASSWORD_MIN_LENGTH) redirect('/account/password?error=too-short')
  if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) redirect('/account/password?error=too-long')
  if (password !== again) redirect('/account/password?error=mismatch')

  let destination = '/account/password?error=unavailable'
  try {
    const provider = authProvider()
    const token = (await cookies()).get(HOSTED_SESSION_COOKIE)?.value
    if (provider.setPassword && token) {
      const result = await provider.setPassword(token, password)
      destination =
        result === 'saved'
          ? '/account/password?saved=1'
          : result === 'signed-out'
            ? '/sign-in?reauth=1'
            : `/account/password?error=${result}`
    }
  } catch (error) {
    destination =
      error instanceof AuthServiceError && error.kind === 'rate_limit'
        ? '/account/password?error=too-many-tries'
        : '/account/password?error=unavailable'
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
