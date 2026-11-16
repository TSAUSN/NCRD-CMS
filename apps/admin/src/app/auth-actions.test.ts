import { beforeEach, expect, it, vi } from 'vitest'
import { HOSTED_SESSION_COOKIE, REFRESH_COOKIE, SIGN_IN_PROOF_COOKIE } from '@cms/platform'
import { RECOVERY_EMAIL_COOKIE, SIGN_IN_METHOD_COOKIE } from '../lib/sign-in-flow.ts'

const stubs = vi.hoisted(() => ({
  asUser: vi.fn(),
  request: vi.fn(),
  exchange: vi.fn(),
  resolve: vi.fn(),
  accept: vi.fn(),
  revoke: vi.fn(),
  password: vi.fn(),
  setPassword: vi.fn(),
  session: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  microsoft: vi.fn(),
  recoveryRequest: vi.fn(),
  recoveryCode: vi.fn(),
  completeHash: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('../lib/session.ts', () => ({
  currentSession: stubs.session,
  authProvider: () => ({
    name: 'supabase',
    requestSignIn: stubs.request,
    requestPasswordRecovery: stubs.recoveryRequest,
    completeRecoveryCode: stubs.recoveryCode,
    completeSignIn: stubs.completeHash,
    completeCodeSignIn: stubs.exchange,
    signInWithPassword: stubs.password,
    setPassword: stubs.setPassword,
    microsoftSignInUrl: stubs.microsoft,
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
import {
  completeSignIn,
  completeRecoveryCode,
  requestPasswordRecovery,
  setPassword,
  signIn,
  signInWithMicrosoft,
  signInWithPassword,
} from './actions/auth.ts'

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
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

it('starts Microsoft with a browser-bound proof and records only a short-lived presentation context', async () => {
  stubs.microsoft.mockReturnValue('https://project.supabase.co/auth/v1/authorize?provider=azure')
  await expect(signInWithMicrosoft()).rejects.toThrow(
    'redirect:https://project.supabase.co/auth/v1/authorize?provider=azure',
  )
  const proof = stubs.set.mock.calls.find(([name]) => name === SIGN_IN_PROOF_COOKIE)!
  expect(proof[2]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
  expect(stubs.microsoft.mock.calls[0]![0]).not.toBe(proof[1])
  expect(stubs.microsoft.mock.calls[0]![0]).toMatch(/^[a-zA-Z0-9_-]{43}$/)
  expect(stubs.set).toHaveBeenCalledWith(
    SIGN_IN_METHOD_COOKIE,
    'microsoft',
    expect.objectContaining({ secure: true, httpOnly: true, maxAge: 600 }),
  )
  expect(stubs.resolve).not.toHaveBeenCalled()
})

it('a refused Microsoft exchange consumes its proof, offers password fallback and never opens a session', async () => {
  stubs.get.mockImplementation((name: string) => ({
    value: name === SIGN_IN_METHOD_COOKIE ? 'microsoft' : 'browser-proof',
  }))
  stubs.exchange.mockResolvedValue(null)
  const form = new FormData()
  form.set('authCode', '11111111-1111-4111-8111-111111111111')
  await expect(completeSignIn(form)).rejects.toThrow('redirect:/sign-in?error=microsoft-incomplete')
  expect(stubs.set).toHaveBeenCalledWith(SIGN_IN_PROOF_COOKIE, '', expect.objectContaining({ maxAge: 0 }))
  expect(stubs.set).toHaveBeenCalledWith(SIGN_IN_METHOD_COOKIE, '', expect.objectContaining({ maxAge: 0 }))
  expect(stubs.resolve).not.toHaveBeenCalled()
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

const credentials = (email: string, password: string) => {
  const form = new FormData()
  form.set('email', email)
  form.set('password', password)
  return form
}

it('opens a CMS session for a correct password only after resolving an authorized CMS account', async () => {
  const subject = { subject: 'provider-id', email: 'owner@example.test' }
  stubs.password.mockResolvedValue({ token: 'verified-access', refreshToken: 'refresh', expiresIn: 300, subject })
  stubs.resolve.mockResolvedValue({ principal: { userId: 'cms-owner' } })
  await expect(signInWithPassword(credentials(' Owner@Example.test ', 'correct horse battery'))).rejects.toThrow(
    'redirect:/',
  )
  expect(stubs.password).toHaveBeenCalledWith('owner@example.test', 'correct horse battery')
  expect(stubs.resolve).toHaveBeenCalledWith(subject)
  expect(stubs.set).toHaveBeenCalledWith(
    HOSTED_SESSION_COOKIE,
    'verified-access',
    expect.objectContaining({ secure: true, httpOnly: true, maxAge: 300 }),
  )
  expect(stubs.set).toHaveBeenCalledWith(
    REFRESH_COOKIE,
    'refresh',
    expect.objectContaining({ secure: true, httpOnly: true }),
  )
  expect(stubs.request).not.toHaveBeenCalled()
})

it('gives one answer for a wrong email or password and sets no session', async () => {
  stubs.password.mockResolvedValue(null)
  await expect(signInWithPassword(credentials('owner@example.test', 'wrong'))).rejects.toThrow(
    'redirect:/sign-in?error=wrong-password',
  )
  await expect(signInWithPassword(credentials('owner@example.test', ''))).rejects.toThrow(
    'redirect:/sign-in?error=missing-password',
  )
  expect(stubs.password).toHaveBeenCalledTimes(1)
  expect(stubs.set).not.toHaveBeenCalled()
})

it('refuses a correct password for somebody without CMS access and revokes that sign-in', async () => {
  stubs.password.mockResolvedValue({
    token: 'verified-access',
    refreshToken: 'refresh',
    expiresIn: 300,
    subject: { subject: 'provider-id', email: 'stranger@example.test' },
  })
  stubs.resolve.mockResolvedValue(null)
  await expect(signInWithPassword(credentials('stranger@example.test', 'correct horse battery'))).rejects.toThrow(
    'redirect:/sign-in?error=no-access',
  )
  expect(stubs.revoke).toHaveBeenCalledWith('verified-access')
  expect(stubs.set).not.toHaveBeenCalled()
})

const newPassword = (password: string, again = password) => {
  const form = new FormData()
  form.set('password', password)
  form.set('passwordAgain', again)
  return form
}

it('saves a new password only for the signed-in person, using their own session', async () => {
  stubs.session.mockResolvedValue({ principal: { userId: 'cms-owner' } })
  stubs.get.mockImplementation((name: string) => (name === HOSTED_SESSION_COOKIE ? { value: 'my-access' } : undefined))
  stubs.setPassword.mockResolvedValue('saved')
  await expect(setPassword(newPassword('correct horse battery'))).rejects.toThrow('redirect:/account/password?saved=1')
  expect(stubs.setPassword).toHaveBeenCalledWith('my-access', 'correct horse battery')
})

it('checks a new password before sending it anywhere', async () => {
  stubs.session.mockResolvedValue({ principal: { userId: 'cms-owner' } })
  stubs.get.mockReturnValue({ value: 'my-access' })
  await expect(setPassword(newPassword('too short'))).rejects.toThrow('redirect:/account/password?error=too-short')
  await expect(setPassword(newPassword('x'.repeat(73)))).rejects.toThrow('redirect:/account/password?error=too-long')
  await expect(setPassword(newPassword('correct horse battery', 'correct horse batter'))).rejects.toThrow(
    'redirect:/account/password?error=mismatch',
  )
  expect(stubs.setPassword).not.toHaveBeenCalled()
})

it('never sets a password for a visitor who is not signed in', async () => {
  stubs.session.mockResolvedValue(null)
  stubs.get.mockReturnValue({ value: 'stale-access' })
  await expect(setPassword(newPassword('correct horse battery'))).rejects.toThrow('redirect:/sign-in')
  expect(stubs.setPassword).not.toHaveBeenCalled()
})

it('reports a password the provider refuses and sends an ended session back to sign in', async () => {
  stubs.session.mockResolvedValue({ principal: { userId: 'cms-owner' } })
  stubs.get.mockReturnValue({ value: 'my-access' })
  stubs.setPassword.mockResolvedValueOnce('weak').mockResolvedValueOnce('signed-out')
  await expect(setPassword(newPassword('correct horse battery'))).rejects.toThrow(
    'redirect:/account/password?error=weak',
  )
  await expect(setPassword(newPassword('correct horse battery'))).rejects.toThrow('redirect:/sign-in?reauth=1')
})

it('starts password recovery without a signed-in session, an account lookup or any public signup', async () => {
  await expect(requestPasswordRecovery(credentials(' Owner@Example.test ', ''))).rejects.toThrow(
    'redirect:/sign-in/reset?sent=1',
  )
  expect(stubs.recoveryRequest).toHaveBeenCalledWith('owner@example.test', expect.stringMatching(/^[a-zA-Z0-9_-]{43}$/))
  expect(stubs.set).toHaveBeenCalledWith(
    RECOVERY_EMAIL_COOKIE,
    'owner@example.test',
    expect.objectContaining({ secure: true, httpOnly: true, path: '/', maxAge: 3600 }),
  )
  expect(stubs.session).not.toHaveBeenCalled()
  expect(stubs.asUser).not.toHaveBeenCalled()
  expect(stubs.password).not.toHaveBeenCalled()
})

it('exchanges a recovery link for the same authorized account and opens its Password screen', async () => {
  stubs.get.mockImplementation((name: string) => ({
    value: name === SIGN_IN_METHOD_COOKIE ? 'recovery' : 'browser-proof',
  }))
  const subject = { subject: 'existing-provider-id', email: 'owner@example.test' }
  stubs.exchange.mockResolvedValue({ token: 'verified-access', refreshToken: 'refresh', expiresIn: 300, subject })
  stubs.resolve.mockResolvedValue({ principal: { userId: 'existing-cms-owner' } })
  const form = new FormData()
  form.set('authCode', '11111111-1111-4111-8111-111111111111')
  await expect(completeSignIn(form)).rejects.toThrow('redirect:/account/password')
  expect(stubs.resolve).toHaveBeenCalledWith(subject)
  expect(stubs.setPassword).not.toHaveBeenCalled()
})

it('verifies a direct recovery hash with recovery type and does not consume it on page render', async () => {
  const form = new FormData()
  form.set('tokenHash', 'a'.repeat(64))
  form.set('type', 'recovery')
  stubs.completeHash.mockResolvedValue(null)
  await expect(completeSignIn(form)).rejects.toThrow('redirect:/sign-in/reset?error=invalid-link')
  expect(stubs.completeHash).toHaveBeenCalledWith('a'.repeat(64), 'recovery')
  expect(stubs.resolve).not.toHaveBeenCalled()
})

it('does not exchange a foreign-browser recovery code or set session cookies', async () => {
  stubs.get.mockImplementation((name: string) => (name === SIGN_IN_METHOD_COOKIE ? { value: 'recovery' } : undefined))
  const form = new FormData()
  form.set('authCode', '11111111-1111-4111-8111-111111111111')
  await expect(completeSignIn(form)).rejects.toThrow('redirect:/sign-in/reset?error=invalid-link')
  expect(stubs.exchange).not.toHaveBeenCalled()
  expect(stubs.resolve).not.toHaveBeenCalled()
  expect(stubs.set.mock.calls.some(([name]) => [HOSTED_SESSION_COOKIE, REFRESH_COOKIE].includes(name))).toBe(false)
})

it('keeps code entry off until its actual email template is configured', async () => {
  await expect(completeRecoveryCode(new FormData())).rejects.toThrow('redirect:/sign-in/reset?error=unavailable')
  expect(stubs.recoveryCode).not.toHaveBeenCalled()
})

it('uses the requested email from its HttpOnly cookie, not a submitted replacement, and preserves the CMS access gate', async () => {
  vi.stubEnv('AUTH_RECOVERY_CODE_ENABLED', 'true')
  stubs.get.mockImplementation((name: string) => ({
    value: name === RECOVERY_EMAIL_COOKIE ? 'owner@example.test' : 'recovery',
  }))
  stubs.recoveryCode.mockResolvedValue({
    token: 'verified-access',
    refreshToken: 'refresh',
    expiresIn: 300,
    subject: { subject: 'existing-provider-id', email: 'owner@example.test' },
  })
  stubs.resolve.mockResolvedValue(null)
  const form = new FormData()
  form.set('code', '123456')
  form.set('email', 'other@example.test')
  await expect(completeRecoveryCode(form)).rejects.toThrow('redirect:/sign-in?error=no-access')
  expect(stubs.recoveryCode).toHaveBeenCalledWith('owner@example.test', '123456')
  expect(stubs.revoke).toHaveBeenCalledWith('verified-access')
  expect(stubs.set.mock.calls.some(([name]) => [HOSTED_SESSION_COOKIE, REFRESH_COOKIE].includes(name))).toBe(false)
})

it('opens the password screen after a verified recovery code and clears its temporary browser state', async () => {
  vi.stubEnv('AUTH_RECOVERY_CODE_ENABLED', 'true')
  stubs.get.mockImplementation((name: string) => ({
    value: name === RECOVERY_EMAIL_COOKIE ? 'owner@example.test' : 'recovery',
  }))
  stubs.recoveryCode.mockResolvedValue({
    token: 'verified-access',
    refreshToken: 'refresh',
    expiresIn: 300,
    subject: { subject: 'existing-provider-id', email: 'owner@example.test' },
  })
  stubs.resolve.mockResolvedValue({ principal: { userId: 'existing-cms-owner' } })
  const form = new FormData()
  form.set('code', '123456')
  await expect(completeRecoveryCode(form)).rejects.toThrow('redirect:/account/password')
  expect(stubs.set).toHaveBeenCalledWith(RECOVERY_EMAIL_COOKIE, '', expect.objectContaining({ maxAge: 0 }))
  expect(stubs.setPassword).not.toHaveBeenCalled()
})

it('rejects an expired recovery code without opening a session or changing a password', async () => {
  vi.stubEnv('AUTH_RECOVERY_CODE_ENABLED', 'true')
  stubs.get.mockImplementation((name: string) => ({
    value: name === RECOVERY_EMAIL_COOKIE ? 'owner@example.test' : 'recovery',
  }))
  stubs.recoveryCode.mockResolvedValue(null)
  const form = new FormData()
  form.set('code', '123456')
  await expect(completeRecoveryCode(form)).rejects.toThrow('redirect:/sign-in/reset?sent=1&error=invalid-code')
  expect(stubs.resolve).not.toHaveBeenCalled()
  expect(stubs.setPassword).not.toHaveBeenCalled()
  expect(stubs.set).not.toHaveBeenCalled()
})
