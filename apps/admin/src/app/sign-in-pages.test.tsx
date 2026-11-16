import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RECOVERY_EMAIL_COOKIE, SIGN_IN_METHOD_COOKIE } from '../lib/sign-in-flow.ts'

const state = vi.hoisted(() => ({ microsoft: false, method: 'email', proof: false, recovery: false }))
vi.mock('server-only', () => ({}))
vi.mock('../lib/session.ts', () => ({
  currentSession: async () => null,
  authProvider: () => ({
    name: 'supabase',
    signInWithPassword: () => {},
    requestPasswordRecovery: () => {},
    ...(state.microsoft ? { microsoftSignInUrl: () => '' } : {}),
  }),
}))
vi.mock('./actions/auth.ts', () => ({
  signIn: async () => {},
  signInWithMicrosoft: async () => {},
  signInWithPassword: async () => {},
  completeSignIn: async () => {},
  requestPasswordRecovery: async () => {},
  completeRecoveryCode: async () => {},
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    has: () => state.proof,
    get: (name: string) =>
      name === SIGN_IN_METHOD_COOKIE
        ? { value: state.method }
        : name === RECOVERY_EMAIL_COOKIE && state.recovery
          ? { value: 'owner@example.test' }
          : undefined,
  }),
}))
import SignInPage from './sign-in/page.tsx'
import ConfirmSignIn from './auth/confirm/page.tsx'
import ResetPasswordPage from './sign-in/reset/page.tsx'

beforeEach(() => {
  vi.unstubAllEnvs()
  state.recovery = false
  state.microsoft = false
  state.method = 'email'
  state.proof = false
})

it('shows Microsoft only after configuration while keeping the same password and email fallback fields', async () => {
  const off = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }))
  expect(off).not.toContain('Sign in with Microsoft')
  state.microsoft = true
  const on = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }))
  expect(on).toContain('Sign in with Microsoft')
  expect(on).toContain('name="email"')
  expect(on).toContain('autoComplete="username"')
  expect(on).toContain('autoComplete="current-password"')
  expect(on).toContain('Show password')
  expect(on).toContain('Email me a sign-in link')
})

it('does not offer a confirmation submit after Microsoft denial or a foreign-browser callback', async () => {
  state.method = 'microsoft'
  const denied = renderToStaticMarkup(
    await ConfirmSignIn({
      searchParams: Promise.resolve({ error: 'access_denied', error_code: '<untrusted-provider-text>' }),
    }),
  )
  expect(denied).toContain('Microsoft sign-in did not finish')
  expect(denied).not.toContain('Continue to CMS')
  expect(denied).not.toContain('untrusted-provider-text')
  const foreign = renderToStaticMarkup(
    await ConfirmSignIn({ searchParams: Promise.resolve({ code: '11111111-1111-4111-8111-111111111111' }) }),
  )
  expect(foreign).toContain('browser where you started')
  expect(foreign).not.toContain('Continue to CMS')
})

it('offers signed-out recovery and never shows code entry before its email is configured', async () => {
  const login = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }))
  expect(login).toContain('href="/sign-in/reset"')
  const initial = renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve({}) }))
  expect(initial).toContain('Send recovery email')
  expect(initial).not.toContain('Recovery code')
  state.method = 'recovery'
  state.recovery = true
  const sent = renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve({ sent: '1' }) }))
  expect(sent).toContain('If this address has an account')
  expect(sent).not.toContain('owner@example.test')
  vi.stubEnv('AUTH_RECOVERY_CODE_ENABLED', 'true')
  const code = renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve({ sent: '1' }) }))
  expect(code).toContain('autoComplete="one-time-code"')
})

it('renders a recovery confirmation without verifying or consuming the credential on GET', async () => {
  const html = renderToStaticMarkup(
    await ConfirmSignIn({ searchParams: Promise.resolve({ token_hash: 'a'.repeat(64), type: 'recovery' }) }),
  )
  expect(html).toContain('Continue to reset password')
  expect(html).toContain('name="type" value="recovery"')
  state.method = 'recovery'
  const expired = renderToStaticMarkup(await ConfirmSignIn({ searchParams: Promise.resolve({ error: 'expired' }) }))
  expect(expired).toContain('Request a new recovery email')
  expect(expired).not.toContain('Continue to reset password')
})
