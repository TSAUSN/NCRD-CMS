import { expect, it, vi } from 'vitest'
import { AuthServiceError, createSupabaseAuthProvider } from './hosted-auth.ts'

const config = {
  url: 'https://project.supabase.co',
  adminOrigin: 'https://cms.example.test',
  publishableKey: 'sb_publishable_test',
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const tokens = { access_token: 'verified-access', refresh_token: 'refresh', expires_in: 3600 }
const user = { id: 'existing-user', email: 'owner@example.test', email_confirmed_at: '2026-11-16T12:00:00Z' }

it('requests recovery at the configured callback with a browser challenge and never asks to create a user', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}))
  await createSupabaseAuthProvider(config, fetcher).requestPasswordRecovery!('owner@example.test', 'a'.repeat(43))
  expect(fetcher.mock.calls[0]![0]).toBe(
    'https://project.supabase.co/auth/v1/recover?redirect_to=https%3A%2F%2Fcms.example.test%2Fauth%2Fconfirm',
  )
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
    email: 'owner@example.test',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 's256',
  })
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', redirect: 'error' })
})

it('gives the same receipt for missing accounts and preserves provider rate limits', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 400)).mockResolvedValueOnce(json({}, 429))
  const provider = createSupabaseAuthProvider(config, fetcher)
  await expect(provider.requestPasswordRecovery!('unknown@example.test', 'a'.repeat(43))).resolves.toBeUndefined()
  await expect(provider.requestPasswordRecovery!('owner@example.test', 'a'.repeat(43))).rejects.toMatchObject({
    kind: 'rate_limit',
  })
})

it('verifies a recovery code as recovery and independently verifies the returned user', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(tokens)).mockResolvedValueOnce(json(user))
  const verified = await createSupabaseAuthProvider(config, fetcher).completeRecoveryCode!(
    'owner@example.test',
    '123456',
  )
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
    email: 'owner@example.test',
    token: '123456',
    type: 'recovery',
  })
  expect(fetcher.mock.calls[1]![0]).toBe('https://project.supabase.co/auth/v1/user')
  expect(verified?.subject).toMatchObject({ subject: 'existing-user', email: 'owner@example.test' })
})

it('refuses malformed, expired, replayed or unconfirmed recovery credentials', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({}, 400))
    .mockResolvedValueOnce(json(tokens))
    .mockResolvedValueOnce(json({ ...user, email_confirmed_at: null }))
  const provider = createSupabaseAuthProvider(config, fetcher)
  expect(await provider.completeRecoveryCode!('owner@example.test', 'not-a-code')).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
  expect(await provider.completeRecoveryCode!('owner@example.test', '123456')).toBeNull()
  expect(await provider.completeRecoveryCode!('owner@example.test', '654321')).toBeNull()
})

it('exchanges direct recovery hashes using the recovery type, not ordinary email verification', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, 400))
  expect(await createSupabaseAuthProvider(config, fetcher).completeSignIn!('a'.repeat(64), 'recovery')).toBeNull()
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
    token_hash: 'a'.repeat(64),
    type: 'recovery',
  })
})

it('fails closed on a provider outage without returning upstream credential content', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private upstream content'))
  await expect(
    createSupabaseAuthProvider(config, fetcher).requestPasswordRecovery!('owner@example.test', 'a'.repeat(43)),
  ).rejects.toBeInstanceOf(AuthServiceError)
})
