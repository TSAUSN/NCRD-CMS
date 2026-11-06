import { beforeEach, expect, it, vi } from 'vitest'
import { HOSTED_SESSION_COOKIE, REFRESH_COOKIE, SIGN_IN_PROOF_COOKIE } from '@cms/platform'

const stubs = vi.hoisted(() => ({
  asUser: vi.fn(),
  request: vi.fn(),
  exchange: vi.fn(),
  resolve: vi.fn(),
  accept: vi.fn(),
  revoke: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('../lib/session.ts', () => ({
  currentSession: vi.fn(),
  authProvider: () => ({
    name: 'supabase',
    requestSignIn: stubs.request,
    completeCodeSignIn: stubs.exchange,
    revoke: stubs.revoke,
  }),
}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: stubs.asUser,
  resolvePrincipal: stubs.resolve,
  acceptInvite: stubs.accept,
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: stubs.set, get: stubs.get }) }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
import { completeSignIn, signIn } from './actions/auth.ts'

beforeEach(() => {
  vi.resetAllMocks()
  stubs.revoke.mockResolvedValue(undefined)
  stubs.asUser.mockImplementation(async (_actor, action) =>
    action({ query: async () => ({ rows: [{ invited: true }] }) }),
  )
})

it('keeps the initiating proof in a secure HttpOnly cookie and sends its challenge with the checked invitation', async () => {
  const form = new FormData()
  form.set('email', 'owner@example.test')
  await expect(signIn(form)).rejects.toThrow('redirect:/sign-in?sent=1')
  const [name, proof, options] = stubs.set.mock.calls[0]!
  expect(name).toBe(SIGN_IN_PROOF_COOKIE)
  expect(options).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 3600 })
  expect(stubs.request).toHaveBeenCalledWith('owner@example.test', {
    invited: true,
    codeChallenge: expect.stringMatching(/^[a-zA-Z0-9_-]{43}$/),
  })
  expect(stubs.request.mock.calls[0]![1].codeChallenge).not.toBe(proof)
  expect(stubs.resolve).not.toHaveBeenCalled()
})

it('does not exchange a foreign-browser code with no initiating proof', async () => {
  const form = new FormData()
  form.set('authCode', '11111111-1111-4111-8111-111111111111')
  await expect(completeSignIn(form)).rejects.toThrow('redirect:/sign-in?error=expired-link')
  expect(stubs.exchange).not.toHaveBeenCalled()
  expect(stubs.set).toHaveBeenCalledWith(SIGN_IN_PROOF_COOKIE, '', expect.objectContaining({ secure: true, maxAge: 0 }))
  expect(stubs.set.mock.calls.some(([name]) => [HOSTED_SESSION_COOKIE, REFRESH_COOKIE].includes(name))).toBe(false)
})

it('requires CMS authorization after provider verification and revokes a verified account without CMS access', async () => {
  stubs.get.mockReturnValue({ value: 'browser-proof' })
  stubs.exchange.mockResolvedValue({
    token: 'verified-access',
    refreshToken: 'refresh',
    expiresIn: 300,
    subject: { subject: 'provider-id', email: 'owner@example.test' },
  })
  stubs.resolve.mockResolvedValue(null)
  const form = new FormData()
  form.set('authCode', '11111111-1111-4111-8111-111111111111')
  await expect(completeSignIn(form)).rejects.toThrow('redirect:/sign-in?error=no-access')
  expect(stubs.revoke).toHaveBeenCalledWith('verified-access')
  expect(stubs.accept).not.toHaveBeenCalled()
  expect(stubs.set.mock.calls.some(([name]) => [HOSTED_SESSION_COOKIE, REFRESH_COOKIE].includes(name))).toBe(false)
})

it('sets the verified session only after resolving an authorized CMS account', async () => {
  const subject = { subject: 'provider-id', email: 'owner@example.test' }
  stubs.get.mockReturnValue({ value: 'browser-proof' })
  stubs.exchange.mockResolvedValue({ token: 'verified-access', refreshToken: 'refresh', expiresIn: 300, subject })
  stubs.resolve.mockResolvedValue({ principal: { userId: 'cms-owner' } })
  const form = new FormData()
  form.set('authCode', '11111111-1111-4111-8111-111111111111')
  await expect(completeSignIn(form)).rejects.toThrow('redirect:/')
  expect(stubs.resolve).toHaveBeenCalledWith(subject)
  expect(stubs.accept).toHaveBeenCalledWith(subject)
  expect(stubs.set).toHaveBeenCalledWith(
    HOSTED_SESSION_COOKIE,
    'verified-access',
    expect.objectContaining({ secure: true, httpOnly: true }),
  )
  expect(stubs.set).toHaveBeenCalledWith(
    REFRESH_COOKIE,
    'refresh',
    expect.objectContaining({ secure: true, httpOnly: true }),
  )
})
