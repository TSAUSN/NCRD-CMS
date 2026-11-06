import { describe, expect, it, vi } from 'vitest'
import {
  AuthServiceError,
  configuredAuthProvider,
  createSignInProof,
  createSupabaseAuthProvider,
  localSessionCookieSecure,
} from './hosted-auth.ts'
import { createHash } from 'node:crypto'

const config = {
  url: 'https://project.supabase.co',
  adminOrigin: 'https://cms.example.test',
  publishableKey: 'sb_publishable_test',
}
const user = { id: 'verified-subject', email: 'Editor@Example.test', email_confirmed_at: '2026-09-04T12:00:00Z' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('production authentication configuration', () => {
  it('does not fall back to local auth when production configuration is missing', () => {
    expect(() => configuredAuthProvider({ NODE_ENV: 'production', AUTH_SECRET: 'a-development-secret-value' })).toThrow(
      /SUPABASE_URL/,
    )
  })
  it('refuses an explicitly selected local provider in ordinary production', () => {
    expect(() =>
      configuredAuthProvider({
        NODE_ENV: 'production',
        AUTH_PROVIDER: 'local',
        AUTH_SECRET: 'a-development-secret-value',
      }),
    ).toThrow(/disabled in production/)
  })
  it('permits the built-app test harness only with an explicit opt-in and loopback endpoints', () => {
    const test = {
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'local',
      CMS_LOCAL_TEST_MODE: 'true',
      DATABASE_URL_AUTHENTICATED: 'postgres://test@127.0.0.1:54329/cms_e2e',
      ADMIN_ORIGIN: 'http://127.0.0.1:3200',
      AUTH_SECRET: 'a-development-secret-value',
    }
    expect(configuredAuthProvider(test).name).toBe('local')
    expect(localSessionCookieSecure(test)).toBe(false)
    for (const change of [
      { CMS_LOCAL_TEST_MODE: 'false' },
      { AUTH_PROVIDER: 'supabase' },
      { ADMIN_ORIGIN: 'https://127.0.0.1:3200' },
      { ADMIN_ORIGIN: 'http://cms.example.test' },
      { DATABASE_URL_AUTHENTICATED: 'postgres://test@remote.example.test/db' },
    ]) {
      expect(localSessionCookieSecure({ ...test, ...change })).toBe(true)
    }
    expect(() => configuredAuthProvider({ ...test, ADMIN_ORIGIN: 'https://cms.example.test' })).toThrow(/disabled/)
    expect(() =>
      configuredAuthProvider({ ...test, DATABASE_URL_AUTHENTICATED: 'postgres://test@remote.example.test/db' }),
    ).toThrow(/disabled/)
  })
  it.each([
    'http://project.supabase.co',
    'https://project.supabase.co/path',
    'https://user:secret@project.supabase.co',
  ])('rejects unsafe provider configuration %s', url => {
    expect(() => createSupabaseAuthProvider({ ...config, url })).toThrow(/HTTPS origin/)
  })
  it('refuses secret and legacy service-role API keys', () => {
    expect(() => createSupabaseAuthProvider({ ...config, publishableKey: 'sb_secret_wrong' })).toThrow(/publishable/)
    const key = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`
    expect(() => createSupabaseAuthProvider({ ...config, publishableKey: key })).toThrow(/publishable/)
  })
})

describe('hosted email verification', () => {
  it('uses a fresh browser proof and sends only its SHA-256 challenge with the default email flow', async () => {
    const proof = createSignInProof()
    expect(proof.verifier).toMatch(/^[a-zA-Z0-9_-]{43}$/)
    expect(createSignInProof().verifier).not.toBe(proof.verifier)
    expect(proof.challenge).toBe(createHash('sha256').update(proof.verifier).digest('base64url'))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}))
    await createSupabaseAuthProvider(config, fetcher).requestSignIn!('owner@example.test', {
      invited: true,
      codeChallenge: proof.challenge,
    })
    const payload = JSON.parse(fetcher.mock.calls[0]![1]!.body as string)
    expect(payload).toEqual({
      email: 'owner@example.test',
      create_user: true,
      code_challenge: proof.challenge,
      code_challenge_method: 's256',
    })
    expect(JSON.stringify(payload)).not.toContain(proof.verifier)
  })
  it('exchanges the same browser’s code and proof, then independently verifies the returned user', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          access_token: 'verified-token',
          refresh_token: 'refresh',
          expires_in: 300,
          user: { email: 'untrusted@example.test' },
        }),
      )
      .mockResolvedValueOnce(json(user))
    const provider = createSupabaseAuthProvider(config, fetcher)
    const code = '11111111-1111-4111-8111-111111111111'
    const verifier = createSignInProof().verifier
    expect(await provider.completeCodeSignIn!(code, verifier)).toMatchObject({
      subject: { email: 'editor@example.test' },
      expiresIn: 300,
    })
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://project.supabase.co/auth/v1/token?grant_type=pkce')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ auth_code: code, code_verifier: verifier })
    expect(String(fetcher.mock.calls[1]![0])).toBe('https://project.supabase.co/auth/v1/user')
  })
  it('refuses malformed proofs/codes and provider-rejected exchanges without issuing a session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'bad-proof' }, 400))
    const provider = createSupabaseAuthProvider(config, fetcher)
    const code = '11111111-1111-4111-8111-111111111111'
    expect(await provider.completeCodeSignIn!(code, '')).toBeNull()
    expect(await provider.completeCodeSignIn!('malformed', createSignInProof().verifier)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
    expect(await provider.completeCodeSignIn!(code, createSignInProof().verifier)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('requests a link without creating a public signup or issuing a session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}))
    const provider = createSupabaseAuthProvider(config, fetcher)
    await provider.requestSignIn!('editor@example.test')
    expect(provider.issue).toBeUndefined()
    const [url, request] = fetcher.mock.calls[0]!
    expect(String(url)).toBe(
      'https://project.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fcms.example.test%2Fauth%2Fconfirm',
    )
    expect(JSON.parse(request!.body as string)).toEqual({ email: 'editor@example.test', create_user: false })
    expect(request).toMatchObject({ redirect: 'error', cache: 'no-store', method: 'POST' })
  })
  it('never treats an unknown-account response as proof of identity', async () => {
    const provider = createSupabaseAuthProvider(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'not found' }, 400)),
    )
    await expect(provider.requestSignIn!('unknown@example.test')).resolves.toBeUndefined()
    expect(provider.issue).toBeUndefined()
  })
  it('allows creation of a provider account only when the caller has checked its CMS invitation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}))
    await createSupabaseAuthProvider(config, fetcher).requestSignIn!('invited@example.test', { invited: true })
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).create_user).toBe(true)
  })
  it('takes recent-auth time from a verified login method, never token-refresh time', async () => {
    const token = `header.${Buffer.from(
      JSON.stringify({
        sub: user.id,
        iat: 9000,
        amr: [
          { method: 'otp', timestamp: 1000 },
          { method: 'token_refresh', timestamp: 9000 },
        ],
      }),
    ).toString('base64url')}.signature`
    const provider = createSupabaseAuthProvider(config, vi.fn<typeof fetch>().mockResolvedValue(json(user)))
    expect((await provider.verify(token))?.authenticatedAt).toBe(1000)
  })
  it('requires the provider to verify the token instead of decoding client claims', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(user))
    const provider = createSupabaseAuthProvider(config, fetcher)
    expect(await provider.verify('opaque-access-token')).toEqual({ subject: user.id, email: 'editor@example.test' })
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      headers: {
        Authorization: 'Bearer opaque-access-token',
        apikey: config.publishableKey,
      },
    })
  })
  it.each([
    { ...user, email_confirmed_at: null },
    { ...user, is_anonymous: true },
    { ...user, email: null },
    { ...user, id: null },
    null,
  ])('refuses an unverified or incomplete identity', async response => {
    const provider = createSupabaseAuthProvider(config, vi.fn<typeof fetch>().mockResolvedValue(json(response)))
    expect(await provider.verify('opaque-access-token')).toBeNull()
  })
  it('does not send malformed tokens to the provider', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const provider = createSupabaseAuthProvider(config, fetcher)
    expect(await provider.verify(null)).toBeNull()
    expect(await provider.verify('x\r\nInjected: header')).toBeNull()
    expect(await provider.completeSignIn!('short')).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('exchanges a link, verifies its access token, and bounds the cookie lifetime', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          access_token: 'verified-token',
          refresh_token: 'rotated-refresh',
          expires_in: 7200,
          user: { email: 'untrusted@example.test' },
        }),
      )
      .mockResolvedValueOnce(json(user))
    const provider = createSupabaseAuthProvider(config, fetcher)
    expect(await provider.completeSignIn!('a'.repeat(64))).toEqual({
      token: 'verified-token',
      refreshToken: 'rotated-refresh',
      expiresIn: 3600,
      subject: { subject: user.id, email: 'editor@example.test' },
    })
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ token_hash: 'a'.repeat(64), type: 'email' })
  })
  it('rejects expired links without creating a session', async () => {
    const provider = createSupabaseAuthProvider(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'expired' }, 403)),
    )
    expect(await provider.completeSignIn!('a'.repeat(64))).toBeNull()
  })
  it('rotates both credentials and verifies the renewed identity with the provider', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({ access_token: 'renewed-access', refresh_token: 'rotated-refresh', expires_in: 300 }),
      )
      .mockResolvedValueOnce(json(user))
    const session = await createSupabaseAuthProvider(config, fetcher).refresh!('old-refresh')
    expect(session).toMatchObject({ token: 'renewed-access', refreshToken: 'rotated-refresh', expiresIn: 300 })
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://project.supabase.co/auth/v1/token?grant_type=refresh_token')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ refresh_token: 'old-refresh' })
    expect(String(fetcher.mock.calls[1]![0])).toContain('/user')
  })
  it('refuses an invalid refresh token and incomplete renewal responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: 'expired' }, 400))
      .mockResolvedValueOnce(json({ access_token: 'access', expires_in: 3600 }))
    const provider = createSupabaseAuthProvider(config, fetcher)
    expect(await provider.refresh!('expired')).toBeNull()
    expect(await provider.refresh!('incomplete')).toBeNull()
  })
  it('reports rate limiting and outages without exposing provider response bodies', async () => {
    const limited = createSupabaseAuthProvider(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(json({ internal: 'secret' }, 429)),
    )
    await expect(limited.requestSignIn!('editor@example.test')).rejects.toMatchObject({ kind: 'rate_limit' })
    const down = createSupabaseAuthProvider(
      config,
      vi.fn<typeof fetch>().mockRejectedValue(new Error('secret request data')),
    )
    await expect(down.verify('token')).rejects.toEqual(new AuthServiceError('unavailable'))
  })
})
