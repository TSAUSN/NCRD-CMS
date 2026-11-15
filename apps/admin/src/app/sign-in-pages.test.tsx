import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SIGN_IN_METHOD_COOKIE } from '../lib/sign-in-flow.ts'

const state = vi.hoisted(() => ({ microsoft: false, method: 'email', proof: false }))
vi.mock('server-only', () => ({}))
vi.mock('../lib/session.ts', () => ({
  currentSession: async () => null,
  authProvider: () => ({
    name: 'supabase',
    signInWithPassword: () => {},
    ...(state.microsoft ? { microsoftSignInUrl: () => '' } : {}),
  }),
}))
vi.mock('./actions/auth.ts', () => ({
  signIn: async () => {},
  signInWithMicrosoft: async () => {},
  signInWithPassword: async () => {},
  completeSignIn: async () => {},
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    has: () => state.proof,
    get: (name: string) => (name === SIGN_IN_METHOD_COOKIE ? { value: state.method } : undefined),
  }),
}))
import SignInPage from './sign-in/page.tsx'
import ConfirmSignIn from './auth/confirm/page.tsx'

beforeEach(() => {
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
